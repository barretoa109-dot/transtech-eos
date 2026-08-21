-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

alter function public.eos_actualizar_updated_at()
  set search_path = '';

alter function public.eos_periodo_actual()
  set search_path = '';

revoke all on function public.eos_actualizar_updated_at()
  from public, anon, authenticated;
grant execute on function public.eos_actualizar_updated_at()
  to service_role;

comment on function public.eos_actualizar_updated_at() is
  'Trigger interno con search_path inmutable y RPC cliente revocado.';
comment on function public.eos_periodo_actual() is
  'Helper estable de periodo comercial con search_path inmutable.';

commit;
