#!/usr/bin/env node
/**
 * Desplegar "varias fotos son un solo pedido" (v199), de punta a punta.
 *
 *   npm run desplegar:fotos            (hace todo)
 *   SECO=1 npm run desplegar:fotos     (solo mira: no escribe nada)
 *
 * Desde la carpeta del repo, en `main` y con el PR ya unido (el webhook nuevo
 * sale con el deploy de Vercel al unir). Lee de .env.local lo mismo que
 * `npm run desplegar:costo`: SUPABASE_ACCESS_TOKEN, N8N_BASE_URL, N8N_API_KEY.
 *
 *   1. La migración v199 (la sala de espera de WhatsApp). Si ya está, no se toca.
 *   2. El prompt de n8n (`n8n/parches/2026-09-25-varias-fotos.mjs`).
 *   3. Verifica en vivo, reexporta el gateway y sincroniza el prompt de TS.
 *
 * El orden importa poco: sin la v199 el webhook atiende cada mensaje solo,
 * como antes, y no se rompe nada. Correrlo dos veces tampoco.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { consultar } from "./lib/api-supabase.mjs";

const REF = "dirugpkamzgvyshcnsxs";
const MIGRACION = "supabase/migrations/20260925101000_eos_whatsapp_rafaga_v199.sql";
const VERSION = "20260925101000";
const GATEWAY = "JRgzUkoHBKgGpyPA";
const MARCA = "VARIAS IMÁGENES SON UN SOLO PEDIDO";
const SECO = process.env.SECO === "1";

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

function paso(titulo) {
  console.log(`\n=== ${titulo}`);
}

function cortar(motivo) {
  console.error(`\nFALLA: ${motivo}\nNo se siguió con los pasos de abajo. Pegame esta salida y lo arreglo.`);
  process.exit(1);
}

function correr(script, args = [], env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) cortar(`${script} terminó con código ${r.status}`);
}

// ------------------------------------------------------------------ 0. antes
paso("0. Antes de empezar");

if (!fs.existsSync(MIGRACION)) {
  cortar(`no está ${MIGRACION}. Uní el PR y hacé: git checkout main && git pull`);
}

const faltan = ["SUPABASE_ACCESS_TOKEN", "N8N_BASE_URL", "N8N_API_KEY"].filter((n) => !leer(n));
if (faltan.length) cortar(`faltan en .env.local: ${faltan.join(", ")}`);

console.log(SECO ? "Modo SECO: no se escribe nada, solo se mira." : "Modo real: se aplica en producción.");

const sql = (query) => consultar(REF, leer("SUPABASE_ACCESS_TOKEN"), query);

const ESTADO = `
  select
    to_regclass('public.eos_whatsapp_rafaga_v199') is not null as tabla,
    to_regprocedure('public.eos_whatsapp_rafaga_tomar_v199(text,text)') is not null as funcion
`;

// ------------------------------------------------------------- 1. la base
paso("1. Migración v199 en la base");

let [estado] = await sql(ESTADO);
if (estado.tabla && estado.funcion) {
  console.log("ya estaba aplicada.");
} else if (SECO) {
  console.log(`falta aplicarla (tabla ${estado.tabla}, función ${estado.funcion}).`);
} else {
  await sql(fs.readFileSync(MIGRACION, "utf8"));
  await sql(`
    do $$ begin
      if to_regclass('supabase_migrations.schema_migrations') is not null then
        insert into supabase_migrations.schema_migrations (version, name)
        values ('${VERSION}', 'eos_whatsapp_rafaga_v199')
        on conflict (version) do nothing;
      end if;
    end $$;
  `);
  [estado] = await sql(ESTADO);
  if (!(estado.tabla && estado.funcion)) cortar(`la migración corrió pero no quedó completa: ${JSON.stringify(estado)}`);
  console.log("aplicada y verificada: tabla y función.");
}

// ---------------------------------------------------------------- 2. n8n
paso("2. n8n: el prompt");

correr("n8n/parches/2026-09-25-varias-fotos.mjs", [], { SECO: "1" });
if (!SECO) correr("n8n/parches/2026-09-25-varias-fotos.mjs");

// ------------------------------------------------------ 3. repo = producción
paso("3. Verificar en vivo y reexportar");

const r = await fetch(`${leer("N8N_BASE_URL").replace(/\/$/, "")}/api/v1/workflows/${GATEWAY}`, {
  headers: { "X-N8N-API-KEY": leer("N8N_API_KEY") },
});
if (!r.ok) cortar(`n8n respondió ${r.status} al leer el gateway`);
const gw = await r.json();
const enVivo = String(gw.nodes.find((n) => n.name.startsWith("HTTP Request"))?.parameters?.jsonBody).includes(MARCA);
console.log(`${enVivo ? "ok   " : SECO ? "falta" : "FALLA"}  prompt con las reglas de varias imágenes`);

if (SECO) {
  console.log("\nSECO: nada escrito. Si todo lo de arriba se ve bien, corré sin SECO=1.");
  process.exit(0);
}
if (!enVivo) cortar("n8n no quedó con el prompt nuevo");

correr("n8n/exportar.mjs", ["gateway"]);
correr("n8n/parches/sincronizar-prompt.mjs");

const cambios = spawnSync("git", ["status", "--porcelain", "n8n/workflows", "lib/gateway/sistema.ts"], { encoding: "utf8" }).stdout.trim();

console.log("\n=== LISTO");
console.log("Probalo por WhatsApp: mandá 2 capturas juntas con un texto (\"pasame estas prendas a guaraníes,");
console.log("el dólar está a 5.988,99\"). Tiene que llegar UNA respuesta con todas las prendas convertidas.");
if (cambios) {
  console.log("\nLo que corre en n8n difiere del repo en:\n" + cambios);
  console.log("Revisalo con `git diff` y, si está bien, commitealo (es el espejo de producción).");
}
