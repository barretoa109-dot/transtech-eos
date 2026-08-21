-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

revoke insert, update on table public.eos_intelligence_score_snapshots_v10 from authenticated;

drop policy if exists eos_intelligence_score_insert_own on public.eos_intelligence_score_snapshots_v10;
drop policy if exists eos_intelligence_score_update_own on public.eos_intelligence_score_snapshots_v10;

grant select on table public.eos_intelligence_score_snapshots_v10 to authenticated;
grant all on table public.eos_intelligence_score_snapshots_v10 to service_role;

comment on table public.eos_intelligence_score_snapshots_v10 is
  'EOS Intelligence Score history. RC1 v58: authenticated users can read only their own snapshots; writes are server-owned via service_role.';

commit;
