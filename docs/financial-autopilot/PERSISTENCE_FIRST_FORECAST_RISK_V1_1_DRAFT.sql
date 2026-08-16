-- EOS Financial Autopilot — First Forecast Risk persistence v1.1
-- DESIGN ONLY. DO NOT APPLY TO PRODUCTION DURING EOS 4.0 RC1 FREEZE.
--
-- Layered on top of:
--   * SCHEMA_V1_DRAFT.sql
--   * PERSISTENCE_RPC_V1_DRAFT.sql
--
-- Purpose:
-- Persist the compact first 30/60/90 forecast risk inside Financial Context so
-- the user-facing Financial State can survive new sessions/restarts without
-- recomputing or reading raw Ledger rows.
--
-- Atomicity:
-- eos_financial_persist_snapshot_v1_1 calls the v1 persistence function inside
-- the same PostgreSQL transaction, then commits first_forecast_risk onto the
-- context row. Any failure in this wrapper rolls the whole transaction back.

alter table public.eos_financial_contexts_v1
  add column if not exists first_forecast_risk jsonb not null default 'null'::jsonb;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'eos_fin_context_first_forecast_risk_shape_chk'
       and conrelid = 'public.eos_financial_contexts_v1'::regclass
  ) then
    alter table public.eos_financial_contexts_v1
      add constraint eos_fin_context_first_forecast_risk_shape_chk
      check (jsonb_typeof(first_forecast_risk) in ('object', 'null'));
  end if;
end
$$;

create or replace function public.eos_financial_persist_snapshot_v1_1(
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
  v_risk jsonb;
  v_existing_risk jsonb;
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

  v_risk := coalesce(v_context -> 'firstForecastRisk', 'null'::jsonb);
  if jsonb_typeof(v_risk) not in ('object', 'null') then
    raise exception using errcode = '22023', message = 'financial_persistence_invalid_first_forecast_risk';
  end if;

  if jsonb_typeof(v_risk) = 'object' then
    if v_risk ->> 'status' not in ('ATTENTION', 'ACTION_REQUIRED') then
      raise exception using errcode = '22023', message = 'financial_persistence_invalid_first_forecast_risk';
    end if;

    if coalesce(v_risk ->> 'horizonDays', '') !~ '^[0-9]+$'
       or (v_risk ->> 'horizonDays')::integer <= 0
       or nullif(v_risk ->> 'until', '') is null
       or coalesce(v_risk ->> 'reserveGapMinor', '') !~ '^[0-9]+$'
       or coalesce(v_risk ->> 'negativeCashGapMinor', '') !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'financial_persistence_invalid_first_forecast_risk';
    end if;

    -- Force timestamptz validation while keeping the persisted JSON compact.
    perform (v_risk ->> 'until')::timestamptz;
  end if;

  -- The v1 function performs Connection -> Context persistence. Nested function
  -- calls participate in this same transaction; failures below roll it all back.
  v_result := public.eos_financial_persist_snapshot_v1(p_usuario_id, p_batch);

  select c.first_forecast_risk
    into v_existing_risk
    from public.eos_financial_contexts_v1 c
   where c.usuario_id = p_usuario_id
     and c.revision = v_revision;

  if not found then
    raise exception using errcode = '23503', message = 'financial_context_commit_marker_missing';
  end if;

  -- Exact replay must never silently mutate an immutable context revision. A
  -- NULL legacy/default value may be populated once; a conflicting value fails.
  if coalesce((v_result ->> 'replayed')::boolean, false)
     and jsonb_typeof(v_existing_risk) <> 'null'
     and v_existing_risk is distinct from v_risk then
    raise exception using errcode = '23505', message = 'financial_context_first_forecast_risk_mismatch';
  end if;

  update public.eos_financial_contexts_v1
     set first_forecast_risk = v_risk
   where usuario_id = p_usuario_id
     and revision = v_revision;

  return v_result;
end;
$$;

revoke all on function public.eos_financial_persist_snapshot_v1_1(uuid, jsonb) from public;
revoke all on function public.eos_financial_persist_snapshot_v1_1(uuid, jsonb) from anon;
revoke all on function public.eos_financial_persist_snapshot_v1_1(uuid, jsonb) from authenticated;
grant execute on function public.eos_financial_persist_snapshot_v1_1(uuid, jsonb) to service_role;

-- Promotion gates:
--   1. apply only to a non-production Supabase branch/project first;
--   2. verify fresh insert + exact replay + conflicting replay;
--   3. verify first_forecast_risk is returned by owner-scoped Financial State;
--   4. verify malformed risk JSON fails closed and rolls back the whole snapshot;
--   5. verify service_role-only EXECUTE and cross-user isolation;
--   6. rehearse rollback;
--   7. do not apply to production until the EOS 4.0 RC1 freeze is closed.
