begin;

-- EOS 4.0 RC1 v54
-- Defense-in-depth for legacy public tables that are currently empty and have
-- no detected application, SQL-object, trigger, or view consumers.
--
-- Keep the tables intact for compatibility/recovery, but prevent direct access
-- from PUBLIC / anon / authenticated. service_role and object owners are not
-- modified by this migration.
--
-- Intentionally NOT included:
--   - score_usuario: contains historical rows.
--   - eos_workspace_items: contains historical rows and prior activity.
--   - diagnosticos / eos_documents / eos_intelligence / funciones_eos /
--     memorias / permisos_plan / uso_mensual: active SQL/runtime consumers.

revoke all privileges on table public.clientes from public, anon, authenticated;
revoke all privileges on table public.contexto_usuario from public, anon, authenticated;
revoke all privileges on table public.documentos_generados from public, anon, authenticated;
revoke all privileges on table public.eos_actions from public, anon, authenticated;
revoke all privileges on table public.eos_activity from public, anon, authenticated;
revoke all privileges on table public.eos_dashboard_metrics from public, anon, authenticated;
revoke all privileges on table public.eos_finance_records from public, anon, authenticated;
revoke all privileges on table public.perfiles from public, anon, authenticated;

commit;
