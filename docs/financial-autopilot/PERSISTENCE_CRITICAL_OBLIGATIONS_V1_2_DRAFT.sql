-- EOS Financial Autopilot — Critical Obligation Completeness persistence v1.2
-- DESIGN ONLY. DO NOT APPLY TO PRODUCTION DURING EOS 4.0 RC1 FREEZE.
--
-- Layered on top of:
--   * SCHEMA_V1_DRAFT.sql
--   * PERSISTENCE_RPC_V1_DRAFT.sql
--   * PERSISTENCE_FIRST_FORECAST_RISK_V1_1_DRAFT.sql
--
-- Purpose:
-- Persist the explicit hard safety signal that tells Financial State whether
-- all critical obligations required for SAFE are known. This removes the need
-- for v1.2 readers to infer a hard boolean from obligationCompleteness score.

alter table public.eos_financial_contexts_v1
  add column if not exists critical_obligations_complete boolean not null default false;

create or replace function public.eos_financial_persist_snapshot_v1_2(
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

  if jsonb_typeof(v_context -> 'criticalObligationsComplete') <> 'boolean' then
    raise exception using errcode = '22023', message = 'financial_persistence_invalid_critical_obligations_complete';
  end if;
  v_complete := (v_context ->> 'criticalObligationsComplete')::boolean;

  -- v1.1 performs the complete base snapshot + first forecast risk write in the
  -- same transaction. If any check below fails, PostgreSQL rolls all work back.
  v_result := public.eos_financial_persist_snapshot_v1_1(p_usuario_id, p_batch);

  select c.critical_obligations_complete
    into v_existing_complete
    from public.eos_financial_contexts_v1 c
   where c.usuario_id = p_usuario_id
     and c.revision = v_revision;

  if not found then
    raise exception using errcode = '23503', message = 'financial_context_commit_marker_missing';
  end if;

  -- On replay, a context revision is immutable. A conflicting completeness
  -- signal for the same revision must fail rather than silently rewriting SAFE
  -- evidence.
  if coalesce((v_result ->> 'replayed')::boolean, false)
     and v_existing_complete is distinct from v_complete then
    raise exception using errcode = '23505', message = 'financial_context_critical_obligations_mismatch';
  end if;

  update public.eos_financial_contexts_v1
     set critical_obligations_complete = v_complete
   where usuario_id = p_usuario_id
     and revision = v_revision;

  return v_result;
end;
$$;

revoke all on function public.eos_financial_persist_snapshot_v1_2(uuid, jsonb) from public;
revoke all on function public.eos_financial_persist_snapshot_v1_2(uuid, jsonb) from anon;
revoke all on function public.eos_financial_persist_snapshot_v1_2(uuid, jsonb) from authenticated;
grant execute on function public.eos_financial_persist_snapshot_v1_2(uuid, jsonb) to service_role;

-- Promotion gates:
--   1. apply only to a non-production Supabase branch/project first;
--   2. verify explicit true and false fresh inserts;
--   3. verify exact replay is idempotent and conflicting same-revision replay fails;
--   4. verify malformed/missing boolean fails and rolls back the whole snapshot;
--   5. verify v1.2 owner+revision scoped Financial State reads the exact boolean;
--   6. verify SAFE is impossible when critical_obligations_complete = false;
--   7. verify service_role-only EXECUTE and cross-user isolation;
--   8. rehearse rollback;
--   9. do not apply to production until the EOS 4.0 RC1 freeze is closed.
