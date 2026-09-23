-- EOS — Registro propio de excepciones del servidor (punto 11 del plan)
--
-- ============================================================
-- QUÉ PROBLEMA RESUELVE
-- ============================================================
--
-- `/api/internal/salud` vigila respuestas MANEJADAS (un 503, un chat que no
-- contesta). Lo que no ve nadie son las excepciones SIN manejar: un throw en
-- una ruta, un timeout no anticipado, un componente de servidor que revienta.
-- Hoy solo quedan en los logs de Vercel, que nadie mira en tiempo real.
--
-- El plan pedía "Sentry o similar". Sentry necesita una cuenta y un DSN que
-- solo puede crear el usuario (docs/estrategia/error-tracking-sentry.md). Esto
-- es el "similar" que funciona desde el día uno sin nada externo: el hook
-- `onRequestError` de Next (`instrumentation.ts`) guarda cada excepción acá,
-- y el chequeo de salud la muestra. Si mañana se instala Sentry, conviven.
--
-- ============================================================
-- QUÉ SE GUARDA Y QUÉ NO
-- ============================================================
--
-- Se guarda: la clase de error, el mensaje RECORTADO y LIMPIO (sin correos
-- ni números largos), la ruta SIN query string, el tipo de ruta, el método,
-- el digest de React y las primeras líneas de la pila. Nunca el cuerpo del
-- pedido, los headers ni la query: un error no puede ser el camino por el
-- que se filtra el texto de una conversación o un token de un enlace
-- (misma regla que `limpiarDetalle()` de la auditoría). Ver
-- `lib/monitoreo/errores-servidor.ts`.
--
-- Solo service_role lee y escribe. Nada abierto a anon ni a authenticated.

create table if not exists public.eos_errores_servidor_v194 (
  id bigint generated always as identity primary key,
  ocurrido_en timestamptz not null default now(),
  -- Misma huella = mismo error: clase + mensaje sin números + ruta.
  huella text not null,
  clase text not null,
  mensaje text not null,
  ruta text,
  tipo_ruta text,
  metodo text,
  digest text,
  pila text
);

create index if not exists eos_errores_servidor_v194_fecha_idx
  on public.eos_errores_servidor_v194 (ocurrido_en desc);

create index if not exists eos_errores_servidor_v194_huella_idx
  on public.eos_errores_servidor_v194 (huella, ocurrido_en desc);

alter table public.eos_errores_servidor_v194 enable row level security;

revoke all on table public.eos_errores_servidor_v194 from public, anon, authenticated;
grant select, insert, delete on table public.eos_errores_servidor_v194 to service_role;

comment on table public.eos_errores_servidor_v194 is
  'Excepciones sin manejar del servidor, capturadas por instrumentation.ts (onRequestError). Sin cuerpo, headers ni query. Solo service_role. Ver lib/monitoreo/errores-servidor.ts.';

-- Agrupado por huella en las últimas 24 h: lo que lee el chequeo de salud.
create or replace view public.eos_errores_servidor_24h_v194 as
select
  huella,
  max(clase) as clase,
  max(mensaje) as mensaje,
  max(ruta) as ruta,
  count(*) as veces,
  min(ocurrido_en) as primera_vez,
  max(ocurrido_en) as ultima_vez
from public.eos_errores_servidor_v194
where ocurrido_en >= now() - interval '24 hours'
group by huella;

comment on view public.eos_errores_servidor_24h_v194 is
  'Excepciones del servidor de las últimas 24 h agrupadas por huella. Solo service_role.';

revoke all on table public.eos_errores_servidor_24h_v194 from public, anon, authenticated;
grant select on table public.eos_errores_servidor_24h_v194 to service_role;
