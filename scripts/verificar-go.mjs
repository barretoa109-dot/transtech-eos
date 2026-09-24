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
 * transacción que termina en ROLLBACK, y el resto son lecturas.
 *
 * Cada fila dice ok / FALLA y por qué. Sale con código 0 solo si todo está ok.
 * Lo que no se puede medir automáticamente (probar en un iPhone, el trámite de
 * Bancard) se lista al final como manual: GO oficial = esto en verde + eso
 * hecho.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

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
  if (!r.ok) {
    const crudo = await r.text();
    let mensaje = crudo;
    try {
      mensaje = JSON.parse(crudo).message ?? crudo;
    } catch {
      // No era JSON: queda el texto tal cual.
    }
    const error = new Error(`HTTP ${r.status}: ${mensaje.slice(0, 300)}`);
    error.mensajeCompleto = mensaje;
    throw error;
  }
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

  let ok = d.entorno === "production";
  let detalle = `entorno=${d.entorno} commit=${d.commit}`;

  if (commitMain && !commitMain.startsWith(String(d.commit))) {
    /*
     * Producción no está en el último main. Si lo que falta desplegar son solo
     * cosas que no llegan al sitio (scripts, docs, pruebas), no importa; si
     * falta código de la app, sí: esperar a que Vercel termine y repetir.
     */
    let pendientes = [];
    try {
      pendientes = execFileSync("git", ["diff", "--name-only", String(d.commit), commitMain])
        .toString()
        .split("\n")
        .filter(Boolean);
    } catch {
      pendientes = ["(no se pudo comparar)"];
    }
    const deLaApp = pendientes.filter(
      (f) => !/^(scripts|docs|supabase\/pruebas|certificacion|evals|n8n)\//.test(f) && !f.endsWith(".md"),
    );
    ok = ok && deLaApp.length === 0;
    detalle +=
      deLaApp.length === 0
        ? ` · main=${commitMain.slice(0, 12)} solo difiere en scripts/docs`
        : ` · main=${commitMain.slice(0, 12)}: falta desplegar ${deLaApp.slice(0, 5).join(", ")} — esperá que Vercel diga Ready y repetí`;
  }

  anotar("Producción corre el último main", ok, detalle);
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
  /*
   * La prueba termina LANZANDO un error con los resultados adentro, en vez de
   * `select … ; rollback`. Dos motivos: la API solo devuelve el último
   * resultado (que sería el del rollback, vacío), y un error deshace la
   * transacción entera pase lo que pase: es imposible que queden las cuentas
   * de prueba escritas en producción.
   */
  const archivo = fs.readFileSync("supabase/pruebas/aislamiento_rls_e2e.sql", "utf8");
  const corte = archivo.lastIndexOf("select prueba, ok from resultado;");
  if (corte < 0) throw new Error("la prueba no tiene el select final esperado");
  const query =
    archivo.slice(0, corte) +
    "do $$ begin raise exception 'RESULTADO:%', (select jsonb_agg(r)::text from resultado r); end $$;";

  let mensaje = "";
  try {
    await sql(query);
    throw new Error("la prueba terminó sin devolver resultados");
  } catch (e) {
    mensaje = e?.mensajeCompleto ?? (e instanceof Error ? e.message : String(e));
  }

  const inicio = mensaje.indexOf("RESULTADO:");
  if (inicio < 0) throw new Error(mensaje.slice(0, 300));
  const texto = mensaje.slice(inicio + "RESULTADO:".length);
  const filas = JSON.parse(texto.slice(0, texto.lastIndexOf("]") + 1));
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
