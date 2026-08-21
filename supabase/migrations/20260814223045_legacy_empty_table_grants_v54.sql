-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

revoke all privileges on table public.clientes from public, anon, authenticated;
revoke all privileges on table public.contexto_usuario from public, anon, authenticated;
revoke all privileges on table public.documentos_generados from public, anon, authenticated;
revoke all privileges on table public.eos_actions from public, anon, authenticated;
revoke all privileges on table public.eos_activity from public, anon, authenticated;
revoke all privileges on table public.eos_dashboard_metrics from public, anon, authenticated;
revoke all privileges on table public.eos_finance_records from public, anon, authenticated;
revoke all privileges on table public.perfiles from public, anon, authenticated;

commit;
