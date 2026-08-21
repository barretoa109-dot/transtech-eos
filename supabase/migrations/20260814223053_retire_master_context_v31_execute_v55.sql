-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

revoke execute on function public.eos_commit_master_context_v31(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
  jsonb, text, text, jsonb, jsonb, integer
) from authenticated;

revoke execute on function public.eos_commit_master_context_v31(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
  jsonb, text, text, jsonb, jsonb, integer
) from public, anon;

comment on function public.eos_commit_master_context_v31(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
  jsonb, text, text, jsonb, jsonb, integer
) is 'EOS 4.0 v55: legacy v31 retained for rollback/forensics only; authenticated execution retired in favor of source-revision guarded v33.';

commit;
