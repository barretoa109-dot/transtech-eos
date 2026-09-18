#!/usr/bin/env node
/**
 * Que toda columna que el código pide exista de verdad en la base.
 *
 * Una consulta de supabase-js a una columna inexistente NO lanza: devuelve
 * `{ data: null, error }`, y el idioma de todo este repo —`data ?? []`— lo
 * convierte en "no hay nada". El 2026-09-18 aparecieron dos así en el centro
 * de atención: `error_mensaje` (es `error_message`) y `estado` sobre las
 * aprobaciones (es `status`). Durante semanas ninguna orden fallida ni
 * aprobación pendiente llegó jamás a la pantalla, sin un solo error visible.
 *
 * Revisa los nombres de columna de `.select("a,b")` y de los filtros
 * (`.eq`, `.gte`, `.order`, `.in`, ...) contra `information_schema` de
 * producción. Solo mira literales: lo armado dinámicamente no se puede ver.
 *
 * No corre en el CI porque necesita el esquema vivo (y el CI no tiene
 * credenciales). Se corre a mano antes de un cambio grande:
 *
 *   npm run columnas
 *
 * Toma SUPABASE_ACCESS_TOKEN del entorno o de .env.local.
 */

import fs from "node:fs";
import path from "node:path";

const REF = "dirugpkamzgvyshcnsxs";

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  try {
    const env = fs.readFileSync(".env.local", "utf8");
    return env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const t = token();
if (!t) {
  console.error("Falta SUPABASE_ACCESS_TOKEN (entorno o .env.local).");
  process.exit(2);
}

const respuesta = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: "select table_name, column_name from information_schema.columns where table_schema = 'public'",
  }),
});

if (!respuesta.ok) {
  console.error(`No se pudo leer el esquema: HTTP ${respuesta.status}`);
  process.exit(2);
}

const columnas = new Map();
for (const fila of await respuesta.json()) {
  if (!columnas.has(fila.table_name)) columnas.set(fila.table_name, new Set());
  columnas.get(fila.table_name).add(fila.column_name);
}

const archivos = [];
for (const raiz of ["app", "lib"]) {
  (function recorrer(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) recorrer(p);
      else if (/\.(ts|tsx)$/.test(f.name) && !/\.test\./.test(f.name)) archivos.push(p);
    }
  })(raiz);
}

const FILTROS = /\.(eq|neq|gt|gte|lt|lte|is|in|not|like|ilike|order|contains)\(\s*["'`](\w+)["'`]/g;

let revisadas = 0;
let malas = 0;

for (const archivo of archivos) {
  const src = fs.readFileSync(archivo, "utf8");
  const inicios = [...src.matchAll(/\.from\(\s*["'`](\w+)["'`]\s*\)/g)];

  for (let i = 0; i < inicios.length; i++) {
    const tabla = inicios[i][1];
    if (!columnas.has(tabla)) continue;

    // La cadena termina en `;` o donde empieza la siguiente consulta.
    const siguiente = inicios[i + 1]?.index ?? Infinity;
    let fin = src.indexOf(";", inicios[i].index);
    if (fin < 0 || fin > siguiente) fin = siguiente;
    if (!Number.isFinite(fin)) fin = inicios[i].index + 1500;
    const cadena = src.slice(inicios[i].index, fin);

    const linea = () => src.slice(0, inicios[i].index).split("\n").length;
    const revisar = (col, como) => {
      revisadas++;
      if (!columnas.get(tabla).has(col)) {
        malas++;
        console.error(`${archivo}:${linea()}  ${tabla}.${col} (${como}) no existe`);
      }
    };

    for (const m of cadena.matchAll(FILTROS)) revisar(m[2], m[1]);

    const select = cadena.match(/\.select\(\s*(["'`])([^"'`]*)\1/);
    if (select && !/\.(insert|update|delete|upsert)\(/.test(cadena)) {
      let nivel = 0;
      let actual = "";
      const partes = [];
      for (const ch of select[2]) {
        if (ch === "(") nivel++;
        if (ch === ")") nivel--;
        if (ch === "," && nivel === 0) {
          partes.push(actual);
          actual = "";
        } else actual += ch;
      }
      partes.push(actual);

      for (let p of partes) {
        p = p.trim();
        if (!p || p === "*" || p.includes("(") || p.includes("!")) continue;
        p = p.split("::")[0].split(":").pop().trim().split("->")[0];
        if (/^\w+$/.test(p)) revisar(p, "select");
      }
    }
  }
}

if (malas > 0) {
  console.error(`\n${malas} columna(s) inexistente(s) de ${revisadas} revisadas.`);
  process.exit(1);
}
console.log(`Columnas que existen: ${revisadas} nombres revisados, ninguno inexistente.`);
