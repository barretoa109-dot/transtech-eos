#!/usr/bin/env node
/**
 * ¿Qué otra sesión está tocando esto ahora mismo?
 *
 *     npm run quien-toca -- lib/gateway lib/eos/procesar-mensaje.ts
 *
 * Lista las ramas remotas que TODAVÍA NO están en origin/main y cambian algo
 * dentro de las rutas pedidas, de la más reciente a la más vieja, con qué
 * archivos tocan. Correrlo después de `git fetch --all --prune`.
 *
 * ============================================================
 * POR QUÉ UN SCRIPT Y NO UN ARCHIVO DE ESTADO
 * ============================================================
 *
 * El plan de fortalecimiento (2.3) proponía un `docs/estado-compartido.md` que
 * cada sesión actualice con lo que está tocando. Un archivo que editan todas
 * las ramas a la vez es, justamente, el archivo que más conflictos de merge va
 * a tener — y se desactualiza apenas una sesión se olvida de anotarse. Las
 * ramas remotas YA son ese estado, siempre al día: esto solo las lee.
 *
 * Mismo criterio que `siguiente-migracion.mjs`: git sin shell, para que ande
 * igual en Windows y en Linux.
 */

import { execFileSync } from "node:child_process";

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

const rutas = process.argv.slice(2).filter(Boolean);
if (rutas.length === 0) {
  console.error("Uso: npm run quien-toca -- <ruta> [<ruta> ...]");
  process.exit(2);
}

const DIAS = 14;
const desde = Date.now() - DIAS * 86_400_000;

const ramas = git(
  "for-each-ref",
  "--sort=-committerdate",
  "--format=%(committerdate:unix)|%(refname:short)",
  "refs/remotes",
)
  .split("\n")
  .map((l) => l.split("|"))
  .filter(([, rama]) => rama && !rama.endsWith("/HEAD") && rama !== "origin/main")
  .filter(([fecha]) => Number(fecha) * 1000 >= desde);

let encontradas = 0;

for (const [fecha, rama] of ramas) {
  // Solo lo que la rama agrega respecto de su punto de partida con main.
  const archivos = git("diff", "--name-only", `origin/main...${rama}`, "--", ...rutas)
    .split("\n")
    .filter(Boolean);
  if (archivos.length === 0) continue;

  encontradas += 1;
  const cuando = new Date(Number(fecha) * 1000).toISOString().slice(0, 16).replace("T", " ");
  console.log(`${rama}  (último commit ${cuando} UTC)`);
  for (const a of archivos.slice(0, 15)) console.log(`    ${a}`);
  if (archivos.length > 15) console.log(`    … y ${archivos.length - 15} más`);
}

console.log(
  encontradas === 0
    ? `Nadie más toca ${rutas.join(", ")} en ramas sin mergear de los últimos ${DIAS} días.`
    : `\n${encontradas} rama(s) sin mergear tocan esto. Coordinar antes de editar.`,
);
