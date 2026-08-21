-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

alter table public.eos_goals
  alter column fecha_inicio
  set default ((now() at time zone 'America/Asuncion')::date);

alter table public.eos_intelligence_score_snapshots_v10
  alter column snapshot_day
  set default ((now() at time zone 'America/Asuncion')::date);

alter table public.eos_learning_snapshots_v13
  alter column snapshot_day
  set default ((now() at time zone 'America/Asuncion')::date);

comment on column public.eos_goals.fecha_inicio is
  'Fecha de inicio; default calendario America/Asuncion.';
comment on column public.eos_intelligence_score_snapshots_v10.snapshot_day is
  'Día del snapshot según calendario America/Asuncion.';
comment on column public.eos_learning_snapshots_v13.snapshot_day is
  'Día del snapshot de aprendizaje según calendario America/Asuncion.';

commit;
