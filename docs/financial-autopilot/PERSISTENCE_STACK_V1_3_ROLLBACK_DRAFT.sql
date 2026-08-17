-- EOS Financial Autopilot v1.3 — complete persistence stack rollback draft
-- NON-PRODUCTION REHEARSAL ONLY.
-- DO NOT APPLY TO PRODUCTION DURING THE EOS 4.0 RC1 FREEZE.
--
-- This rollback deliberately preserves the shared pgcrypto extension and
-- auth.users. It removes only the Financial Autopilot draft functions, private
-- helpers, policies/indexes owned by their tables, and persistence tables.
-- No CASCADE is used: an unexpected new dependency must stop the rollback so
-- it can be reviewed instead of being deleted silently.

begin;

drop function if exists
  public.eos_financial_persist_multi_provider_v1_3(uuid, jsonb);
drop function if exists public.eos_financial_persist_snapshot_v1_3(uuid, jsonb);
drop function if exists public.eos_financial_persist_snapshot_v1_2(uuid, jsonb);
drop function if exists public.eos_financial_persist_snapshot_v1_1(uuid, jsonb);
drop function if exists public.eos_financial_persist_snapshot_v1(uuid, jsonb);

drop table if exists public.eos_financial_global_context_commits_v1_3;
drop table if exists public.eos_financial_multi_provider_plans_v1_3;
drop table if exists public.eos_financial_provider_scopes_v1_3;
drop table if exists public.eos_financial_contexts_v1;
drop table if exists public.eos_financial_obligations_v1;
drop table if exists public.eos_financial_recurrences_v1;
drop table if exists public.eos_financial_reconciliations_v1;
drop table if exists public.eos_financial_ledger_v1;
drop table if exists public.eos_financial_ingestion_events_v1;
drop table if exists public.eos_financial_accounts_v1;
drop table if exists public.eos_financial_connections_v1;
drop table if exists public.eos_financial_constitutions_v1;

drop function if exists eos_private.eos_financial_canonical_iso_v1(text);
drop function if exists eos_private.eos_financial_sha256_json_v1(jsonb);
drop function if exists eos_private.eos_financial_canonical_json_v1(jsonb);
drop schema if exists eos_private;

commit;
