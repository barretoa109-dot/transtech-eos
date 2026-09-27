-- EOS — Informe de impacto mensual (fila R1 de docs/estrategia/hoja-de-ruta-impacto-2026-09-27.md).
--
-- El día 1 de cada mes (con reintento hasta el 5) cada cuenta que hizo algo
-- con EOS recibe lo que EOS hizo por ella el mes anterior, con sus números.
-- Dos piezas, mismo patrón que los correos motivacionales (v188):
--
-- 1. `eos_informes_impacto_v206`: un informe como máximo por cuenta y por mes.
--    El UNIQUE (usuario_id, periodo) es la idempotencia; se reclama la fila
--    ANTES de mandar. Guarda además `datos`, los números exactos que se le
--    mandaron: si alguien pregunta "¿de dónde salió este número?", la
--    respuesta está en la fila y no hay que recalcular un mes que ya cambió.
--    El tablero interno sale de esta misma tabla: lo que se festeja adentro es
--    lo mismo que se le mostró al cliente.
--
-- 2. `informe_impacto` en `eos_followup_preferences`: la baja propia de este
--    correo. Es distinta de la de los motivacionales a propósito: quien se
--    cansó del correo de ánimo puede querer igual su resumen del mes.

create table if not exists public.eos_informes_impacto_v206 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  periodo text not null check (periodo ~ '^[0-9]{4}-[0-9]{2}$'),
  datos jsonb not null default '{}'::jsonb,
  enviado_en timestamptz not null default now(),

  unique (usuario_id, periodo)
);

create index if not exists eos_informes_impacto_periodo_idx
  on public.eos_informes_impacto_v206 (periodo);

comment on table public.eos_informes_impacto_v206 is
  'Un informe de impacto como máximo por cuenta y por mes (periodo YYYY-MM). datos = los números exactos que se enviaron.';

alter table public.eos_informes_impacto_v206 enable row level security;

-- Solo lectura para el dueño; escribe únicamente el server con service_role.
drop policy if exists informes_impacto_select on public.eos_informes_impacto_v206;
create policy informes_impacto_select on public.eos_informes_impacto_v206
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on public.eos_informes_impacto_v206 from anon;

alter table public.eos_followup_preferences
  add column if not exists informe_impacto boolean not null default true;

comment on column public.eos_followup_preferences.informe_impacto is
  'false = la persona se dio de baja del informe de impacto mensual (enlace de baja del propio correo). Sin fila = recibe.';
