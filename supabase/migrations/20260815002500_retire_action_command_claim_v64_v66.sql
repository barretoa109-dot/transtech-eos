begin;

revoke execute on function public.eos_claim_action_command_v64(uuid, integer)
  from public, anon, authenticated, service_role;

comment on function public.eos_claim_action_command_v64(uuid, integer) is
  'RETIRED by RC1 v66. Runtime Worker ownership must use eos_claim_action_command_v65 with a fencing token.';

commit;
