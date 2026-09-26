#!/usr/bin/env node
/**
 * El piloto, cuenta por cuenta: a quién llamar hoy y por qué.
 *
 *   npm run piloto
 *
 * Lee PRODUCCIÓN por la Management API (solo lectura), con el mismo
 * SUPABASE_ACCESS_TOKEN de `npm run go` (en .env.local o en el entorno).
 * Solo cuentas reales (`eos_cuentas_v172`): sin QA ni certificación.
 *
 * Para correr una vez por día durante el piloto. Las primeras filas son las
 * urgentes; el criterio está en `scripts/lib/piloto.mjs`. Muestra nombre y
 * correo porque sirve para contactarlos: no pegues la salida en ningún lado.
 */

import fs from "node:fs";

import { PYG_POR_USD_POR_DEFECTO, evaluarCuenta, lineaDeConsumo } from "./lib/piloto.mjs";

const REF = "dirugpkamzgvyshcnsxs";

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

export const CONSULTA = `
with reales as (
  select usuario_id from public.eos_cuentas_v172 where tipo = 'real'
),
m7 as (
  select usuario_id,
         count(*) filter (where rol = 'usuario')::int as mensajes_7d,
         count(*) filter (where rol = 'usuario' and origen = 'whatsapp')::int as whatsapp_7d
  from public.mensajes
  where created_at > (now() at time zone 'utc') - interval '7 days'
  group by 1
),
a7 as (
  select usuario_id,
         count(*) filter (where estado = 'completada')::int as acciones_ok_7d,
         count(*) filter (where estado = 'error')::int as acciones_error_7d
  from public.eos_action_commands
  where created_at > now() - interval '7 days'
  group by 1
)
select r.usuario_id,
       u.nombre,
       u.email,
       u.whatsapp,
       coalesce(u.plan, 'free') as plan,
       an.registro,
       an.primera_accion_ok,
       an.ultimo_mensaje,
       coalesce(an.acciones_ok, 0)::int as acciones_ok_total,
       coalesce(m7.mensajes_7d, 0) as mensajes_7d,
       coalesce(m7.whatsapp_7d, 0) as whatsapp_7d,
       coalesce(a7.acciones_ok_7d, 0) as acciones_ok_7d,
       coalesce(a7.acciones_error_7d, 0) as acciones_error_7d,
       coalesce(um.costo_estimado_usd, 0)::float as costo_mes_usd,
       coalesce(um.mensajes_usados, 0)::int as mensajes_mes
from reales r
left join public.usuarios u on u.id = r.usuario_id
left join public.eos_analitica_usuario_v172 an on an.usuario_id = r.usuario_id
left join m7 on m7.usuario_id = r.usuario_id
left join a7 on a7.usuario_id = r.usuario_id
left join public.uso_mensual um on um.usuario_id = r.usuario_id and um.periodo = public.eos_periodo_actual()
order by an.registro desc nulls last`;

function cuando(valor) {
  if (!valor) return "—";
  const t = String(valor).replace(" ", "T");
  return t.slice(0, 16).replace("T", " ");
}

async function main() {
  const token = leer("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    console.error("Falta SUPABASE_ACCESS_TOKEN (en .env.local o en el entorno). Es el mismo de `npm run go`.");
    process.exit(1);
  }

  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: CONSULTA }),
  });
  if (!r.ok) {
    console.error(`No se pudo leer producción: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    process.exit(1);
  }

  const filas = (await r.json()).map((f) => ({ ...f, ...evaluarCuenta(f) }));
  const pygPorUsd = Number(leer("EOS_PYG_POR_USD")) > 0 ? Number(leer("EOS_PYG_POR_USD")) : PYG_POR_USD_POR_DEFECTO;
  filas.sort((a, b) => b.nivel - a.nivel);

  console.log(`Piloto: ${filas.length} cuentas reales · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n`);

  for (const f of filas) {
    const contacto = [f.email, f.whatsapp].filter(Boolean).join(" · ") || f.usuario_id.slice(0, 8);
    console.log(`${f.estado.padEnd(10)} ${f.nombre || "(sin nombre)"} — ${contacto}`);
    console.log(`           ${f.motivo}`);
    console.log(
      `           plan ${f.plan} · alta ${cuando(f.registro)} · último mensaje ${cuando(f.ultimo_mensaje)} · ` +
        `7 días: ${f.mensajes_7d} mensajes (${f.whatsapp_7d} por WhatsApp), ${f.acciones_ok_7d} acciones bien, ${f.acciones_error_7d} con error`,
    );
    console.log(`           ${lineaDeConsumo(f.costo_mes_usd, f.mensajes_mes, pygPorUsd)}`);
    console.log("");
  }

  const urgentes = filas.filter((f) => f.nivel >= 2).length;
  console.log(
    urgentes === 0
      ? "Nadie para contactar hoy."
      : `${urgentes} cuenta${urgentes === 1 ? "" : "s"} para contactar hoy (arriba de todo).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("informe-piloto.mjs")) {
  await main();
}
