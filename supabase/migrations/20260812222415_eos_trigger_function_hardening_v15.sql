-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

revoke all on function public.eos_apply_action_event()
  from public, anon, authenticated;
grant execute on function public.eos_apply_action_event()
  to service_role;

revoke all on function public.eos_start_action_command()
  from public, anon, authenticated;
grant execute on function public.eos_start_action_command()
  to service_role;

revoke all on function public.eos_capture_learning_snapshot_v13()
  from public, anon, authenticated;
grant execute on function public.eos_capture_learning_snapshot_v13()
  to service_role;

revoke all on function public.eos_log_approval_decision_v12()
  from public, anon, authenticated;
grant execute on function public.eos_log_approval_decision_v12()
  to service_role;

revoke all on function public.eos_validate_document_child_owner_v11()
  from public, anon, authenticated;
grant execute on function public.eos_validate_document_child_owner_v11()
  to service_role;

comment on function public.eos_apply_action_event() is
  'Trigger interno EOS. RPC público revocado explícitamente en hardening v15.';
comment on function public.eos_start_action_command() is
  'Trigger interno EOS. RPC público revocado explícitamente en hardening v15.';
comment on function public.eos_capture_learning_snapshot_v13() is
  'Trigger interno EOS. RPC público revocado explícitamente en hardening v15.';
comment on function public.eos_log_approval_decision_v12() is
  'Trigger interno EOS. RPC público revocado explícitamente en hardening v15.';
comment on function public.eos_validate_document_child_owner_v11() is
  'Trigger interno EOS. RPC público revocado explícitamente en hardening v15.';

commit;
