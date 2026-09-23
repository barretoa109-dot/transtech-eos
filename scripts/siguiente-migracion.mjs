#!/usr/bin/env node
/**
 * ============================================================
 * QUÉ PROBLEMA RESUELVE
 * ============================================================
 *
 * Varias sesiones (de Claude, de Codex, del propio usuario) escriben
 * migraciones para este repo AL MISMO TIEMPO, cada una en su propia rama, sin
 * verse entre sí. Ya pasó más de una vez que dos sesiones eligieron el mismo
 * timestamp de 14 dígitos para archivos distintos (2026-09-02, dos veces el
 * mismo día) y que una sesión no vio que otra ya tenía una versión reservada
 * en una rama sin mergear, chocando en CI o directo contra producción.
 *
 * `npm run migraciones` (scripts/migraciones-sanas.mjs) detecta el choque
 * DESPUÉS de que ya pasó, comparando archivos que conviven en el mismo
 * checkout. Este script busca ANTES de escribir nada: mira el repo local, lo
 * último aplicado a `origin/main`, y toda rama remota — mergeada o no — que
 * tenga migraciones propias todavía no integradas.
 *
 * ============================================================
 * QUÉ NO HACE
 * ============================================================
 *
 * No reserva nada de verdad — no hay servidor central para eso. Es una
 * fotografía del instante en que se corre. Dos sesiones que lo corran en el
 * mismo segundo pueden seguir chocando. Por eso el resultado insiste en:
 * crear el archivo YA, con esa versión, apenas termina de correr — no
 * guardar el número para después.
 *
 * Tampoco reemplaza mirar `select max(version) from
 * supabase_migrations.schema_migrations` contra producción antes de un `db
 * push` real — esto es una ayuda para ELEGIR el número, no una fuente de
 * verdad sobre qué está aplicado.
 *
 * ============================================================
 * USO
 * ============================================================
 *
 *   git fetch --all --prune     (si no se corrió hace poco, el resultado miente)
 *   npm run siguiente-migracion
 *
 * Imprime la versión recomendada y de dónde salió cada candidato que
 * descartó. Copiarla como prefijo del archivo nuevo de inmediato.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/*
 * Sin shell y con los argumentos separados. La primera versión pasaba
 * `git branch -r --format=%(refname:short)` por la shell: los paréntesis
 * rompían la sintaxis, el error se tragaba y el script informaba "0 rama(s)
 * remota(s)" sin revisar ninguna — justo la parte que lo justificaba. Así
 * además funciona igual en Windows (cmd.exe) y en Linux.
 */
function git(...args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

const DIR = path.join(process.cwd(), "supabase", "migrations");
const candidatos = []; // { version, origen }

// ------------------------------------------------------------
// 1. Migraciones locales en disco
// ------------------------------------------------------------
if (fs.existsSync(DIR)) {
  for (const archivo of fs.readdirSync(DIR)) {
    const version = archivo.slice(0, 14);
    if (/^\d{14}$/.test(version)) candidatos.push({ version, origen: `local: ${archivo}` });
  }
}

// ------------------------------------------------------------
// 2. origin/main (por si el checkout local está atrasado)
// ------------------------------------------------------------
const arbolMain = git("ls-tree", "-r", "origin/main", "--name-only", "--", "supabase/migrations");
for (const linea of arbolMain.split("\n").filter(Boolean)) {
  const archivo = path.basename(linea);
  const version = archivo.slice(0, 14);
  if (/^\d{14}$/.test(version)) candidatos.push({ version, origen: `origin/main: ${archivo}` });
}

// ------------------------------------------------------------
// 3. Toda rama remota, mergeada o no — acá es donde vive el choque real
// ------------------------------------------------------------
const ramas = git("branch", "-r", "--format=%(refname:short)")
  .split("\n")
  .map((r) => r.trim())
  .filter((r) => r && !r.endsWith("/HEAD"));

for (const rama of ramas) {
  if (rama === "origin/main") continue; // ya cubierta arriba
  const arbol = git("ls-tree", "-r", rama, "--name-only", "--", "supabase/migrations");
  for (const linea of arbol.split("\n").filter(Boolean)) {
    const archivo = path.basename(linea);
    const version = archivo.slice(0, 14);
    if (/^\d{14}$/.test(version)) candidatos.push({ version, origen: `${rama}: ${archivo}` });
  }
}

// ------------------------------------------------------------
// Calcular la máxima y proponer 10 minutos por delante
// ------------------------------------------------------------
if (candidatos.length === 0) {
  console.error("No se encontró ninguna migración (¿se corrió sin `git fetch --all` antes, en un repo vacío?).");
  process.exit(1);
}

candidatos.sort((a, b) => (a.version < b.version ? 1 : a.version > b.version ? -1 : 0));
const maxima = candidatos[0];

function sumar10Min(version) {
  const y = Number(version.slice(0, 4));
  const mo = Number(version.slice(4, 6)) - 1;
  const d = Number(version.slice(6, 8));
  const h = Number(version.slice(8, 10));
  const mi = Number(version.slice(10, 12));
  const s = Number(version.slice(12, 14));
  const fecha = new Date(Date.UTC(y, mo, d, h, mi, s));
  fecha.setUTCMinutes(fecha.getUTCMinutes() + 10);
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return (
    `${fecha.getUTCFullYear()}${p(fecha.getUTCMonth() + 1)}${p(fecha.getUTCDate())}` +
    `${p(fecha.getUTCHours())}${p(fecha.getUTCMinutes())}${p(fecha.getUTCSeconds())}`
  );
}

const recomendada = sumar10Min(maxima.version);

console.log(`${candidatos.length} versiones encontradas en local + origin/main + ${ramas.length} rama(s) remota(s).`);
console.log(`La más alta: ${maxima.version}  (${maxima.origen})`);
console.log("");
console.log(`VERSIÓN RECOMENDADA: ${recomendada}`);
console.log("");
console.log("Usarla YA, como prefijo del archivo nuevo, antes de que otra sesión corra esto también.");
console.log("Si el archivo no se llegó a crear en los próximos minutos, volver a correr este script antes de usarla.");
