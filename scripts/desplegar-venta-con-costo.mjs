#!/usr/bin/env node
/**
 * Desplegar el arreglo del costo en la venta (v198, PR #124), de punta a punta.
 *
 *   npm run desplegar:costo            (hace todo)
 *   SECO=1 npm run desplegar:costo     (solo mira: no escribe nada)
 *
 * Desde la carpeta del repo, en `main` y con el PR ya unido. Lee de .env.local:
 *
 *   SUPABASE_ACCESS_TOKEN   token personal de Supabase (el mismo de `npm run go`)
 *   N8N_BASE_URL            la instancia de n8n (el mismo de los parches)
 *   N8N_API_KEY
 *
 * En orden, y cada paso se comprueba contra producción antes de seguir:
 *
 *   1. La migración v198 en la base. Si ya está, no se toca.
 *   2. El prompt, el nodo 06 del gateway y la frase de la venta en n8n
 *      (`n8n/parches/2026-09-25-venta-con-costo.mjs`). Lo que ya está, se salta.
 *   3. Reexporta los workflows y sincroniza el prompt de TypeScript, para que el
 *      repo diga lo mismo que lo que corre.
 *
 * Correrlo dos veces no rompe nada: la segunda vez todo sale "ya estaba".
 * Sale con código 0 solo si al final las verificaciones dan ok.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { consultar } from "./lib/api-supabase.mjs";

const REF = "dirugpkamzgvyshcnsxs";
const MIGRACION = "supabase/migrations/20260925100000_eos_venta_con_costo_v198.sql";
const VERSION = "20260925100000";
const GATEWAY = "JRgzUkoHBKgGpyPA";
const WORKER = "iUMdg9fhAg54irmy";
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

function correr(script, env = {}) {
  const r = spawnSync(process.execPath, [script], { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) cortar(`${script} terminó con código ${r.status}`);
}

// ------------------------------------------------------------------ 0. antes
paso("0. Antes de empezar");

if (!fs.existsSync(MIGRACION)) {
  cortar(`no está ${MIGRACION}. Uní el PR #124 y hacé: git checkout main && git pull`);
}

const token = leer("SUPABASE_ACCESS_TOKEN");
const faltan = ["SUPABASE_ACCESS_TOKEN", "N8N_BASE_URL", "N8N_API_KEY"].filter((n) => !leer(n));
if (faltan.length) cortar(`faltan en .env.local: ${faltan.join(", ")}`);

console.log(SECO ? "Modo SECO: no se escribe nada, solo se mira." : "Modo real: se aplica en producción.");

const sql = (query) => consultar(REF, token, query);

const ESTADO_BASE = `
  select
    to_regprocedure('public.eos_venta_poner_costo_v198(uuid,uuid,jsonb)') is not null as funcion,
    exists (select 1 from pg_trigger where tgname = 'eos_erp_producto_completa_margenes_v198') as trigger,
    position('eos_venta_poner_costo_v198' in pg_get_functiondef(
      'public.eos_execute_internal_effect_v64(uuid)'::regprocedure)) > 0 as ejecutor
`;

// ------------------------------------------------------------- 1. la base
paso("1. Migración v198 en la base");

let [estado] = await sql(ESTADO_BASE);
if (estado.funcion && estado.trigger && estado.ejecutor) {
  console.log("ya estaba aplicada.");
} else if (SECO) {
  console.log(`falta aplicarla (función ${estado.funcion}, trigger ${estado.trigger}, ejecutor ${estado.ejecutor}).`);
} else {
  // Es idempotente: si quedó a medias, se vuelve a correr entera.
  await sql(fs.readFileSync(MIGRACION, "utf8"));

  // Que `supabase db push` no la intente de nuevo. Si la tabla no existe (no
  // debería), no pasa nada: la migración igual se puede volver a correr.
  await sql(`
    do $$ begin
      if to_regclass('supabase_migrations.schema_migrations') is not null then
        insert into supabase_migrations.schema_migrations (version, name)
        values ('${VERSION}', 'eos_venta_con_costo_v198')
        on conflict (version) do nothing;
      end if;
    end $$;
  `);

  [estado] = await sql(ESTADO_BASE);
  if (!(estado.funcion && estado.trigger && estado.ejecutor)) {
    cortar(`la migración corrió pero no quedó completa: ${JSON.stringify(estado)}`);
  }
  console.log("aplicada y verificada: función, trigger y ejecutor.");
}

const [pendientes] = await sql(`
  select count(*)::int as n
  from public.eos_erp_venta_items vi
  join public.eos_erp_productos p on p.id = vi.producto_id
  where vi.costo_unitario is null and p.costo is not null
`);
console.log(`ventas con costo pendiente cuyo producto ya tiene costo: ${pendientes.n}`);

// ---------------------------------------------------------------- 2. n8n
paso("2. n8n: prompt, nodo 06 y frase de la venta");

correr("n8n/parches/2026-09-25-venta-con-costo.mjs", { SECO: "1" });
if (!SECO) correr("n8n/parches/2026-09-25-venta-con-costo.mjs");

// ------------------------------------------------------ 3. repo = producción
paso("3. Verificar n8n en vivo y reexportar");

const BASE = leer("N8N_BASE_URL").replace(/\/$/, "");
async function flujo(id) {
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: { "X-N8N-API-KEY": leer("N8N_API_KEY") } });
  if (!r.ok) cortar(`n8n respondió ${r.status} al leer ${id}`);
  return r.json();
}
const nodo = (f, nombre) => f.nodes.find((n) => n.name === nombre || n.name.startsWith(nombre))?.parameters ?? {};

const gw = await flujo(GATEWAY);
const wk = await flujo(WORKER);
const vivo = {
  "prompt con costo_unitario": String(nodo(gw, "HTTP Request").jsonBody).includes("costo_unitario?"),
  "nodo 06 copia el costo del texto": String(nodo(gw, "06 GW Preparar Jobs Worker").jsCode).includes("function costoDesdeLaRespuesta"),
  "worker dice el costo puesto": String(nodo(wk, "05 INT Respuesta").jsCode).includes("le puse el costo de"),
};
for (const [que, ok] of Object.entries(vivo)) console.log(`${ok ? "ok   " : SECO ? "falta" : "FALLA"}  ${que}`);

if (SECO) {
  console.log("\nSECO: nada escrito. Si todo lo de arriba se ve bien, corré sin SECO=1.");
  process.exit(0);
}
if (!Object.values(vivo).every(Boolean)) cortar("n8n no quedó con los tres cambios");

correr("n8n/exportar.mjs");
correr("n8n/parches/sincronizar-prompt.mjs");

const cambios = spawnSync("git", ["status", "--porcelain", "n8n/workflows", "lib/gateway/sistema.ts"], { encoding: "utf8" }).stdout.trim();

console.log("\n=== LISTO");
console.log("La base y n8n tienen el arreglo del costo. Probalo: dictale a EOS una venta con costo");
console.log('("vendí 1 campera a 230.000, me costó 207.052") y mirá que la respuesta no pida el costo.');
if (cambios) {
  console.log("\nLo que corre en n8n difiere del repo en:\n" + cambios);
  console.log("Revisalo con `git diff` y, si está bien, commitealo (es el espejo de producción).");
}
