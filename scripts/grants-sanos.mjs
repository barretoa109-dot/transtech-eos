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

/**
 * Los tipos de una lista de parámetros, en orden, sin nombres ni defaults.
 *
 * Postgres distingue funciones por NOMBRE + TIPOS DE ENTRADA, no por nombre
 * solo: `f(uuid,text)` y `f(uuid,text,text)` son dos funciones distintas, y
 * `CREATE OR REPLACE` sobre la segunda firma no toca la primera — la deja
 * viva, sin permisos propios, y encima ambigua para cualquier llamada vieja
 * que calce con las dos por el número de argumentos. Pasó de verdad: la v242
 * agregó un parámetro a tres funciones con CREATE OR REPLACE creyendo que
 * las reemplazaba, y creó tres funciones nuevas sin revocar nada, abiertas a
 * `anon` (13/10/2026). De ahí esta función y la firma completa como clave.
 */
/**
 * Alias que Postgres trata como el mismo tipo pero que este proyecto escribe
 * distinto según el lugar: el `create` suele usar el nombre largo del
 * estándar SQL, y un `revoke` escrito a mano, el corto. Sin esto, un tipo
 * real que coincide en la base se lee como que no coincide acá.
 */
const ALIAS_DE_TIPO = {
  timestamptz: "timestamp with time zone",
  timestamp: "timestamp without time zone",
  int: "integer",
  int4: "integer",
  int8: "bigint",
  "character varying": "varchar",
};

function normalizarTipo(tipo) {
  return ALIAS_DE_TIPO[tipo] ?? tipo;
}

function tiposDe(cabeceraArgs) {
  return cabeceraArgs
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const sinDefault = p.split(/\bdefault\b/i)[0].trim();
      const partes = sinDefault.split(/\s+/).filter(Boolean);
      // partes[0] es el nombre del parámetro (p_usuario_id); el resto es el
      // tipo, que puede ser de varias palabras ("double precision").
      return normalizarTipo(partes.slice(1).join(" ").toLowerCase());
    })
    .join(",");
}

/**
 * Lo mismo que `tiposDe`, pero para la lista de un `revoke`/`grant`: ahí
 * Postgres exige sólo tipos, sin nombre de parámetro (`function f(uuid,
 * text)`, nunca `function f(p_x uuid)`). Con `tiposDe` ese primer tipo se
 * leía como si fuera el nombre y se descartaba, y la firma nunca calzaba con
 * la del `create` — exactamente el falso positivo que delató esta función.
 */
function tiposDeRevoke(cabeceraArgs) {
  return cabeceraArgs
    .split(",")
    .map((p) => normalizarTipo(p.trim().toLowerCase()))
    .filter(Boolean)
    .join(",");
}

/** Devuelve los problemas de un archivo de migración. */
export function problemasDe(sql, yaExistian = new Set()) {
  const limpio = sql.replace(/--[^\n]*/g, "");
  const problemas = [];

  const creadas = new Map();
  const reFuncion = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\$(\w*)\$/gi;
  let m;
  while ((m = reFuncion.exec(limpio)) !== null) {
    const nombre = m[1];
    const firma = `${nombre}(${tiposDe(m[2])})`;
    const cabecera = limpio.slice(m.index, m.index + 1500).split(/\$\w*\$/)[0];
    if (/security\s+definer/i.test(cabecera)) creadas.set(firma, nombre);
  }

  for (const [firma, nombre] of creadas) {
    // Redefinir una función que ya existía con la MISMA firma conserva sus
    // permisos (create or replace no los toca): lo que se revisa es lo que
    // nace nuevo, sea por nombre nuevo o por una lista de tipos nueva.
    if (yaExistian.has(firma)) continue;
    const reRevoke = new RegExp(
      `revoke\\s+(?:all|execute)\\s+on\\s+function\\s+(?:public\\.)?"?${nombre}"?\\s*\\(([\\s\\S]*?)\\)[\\s\\S]*?;`,
      "gi",
    );
    let revoke;
    let conPublic = false;
    let conAnon = false;
    while ((revoke = reRevoke.exec(limpio)) !== null) {
      if (`${nombre}(${tiposDeRevoke(revoke[1])})` !== firma) continue;
      const texto = revoke[0].toLowerCase();
      if (/\bfrom\b[^;]*\bpublic\b/.test(texto)) conPublic = true;
      if (/\bfrom\b[^;]*\banon\b/.test(texto)) conAnon = true;
    }

    if (!conPublic || !conAnon) {
      problemas.push(
        `${firma}: es SECURITY DEFINER y no revoca ${[!conPublic && "PUBLIC", !conAnon && "anon"]
          .filter(Boolean)
          .join(" ni ")}. Agregá \`revoke execute on function ${firma} from public, anon;\`` +
          " (y de authenticated si solo la llama el backend) — con esta MISMA lista de tipos," +
          " no solo el nombre: una firma nueva es una función nueva.",
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
    const reFirma = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*returns/gi;
    for (const x of previo.matchAll(reFirma)) yaExistian.add(`${x[1]}(${tiposDe(x[2])})`);
  }

  /*
   * Una función puede nacer sin revocar en un archivo y arreglarse en uno
   * posterior, sin volver a declararla (un `revoke` suelto alcanza). Por eso
   * el revoke se busca en TODO el rango escaneado, no solo en el mismo
   * archivo donde nació — si `problemasDe` sólo mirara el archivo de
   * creación, un arreglo posterior nunca lo pondría en verde.
   */
  const revocadasEnAlgunLado = new Set();
  for (const f of archivos) {
    const limpio = fs.readFileSync(path.join(dir, f), "utf8").replace(/--[^\n]*/g, "");
    const reRevoke = /revoke\s+(?:all|execute)\s+on\s+function\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)([\s\S]*?);/gi;
    let r;
    while ((r = reRevoke.exec(limpio)) !== null) {
      const texto = r[0].toLowerCase();
      if (/\bfrom\b[^;]*\bpublic\b/.test(texto) && /\bfrom\b[^;]*\banon\b/.test(texto)) {
        revocadasEnAlgunLado.add(`${r[1]}(${tiposDeRevoke(r[2])})`);
      }
    }
  }
  const conocidas = new Set([...yaExistian, ...revocadasEnAlgunLado]);

  let hubo = false;
  for (const f of archivos) {
    const problemas = problemasDe(fs.readFileSync(path.join(dir, f), "utf8"), conocidas);
    for (const p of problemas) {
      console.error(`${f}: ${p}`);
      hubo = true;
    }
  }

  if (hubo) process.exit(1);
  console.log(`Grants sanos: ${archivos.length} migraciones desde ${DESDE}, ninguna función SECURITY DEFINER abierta a anon.`);
}
