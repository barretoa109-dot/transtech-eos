-- EOS Financial Autopilot — Critical Source Coverage persistence v1.3
-- DESIGN ONLY. DO NOT APPLY TO PRODUCTION DURING EOS 4.0 RC1 FREEZE.
--
-- Layered on top of:
--   * SCHEMA_V1_DRAFT.sql
--   * PERSISTENCE_RPC_V1_DRAFT.sql
--   * PERSISTENCE_FIRST_FORECAST_RISK_V1_1_DRAFT.sql
--   * PERSISTENCE_CRITICAL_OBLIGATIONS_V1_2_DRAFT.sql
--
-- Purpose:
-- Persist the explicit hard safety signal that distinguishes "all known sources
-- are fresh" from "EOS knows the material source set is complete enough to
-- claim SAFE". A fresh connected account must not hide a missing material
-- account/card/loan/source.

alter table public.eos_financial_contexts_v1
  add column if not exists critical_sources_complete boolean not null default false;

create or replace function public.eos_financial_persist_snapshot_v1_3(
  p_usuario_id uuid,
  p_batch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_context jsonb;
  v_revision text;
  v_complete boolean;
  v_existing_complete boolean;
  v_status text;
begin
  if p_usuario_id is null then
    raise exception using errcode = '22023', message = 'financial_persistence_missing_user';
  end if;

  if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
    raise exception using errcode = '22023', message = 'financial_persistence_invalid_batch';
  end if;

  v_context := p_batch -> 'contextInsert';
  if v_context is null or jsonb_typeof(v_context) <> 'object' then
    raise exception using errcode = '22023', message = 'financial_persistence_missing_context';
  end if;

  v_revision := nullif(v_context ->> 'revision', '');
  if v_revision is null or v_revision !~ '^ctx:[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'financial_persistence_invalid_context_identity';
  end if;

  if coalesce(jsonb_typeof(v_context -> 'criticalSourcesComplete'), 'null') <> 'boolean' then
    raise exception using errcode = '22023', message = 'financial_persistence_invalid_critical_sources_complete';
  end if;
  v_complete := (v_context ->> 'criticalSourcesComplete')::boolean;
  v_status := nullif(v_context ->> 'status', '');

  if not v_complete and v_status is distinct from 'DEGRADED' then
    raise exception using errcode = '22023', message = 'financial_persistence_critical_sources_conflict_with_status';
  end if;

  -- v1.2 persists the complete base snapshot, forecast-risk extension and
  -- explicit critical-obligation completeness in this same transaction.
  v_result := public.eos_financial_persist_snapshot_v1_2(p_usuario_id, p_batch);

  select c.critical_sources_complete
    into v_existing_complete
    from public.eos_financial_contexts_v1 c
   where c.usuario_id = p_usuario_id
     and c.revision = v_revision;

  if not found then
    raise exception using errcode = '23503', message = 'financial_context_commit_marker_missing';
  end if;

  if coalesce((v_result ->> 'replayed')::boolean, false)
     and v_existing_complete is distinct from v_complete then
    raise exception using errcode = '23505', message = 'financial_context_critical_sources_mismatch';
  end if;

  update public.eos_financial_contexts_v1
     set critical_sources_complete = v_complete
   where usuario_id = p_usuario_id
     and revision = v_revision;

  return v_result;
end;
$$;

revoke all on function public.eos_financial_persist_snapshot_v1_3(uuid, jsonb) from public;
revoke all on function public.eos_financial_persist_snapshot_v1_3(uuid, jsonb) from anon;
revoke all on function public.eos_financial_persist_snapshot_v1_3(uuid, jsonb) from authenticated;
grant execute on function public.eos_financial_persist_snapshot_v1_3(uuid, jsonb) to service_role;

-- Promotion gates:
--   1. apply only to a non-production Supabase branch/project first;
--   2. verify true/false fresh inserts and exact replay;
--   3. verify conflicting same-revision replay fails closed;
--   4. verify missing/malformed boolean rolls back the whole snapshot;
--   5. verify false cannot be persisted with SAFE/ATTENTION/ACTION_REQUIRED;
--   6. verify owner+revision scoped v1.3 reads and integrity commitment;
--   7. verify a fresh known source + incomplete coverage can never produce SAFE;
--   8. verify service_role-only EXECUTE and cross-user isolation;
--   9. rehearse rollback;
--  10. do not apply to production until the EOS 4.0 RC1 freeze is closed.
