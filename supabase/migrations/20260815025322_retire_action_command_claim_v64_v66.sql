-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

revoke execute on function public.eos_claim_action_command_v64(uuid, integer)
  from public, anon, authenticated, service_role;

comment on function public.eos_claim_action_command_v64(uuid, integer) is
  'RETIRED by RC1 v66. Runtime Worker ownership must use eos_claim_action_command_v65 with a fencing token.';

commit;
