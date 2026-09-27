-- EOS — el resumen de los lunes (fila D8 de docs/estrategia/plan-diferenciacion-2026-09-27.md).
--
-- Cada lunes, cada cuenta con negocio en marcha recibe cuatro renglones:
-- lo vendido, lo que le deben, lo que se le acaba y UNA cosa para hacer hoy.
-- Mismo patrón que el Informe de impacto (v206):
--
-- 1. `eos_resumenes_semanales_v207`: uno como máximo por cuenta y por semana
--    (`semana` = el lunes). El UNIQUE es la idempotencia; se reclama la fila
--    ANTES de mandar, y `datos` guarda lo que se le mandó.
--
-- 2. `resumen_semanal` en `eos_followup_preferences`: la baja propia de este
--    correo, distinta de la del informe y la de los motivacionales.

create table if not exists public.eos_resumenes_semanales_v207 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  semana date not null check (extract(isodow from semana) = 1),
  datos jsonb not null default '{}'::jsonb,
  enviado_en timestamptz not null default now(),

  unique (usuario_id, semana)
);

create index if not exists eos_resumenes_semanales_semana_idx
  on public.eos_resumenes_semanales_v207 (semana);

comment on table public.eos_resumenes_semanales_v207 is
  'Un resumen de los lunes como máximo por cuenta y por semana (semana = el lunes). datos = lo que se envió.';

alter table public.eos_resumenes_semanales_v207 enable row level security;

-- Solo lectura para el dueño; escribe únicamente el server con service_role.
drop policy if exists resumenes_semanales_select on public.eos_resumenes_semanales_v207;
create policy resumenes_semanales_select on public.eos_resumenes_semanales_v207
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on public.eos_resumenes_semanales_v207 from anon;

alter table public.eos_followup_preferences
  add column if not exists resumen_semanal boolean not null default true;

comment on column public.eos_followup_preferences.resumen_semanal is
  'false = la persona se dio de baja del resumen de los lunes (enlace de baja del propio correo). Sin fila = recibe.';
