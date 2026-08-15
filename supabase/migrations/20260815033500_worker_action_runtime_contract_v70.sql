begin;

-- Canonical runtime contract:
-- - claim/renew: the v67-compatible implementations kept under the v64 RPC names
-- - terminal result: eos_finalize_action_command_v68, whose body is hardened by v69
-- The experimental v65 token RPCs remain in migration history but are not runtime-callable.

revoke all on function public.eos_claim_action_command_v65(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.eos_renew_action_command_lease_v65(uuid, uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.eos_finish_action_command_v65(uuid, uuid, integer, boolean, jsonb, text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.eos_claim_action_command_v64(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.eos_renew_action_command_lease_v64(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.eos_finish_action_command_v64(uuid, integer, boolean, jsonb, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.eos_claim_action_command_v64(uuid, integer)
  to service_role;
grant execute on function public.eos_renew_action_command_lease_v64(uuid, integer, integer)
  to service_role;

revoke all on function public.eos_finalize_action_command_v68(uuid, integer, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_finalize_action_command_v68(uuid, integer, text, jsonb, text, text)
  to service_role;

comment on function public.eos_claim_action_command_v64(uuid, integer) is
  'RC1 v70 canonical runtime claim. Body is the v67 compatibility implementation using claim:<attempt> fencing events to distinguish legacy bootstrap leases from real Worker ownership.';
comment on function public.eos_renew_action_command_lease_v64(uuid, integer, integer) is
  'RC1 v70 canonical runtime lease renewal, fenced by command attempt_count.';
comment on function public.eos_finalize_action_command_v68(uuid, integer, text, jsonb, text, text) is
  'RC1 v70 canonical terminal finalizer. Body is hardened by v69 and accepts results only for an authorized, claimed, current attempt.';

commit;
