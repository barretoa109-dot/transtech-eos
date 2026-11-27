#!/usr/bin/env node
/**
 * Operar los agentes desde la terminal, sin deploy.
 *
 *   npm run agentes -- estado
 *   npm run agentes -- apagar cobranza
 *   npm run agentes -- prender cobranza
 *   npm run agentes -- aprobar cobranza     (aprueba la versión de origin/main)
 *   npm run agentes -- tope 4
 *   npm run agentes -- clave cobranza       (le da login al rol y arma su conexión)
 *
 * Habla con PRODUCCIÓN por la Management API, con el mismo
 * SUPABASE_ACCESS_TOKEN de `npm run go` y `npm run tablero`. Lo mismo se puede
 * hacer con los botones de /admin/agentes.
 *
 * `aprobar` es la regla 7: el dueño aprueba lo que está en `main`. Por eso se
 * niega a aprobar si este checkout no está exactamente en origin/main: la
 * versión que se aprueba tiene que ser la que Vercel va a correr.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

import { consultar } from "./lib/api-supabase.mjs";

const REF = "dirugpkamzgvyshcnsxs";
const AGENTES = ["reportes", "cobranza", "activacion", "soporte", "retencion", "contenido"];

function leer(nombre) {
  if (process.env[nombre]) return process.env[nombre].trim();
  try {
    return fs
      .readFileSync(".env.local", "utf8")
      .match(new RegExp(`^${nombre}=(.*)$`, "m"))?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

function salir(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

const literal = (texto) => `'${String(texto).replace(/'/g, "''")}'`;

function quien() {
  try {
    return `cli:${execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim() || "dueño"}`;
  } catch {
    return "cli:dueño";
  }
}

function exigirAgente(agente) {
  if (!AGENTES.includes(agente)) salir(`Agente desconocido: ${agente ?? "(ninguno)"}. Son: ${AGENTES.join(", ")}.`);
  return agente;
}

const [comando, argumento] = process.argv.slice(2);
const token = leer("SUPABASE_ACCESS_TOKEN");
if (!token) salir("Falta SUPABASE_ACCESS_TOKEN (en el entorno o en .env.local).");

const sql = (query) => consultar(REF, token, query);

async function estado() {
  const [fila] = await sql("select public.eos_agentes_panel_v267() as panel");
  const panel = fila?.panel;
  if (!panel) salir("La consulta no devolvió nada. ¿Está aplicada la v267?");
  console.log(`Tope semanal por persona: ${panel.tope_semanal} mensajes\n`);
  for (const a of panel.agentes) {
    console.log(
      `${a.activo ? "PRENDIDO" : "apagado "}  ${a.agente.padEnd(11)} versión ${a.version_aprobada ?? "sin aprobar"}` +
        `  ·  7 días: ${a.corridas_7d} corridas, ${a.errores_7d} errores, ${a.mensajes_7d} mensajes, ${a.bloqueados_tope_7d} frenados por tope` +
        `  ·  mes: USD ${Number(a.costo_mes_usd).toFixed(4)}`,
    );
  }
  const abiertos = panel.escalamientos ?? [];
  console.log(`\nEscalamientos abiertos: ${abiertos.length}`);
  for (const e of abiertos) console.log(`  [${e.prioridad}] ${e.agente}: ${e.motivo} (${e.creado_en})`);
}

async function cambiar(activo) {
  const agente = exigirAgente(argumento);
  await sql(`select public.eos_agentes_cambiar_v267(${literal(agente)}, ${activo}, ${literal(quien())})`);
  console.log(`${agente}: ${activo ? "PRENDIDO" : "apagado"}. Rige desde ahora, sin deploy.`);
}

async function aprobar() {
  const agente = exigirAgente(argumento);
  execFileSync("git", ["fetch", "-q", "origin", "main"]);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const main = execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim();
  const sucio = execFileSync("git", ["status", "--porcelain", "--", "agentes", "lib/agentes"], { encoding: "utf8" }).trim();
  if (head !== main || sucio) {
    salir(
      "Este checkout no está en origin/main (o tiene cambios en agentes/). Solo se aprueba lo que está en main:\n" +
        "  git fetch && git checkout --detach origin/main",
    );
  }
  const { calcularVersion } = await import("../lib/agentes/versiones.ts");
  const version = calcularVersion(agente);
  await sql(
    `select public.eos_agentes_aprobar_v267(${literal(agente)}, ${literal(version)}, ${literal(quien())})`,
  );
  console.log(`${agente}: aprobada la versión ${version} (main ${main.slice(0, 8)}).`);
}

async function tope() {
  const n = Number(argumento);
  if (!Number.isInteger(n) || n < 0 || n > 50) salir("El tope es un número entero entre 0 y 50.");
  await sql(`select public.eos_agentes_tope_v267(${n}, ${literal(quien())})`);
  console.log(`Tope semanal: ${n} mensajes por persona, sumando todos los agentes.`);
}

async function clave() {
  const agente = exigirAgente(argumento);
  const contrasena = randomBytes(24).toString("base64url");
  await sql(`alter role ${"agente_" + agente} with login password ${literal(contrasena)}`);
  const variable = `AGENTE_${agente.toUpperCase()}_DB_URL`;
  console.log(
    `El rol agente_${agente} ya puede entrar. Cargá esto en Vercel (Production) como ${variable}:\n\n` +
      `  postgresql://agente_${agente}.${REF}:${contrasena}@<HOST_DEL_POOLER>:6543/postgres\n\n` +
      "<HOST_DEL_POOLER> es el del \"Transaction pooler\" en Supabase → Connect (aws-0-<región>.pooler.supabase.com).\n" +
      "La clave no queda guardada en ningún otro lado: si se pierde, se corre esto de nuevo.",
  );
}

const comandos = { estado, apagar: () => cambiar(false), prender: () => cambiar(true), aprobar, tope, clave };
const elegido = comandos[comando];
if (!elegido) salir(`Uso: npm run agentes -- <${Object.keys(comandos).join("|")}> [agente|número]`);
await elegido();
