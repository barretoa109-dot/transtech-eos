begin;

-- EOS 4.0 RC1 v55
-- Retire the superseded v31 Context Master commit RPC from authenticated use.
-- v33 is the active guarded implementation and adds source_revision validation.
-- Keep v31 defined for rollback/forensics, but remove unnecessary direct exposure.

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
