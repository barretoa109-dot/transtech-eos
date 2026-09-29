#!/usr/bin/env node
/**
 * Por qué se fue: los primeros pasos de cada cuenta real que no llegó a usar EOS.
 *
 *   npm run primeros-pasos
 *
 * `npm run piloto` dice A QUIÉN llamar. Esto dice QUÉ LE PASÓ: en qué paso del
 * onboarding quedó, si vinculó WhatsApp, sus primeros mensajes con lo que EOS
 * contestó, y cada acción que EOS intentó (con el error, si lo hubo).
 *
 * POR QUÉ EXISTE. El 29/09/2026, de 6 cuentas reales una sola usaba EOS. Dos
 * nunca mandaron un mensaje y tres escribieron de 1 a 6 el primer día, sin una
 * sola acción, y no volvieron. Con esos números no se puede saber si falló el
 * producto (EOS no entendió, no hizo, contestó largo) o la llegada (nadie les
 * dijo qué hacer primero). Esto es lo que hay que leer para saberlo.
 *
 * Entran las cuentas reales sin ninguna acción exitosa, o sin mensajes en 7
 * días. Con un correo como argumento, solo esa cuenta:
 *
 *   npm run primeros-pasos -- persona@correo.com
 *
 * Lee PRODUCCIÓN por la Management API (solo lectura), con el mismo
 * SUPABASE_ACCESS_TOKEN de `npm run piloto`. MUESTRA LO QUE ESCRIBIERON
 * PERSONAS REALES: es para leerlo y entender, no para guardarlo ni pegarlo en
 * ningún lado público.
 */

import fs from "node:fs";

import { consultar } from "./lib/api-supabase.mjs";

const REF = "dirugpkamzgvyshcnsxs";
const MENSAJES_POR_CUENTA = 12;
const LARGO = 280;

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

const literal = (texto) => `'${String(texto).replace(/'/g, "''")}'`;

function consulta(correo) {
  const filtro = correo
    ? `lower(u.email) = lower(${literal(correo)})`
    : `(an.primera_accion_ok is null or an.ultimo_mensaje is null
        or an.ultimo_mensaje < now() - interval '7 days')`;

  return `
with elegidas as (
  select r.usuario_id
  from public.eos_cuentas_v172 r
  left join public.usuarios u on u.id = r.usuario_id
  left join public.eos_analitica_usuario_v172 an on an.usuario_id = r.usuario_id
  where r.tipo = 'real' and ${filtro}
)
select
  e.usuario_id,
  u.nombre,
  u.email,
  coalesce(u.plan, 'free') as plan,
  an.registro as alta,
  ob.paso as onboarding,
  w.telefono is not null as whatsapp_pedido,
  w.verificado_at as whatsapp_verificado,
  (select count(*)::int from public.mensajes m where m.usuario_id = e.usuario_id and m.rol = 'usuario') as mensajes_total,
  (select coalesce(json_agg(x order by x.created_at), '[]'::json) from (
     select m.created_at, m.rol, m.origen, left(m.texto, ${LARGO}) as texto
     from public.mensajes m
     where m.usuario_id = e.usuario_id
     order by m.created_at
     limit ${MENSAJES_POR_CUENTA}
   ) x) as mensajes,
  (select coalesce(json_agg(y order by y.created_at), '[]'::json) from (
     select c.created_at, c.accion, c.estado, c.error_code, left(c.error_message, 200) as error_message
     from public.eos_action_commands c
     where c.usuario_id = e.usuario_id and c.accion <> 'RESPONDER'
     order by c.created_at
     limit 20
   ) y) as acciones
from elegidas e
left join public.usuarios u on u.id = e.usuario_id
left join public.eos_analitica_usuario_v172 an on an.usuario_id = e.usuario_id
left join public.eos_onboarding ob on ob.usuario_id = e.usuario_id
left join public.eos_whatsapp_vinculos_v162 w on w.usuario_id = e.usuario_id
order by an.registro desc nulls last`;
}

const cuando = (valor) => (valor ? String(valor).replace("T", " ").slice(0, 16) : "—");
const plano = (texto) => String(texto ?? "").replace(/\s+/g, " ").trim();

async function main() {
  const token = leer("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    console.error("Falta SUPABASE_ACCESS_TOKEN (en .env.local o en el entorno). Es el mismo de `npm run piloto`.");
    process.exit(1);
  }

  const correo = process.argv[2];
  const filas = await consultar(REF, token, consulta(correo));

  if (!filas.length) {
    console.log(correo ? `No hay una cuenta real con el correo ${correo}.` : "Todas las cuentas reales ya hicieron algo útil con EOS.");
    return;
  }

  for (const f of filas) {
    const whatsapp = f.whatsapp_verificado
      ? `vinculado ${cuando(f.whatsapp_verificado)}`
      : f.whatsapp_pedido
        ? "pidió el código y no lo confirmó"
        : "no vinculado";

    console.log("=".repeat(78));
    console.log(`${f.nombre || "(sin nombre)"} — ${f.email} · plan ${f.plan}`);
    console.log(`alta ${cuando(f.alta)} · onboarding: ${f.onboarding ?? "sin fila"} · WhatsApp: ${whatsapp}`);
    console.log(`mensajes escritos en total: ${f.mensajes_total}`);

    if (!f.mensajes.length) {
      console.log("\n  (nunca escribió)");
    } else {
      console.log("");
      for (const m of f.mensajes) {
        const quien = m.rol === "usuario" ? "PERSONA" : "EOS    ";
        console.log(`  ${cuando(m.created_at)} ${quien} [${m.origen ?? "web"}] ${plano(m.texto)}`);
      }
    }

    if (f.acciones.length) {
      console.log("\n  acciones:");
      for (const a of f.acciones) {
        const error = a.error_code || a.error_message ? ` — ${plano([a.error_code, a.error_message].filter(Boolean).join(": "))}` : "";
        console.log(`  ${cuando(a.created_at)} ${a.accion} ${a.estado}${error}`);
      }
    } else if (f.mensajes.length) {
      console.log("\n  acciones: ninguna (EOS solo conversó)");
    }
    console.log("");
  }
}

await main();
