#!/usr/bin/env node
/**
 * ¿Está EOS en GO? Contra PRODUCCIÓN, con evidencia, sin interpretar a nadie.
 *
 *   npm run go
 *
 * Corre desde la carpeta del repo, en la PC que tiene `supabase link` hecho.
 * Lee de .env.local (o del entorno):
 *
 *   SUPABASE_ACCESS_TOKEN   obligatorio: token personal de Supabase
 *   CRON_SECRET             opcional: solo agrega el detalle de la salud
 *   EOS_GO_URL              opcional; por defecto https://www.transtech.com.py
 *
 * No escribe nada en producción: la prueba de aislamiento corre dentro de una
 * transacción que termina abortada (se deshace entera), y el resto son lecturas.
 *
 * Cada fila dice ok / FALLA y por qué. Sale con código 0 solo si todo está ok.
 * Lo que no se puede medir automáticamente (probar en un iPhone, el trámite de
 * Bancard) se lista al final como manual: GO oficial = esto en verde + eso
 * hecho.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { filasDelError, sqlParaApi } from "./lib/aislamiento.mjs";

const REF = "dirugpkamzgvyshcnsxs";
const URL_BASE = (leer("EOS_GO_URL") || "https://www.transtech.com.py").replace(/\/$/, "");

function leer(nombre) {
  if (process.env[nombre]) return process.env[nombre].trim();
  try {
    const env = fs.readFileSync(".env.local", "utf8");
    return env
      .match(new RegExp(`^${nombre}=(.*)$`, "m"))?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const resultados = [];
function anotar(nombre, ok, detalle) {
  resultados.push({ nombre, ok, detalle });
  console.log(`${ok ? "ok   " : "FALLA"}  ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

async function sql(query) {
  const token = leer("SUPABASE_ACCESS_TOKEN");
  if (!token) throw new Error("falta SUPABASE_ACCESS_TOKEN");
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function paso(nombre, fn) {
  try {
    await fn();
  } catch (e) {
    anotar(nombre, false, e instanceof Error ? e.message : String(e));
  }
}

console.log(`Verificando GO contra ${URL_BASE}\n`);

// ------------------------------------------------------------------
// 1. Código: lo que está en producción es main
// ------------------------------------------------------------------
let commitMain = null;
try {
  execFileSync("git", ["fetch", "-q", "origin", "main"], { stdio: "ignore" });
  commitMain = execFileSync("git", ["rev-parse", "origin/main"]).toString().trim();
} catch {
  // Sin git no se compara; se informa abajo.
}

await paso("Producción corre el último main", async () => {
  const r = await fetch(`${URL_BASE}/api/version`, { cache: "no-store" });
  if (r.status === 404) throw new Error("producción todavía no tiene los cambios de Production GO (falta unir el PR)");
  const d = await r.json();
  const coincide = commitMain ? commitMain.startsWith(String(d.commit)) : true;
  anotar(
    "Producción corre el último main",
    d.entorno === "production" && coincide,
    `entorno=${d.entorno} commit=${d.commit}${commitMain ? ` · main=${commitMain.slice(0, 12)}` : ""}`,
  );

  // Informativo, no cambia el GO: qué etapa del gateway en TypeScript atiende.
  if (typeof d.gateway === "number") {
    const que = ["todo en n8n", "conversación pura", "conversación y acciones", "conversación, acciones y worker"];
    console.log(`       Gateway en TypeScript: etapa ${d.gateway} (${que[d.gateway] ?? "?"})`);
  }
});

// ------------------------------------------------------------------
// 2. Base: v197 aplicada, RLS en todo, aislamiento A/B
// ------------------------------------------------------------------
await paso("v197 aplicada (el plan no se autoasigna)", async () => {
  const filas = await sql(
    "select count(*)::int as n from pg_trigger where tgname = 'usuarios_proteger_comercial_v197' and tgrelid = 'public.usuarios'::regclass",
  );
  anotar(
    "v197 aplicada (el plan no se autoasigna)",
    filas[0]?.n === 1,
    filas[0]?.n === 1 ? "" : "falta `npx supabase db push --include-all`",
  );
});

await paso("Toda tabla de public tiene RLS", async () => {
  const filas = await sql(
    "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1",
  );
  anotar("Toda tabla de public tiene RLS", filas.length === 0, filas.length ? filas.map((f) => f.relname).join(", ") : "");
});

await paso("Aislamiento entre cuentas (24 comprobaciones)", async () => {
  // Por la Management API, como el resto. La prueba termina en ROLLBACK, y la
  // API (igual que `supabase db query --linked`) solo devuelve la última
  // sentencia: las filas vuelven dentro del error que aborta la transacción.
  // Ver scripts/lib/aislamiento.mjs.
  const token = leer("SUPABASE_ACCESS_TOKEN");
  if (!token) throw new Error("falta SUPABASE_ACCESS_TOKEN");
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sqlParaApi(fs.readFileSync("supabase/pruebas/aislamiento_rls_e2e.sql", "utf8")) }),
  });
  const texto = await r.text();
  const filas = filasDelError(texto);
  if (!filas) throw new Error(`la prueba no devolvió resultados: HTTP ${r.status} ${texto.slice(0, 300)}`);
  const malas = filas.filter((f) => f.ok !== true);
  anotar(
    "Aislamiento entre cuentas (24 comprobaciones)",
    filas.length === 24 && malas.length === 0,
    malas.length ? malas.map((f) => f.prueba).join(" | ") : `${filas.length}/24`,
  );
});

// ------------------------------------------------------------------
// 3. n8n habla con producción: el gate de producción recibe autorizaciones
// ------------------------------------------------------------------
await paso("n8n autoriza contra producción", async () => {
  const [f] = await sql(`
    select
      (select max(created_at) from public.eos_worker_gate_audit_v15) as ultimo_gate,
      (select count(*)::int from public.mensajes where rol = 'usuario' and created_at > now() - interval '72 hours') as mensajes_72h,
      (select count(*)::int from public.eos_worker_gate_audit_v15 where created_at > now() - interval '72 hours') as gate_72h`);
  const ok = f.mensajes_72h === 0 || f.gate_72h > 0;
  anotar(
    "n8n autoriza contra producción",
    ok,
    `${f.gate_72h} autorizaciones y ${f.mensajes_72h} mensajes en 72 h; última ${f.ultimo_gate ?? "nunca"}` +
      (ok ? "" : " — revisar EOS_APP_BASE_URL en Railway"),
  );
});

// ------------------------------------------------------------------
// 4. Salud de producción
// ------------------------------------------------------------------
await paso("Salud de producción", async () => {
  // Sin CRON_SECRET la salud contesta igual si está sana o no (200/503), sin
  // el detalle. Con el secreto, dice qué chequeo falló.
  const secreto = leer("CRON_SECRET");
  const r = await fetch(`${URL_BASE}/api/internal/salud`, {
    headers: secreto ? { Authorization: `Bearer ${secreto}` } : {},
  });
  const cuerpo = await r.json().catch(() => ({}));
  const fallos = (cuerpo.chequeos ?? []).filter((c) => !c.ok);
  anotar(
    "Salud de producción",
    r.ok && cuerpo.sano === true,
    fallos.length
      ? fallos.map((c) => `${c.nombre}: ${c.detalle}`).join(" | ")
      : cuerpo.sano === true
        ? "sana"
        : `HTTP ${r.status}${secreto ? "" : " (el detalle se ve en /api/admin/salud con tu sesión de administrador)"}`,
  );
});

await paso("Cobros: sin pagos pendientes viejos", async () => {
  const [f] = await sql(`
    select count(*)::int as n from public.solicitudes_pago
    where proveedor = 'bancard' and estado = 'pendiente'
      and (metadata->>'cobro_incierto') = 'true' and created_at < now() - interval '1 hour'`);
  anotar("Cobros: sin pagos pendientes viejos", f.n === 0, f.n ? `${f.n} cobros inciertos sin resolver` : "");
});

await paso("Webhook de Bancard rechaza basura", async () => {
  const r = await fetch(`${URL_BASE}/api/pagos/bancard/confirmacion`, { method: "POST", body: "{}" });
  anotar("Webhook de Bancard rechaza basura", r.status === 400, `HTTP ${r.status}`);
});

await paso("Sin sesión no hay datos", async () => {
  const r = await fetch(`${URL_BASE}/api/finanzas/estado`, { redirect: "manual" });
  anotar("Sin sesión no hay datos", r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400), `HTTP ${r.status}`);
});

// ------------------------------------------------------------------
const fallas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallas.length}/${resultados.length} automáticos en verde.`);
console.log(`
Manual (no se puede medir desde acá; anotá la fecha al hacerlo en docs/lanzamiento/production-go-2026-09-24.md):
  [ ] npm run certificar -- 3 6 11     (cobro, vencimiento y reversión con Bancard staging)
  [ ] iPhone Safari + Android Chrome: registro, chat, micrófono (negar permiso, cancelar, volver a escribir), PWA
  [ ] Dos cuentas QA reales: A registra una venta por chat; B no la ve; A la ve en Negocios
`);
console.log(fallas.length === 0 ? "RESULTADO AUTOMÁTICO: GO" : "RESULTADO AUTOMÁTICO: NO-GO");
process.exit(fallas.length === 0 ? 0 : 1);
