#!/usr/bin/env node
/**
 * Que ninguna función SECURITY DEFINER nueva nazca abierta a `anon`.
 *
 * En este proyecto TODA función nueva recibe EXECUTE para PUBLIC, anon,
 * authenticated y service_role (`alter default privileges` de la v0 más el
 * default de Postgres). `revoke ... from public` solo NO alcanza: anon tiene
 * su grant directo. Y `revoke ... from anon` solo tampoco: anon hereda de
 * PUBLIC. Hacen falta los dos, y por eso 18 funciones estuvieron expuestas
 * hasta la v169/v171.
 *
 * La regla, para migraciones desde el 2026-09-18: toda función
 * `security definer` que se cree tiene que tener, en el mismo archivo, un
 * `revoke execute on function <nombre>` que nombre `public` y `anon`.
 *
 *   npm run grants
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESDE = "20260918";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

/** Devuelve los problemas de un archivo de migración. */
export function problemasDe(sql, yaExistian = new Set()) {
  const limpio = sql.replace(/--[^\n]*/g, "");
  const problemas = [];

  const creadas = new Map();
  const reFuncion = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\$(\w*)\$/gi;
  let m;
  while ((m = reFuncion.exec(limpio)) !== null) {
    const nombre = m[1];
    const cabecera = limpio.slice(m.index, m.index + 1500).split(/\$\w*\$/)[0];
    if (/security\s+definer/i.test(cabecera)) creadas.set(nombre, true);
  }

  for (const nombre of creadas.keys()) {
    // Redefinir una función que ya existía conserva sus permisos (create or
    // replace no los toca): lo que se revisa es lo que nace nuevo.
    if (yaExistian.has(nombre)) continue;
    const reRevoke = new RegExp(
      `revoke\\s+(?:all|execute)\\s+on\\s+function\\s+(?:public\\.)?"?${nombre}"?[\\s\\S]*?;`,
      "gi",
    );
    const revokes = limpio.match(reRevoke) ?? [];
    const texto = revokes.join(" ").toLowerCase();
    const conPublic = /\bfrom\b[^;]*\bpublic\b/.test(texto);
    const conAnon = /\bfrom\b[^;]*\banon\b/.test(texto);

    if (!conPublic || !conAnon) {
      problemas.push(
        `${nombre}: es SECURITY DEFINER y no revoca ${[!conPublic && "PUBLIC", !conAnon && "anon"]
          .filter(Boolean)
          .join(" ni ")}. Agregá \`revoke execute on function ${nombre}(...) from public, anon;\`` +
          " (y de authenticated si solo la llama el backend).",
      );
    }
  }

  return problemas;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const archivos = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 8) >= DESDE)
    .sort();

  const yaExistian = new Set();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && f.slice(0, 8) < DESDE)) {
    const previo = fs.readFileSync(path.join(dir, f), "utf8").replace(/--[^\n]*/g, "");
    const reNombre = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
    for (const x of previo.matchAll(reNombre)) yaExistian.add(x[1]);
  }

  let hubo = false;
  for (const f of archivos) {
    const problemas = problemasDe(fs.readFileSync(path.join(dir, f), "utf8"), yaExistian);
    for (const p of problemas) {
      console.error(`${f}: ${p}`);
      hubo = true;
    }
  }

  if (hubo) process.exit(1);
  console.log(`Grants sanos: ${archivos.length} migraciones desde ${DESDE}, ninguna función SECURITY DEFINER abierta a anon.`);
}
