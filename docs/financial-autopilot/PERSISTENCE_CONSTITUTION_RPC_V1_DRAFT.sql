-- EOS Financial Autopilot — Financial Constitution persistence RPC v1
-- DESIGN / NON-PRODUCTION VALIDATION ONLY.
-- DO NOT APPLY TO PRODUCTION DURING THE EOS 4.0 RC1 FREEZE.
--
-- Required predecessors, in order:
--   1. SCHEMA_V1_DRAFT.sql
--   2. PERSISTENCE_MULTI_PROVIDER_RPC_V1_3_DRAFT.sql
--
-- This RPC is service-role-only, serializes writes per user, validates the
-- complete fingerprinted policy, supports exact replay and uses optimistic
-- version comparison before superseding the active Constitution.

create or replace function public.eos_financial_persist_constitution_v1(
  p_usuario_id uuid,
  p_policy jsonb,
  p_policy_fingerprint text,
  p_confirmed_at timestamptz,
  p_expected_current_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.eos_financial_constitutions_v1%rowtype;
  v_existing public.eos_financial_constitutions_v1%rowtype;
  v_created public.eos_financial_constitutions_v1%rowtype;
  v_current_version integer;
  v_expected_fingerprint text;
begin
  if p_usuario_id is null then
    raise exception 'financial_constitution_missing_user' using errcode = '22023';
  end if;
  if p_expected_current_version is null or p_expected_current_version < 0 then
    raise exception 'financial_constitution_invalid_expected_version' using errcode = '22023';
  end if;
  if p_confirmed_at is null or p_confirmed_at > pg_catalog.now() + interval '5 minutes' then
    raise exception 'financial_constitution_invalid_confirmation' using errcode = '22023';
  end if;
  if p_policy is null or pg_catalog.jsonb_typeof(p_policy) <> 'object' then
    raise exception 'financial_constitution_invalid_policy' using errcode = '22023';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_policy)) <> 11
    or not p_policy ?& array[
      'version', 'policyVersion', 'currency', 'protectedLiquidityMinor',
      'minimumSavingsRateBps', 'debtPolicy', 'primaryGoal',
      'approvalThresholdMinor', 'autonomyLevel',
      'executionAuthorityMinor', 'confirmedAt'
    ]
  then
    raise exception 'financial_constitution_invalid_policy_shape' using errcode = '22023';
  end if;
  if p_policy ->> 'version' <> 'financial-constitution-v1'
    or p_policy ->> 'policyVersion' <> '1'
    or coalesce(p_policy ->> 'currency', '') !~ '^[A-Z]{3}$'
    or coalesce(p_policy ->> 'debtPolicy', '') not in (
      'PAY_CARD_FULL', 'PAY_MINIMUMS_FIRST',
      'HIGHEST_RATE_FIRST', 'SMALLEST_BALANCE_FIRST'
    )
    or coalesce(p_policy ->> 'autonomyLevel', '') not in (
      'OBSERVE', 'RECOMMEND', 'PREPARE'
    )
  then
    raise exception 'financial_constitution_invalid_policy_values' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_policy -> 'protectedLiquidityMinor') <> 'number'
    or pg_catalog.jsonb_typeof(p_policy -> 'minimumSavingsRateBps') <> 'number'
    or pg_catalog.jsonb_typeof(p_policy -> 'approvalThresholdMinor') <> 'number'
    or pg_catalog.jsonb_typeof(p_policy -> 'executionAuthorityMinor') <> 'number'
    or coalesce(p_policy ->> 'protectedLiquidityMinor', '') !~ '^[0-9]+$'
    or coalesce(p_policy ->> 'minimumSavingsRateBps', '') !~ '^[0-9]+$'
    or coalesce(p_policy ->> 'approvalThresholdMinor', '') !~ '^[0-9]+$'
    or p_policy ->> 'executionAuthorityMinor' <> '0'
    or (p_policy ->> 'protectedLiquidityMinor')::numeric > 9007199254740991
    or (p_policy ->> 'approvalThresholdMinor')::numeric > 9007199254740991
    or (p_policy ->> 'minimumSavingsRateBps')::integer > 10000
  then
    raise exception 'financial_constitution_invalid_policy_amounts' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_policy -> 'primaryGoal') <> 'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_policy -> 'primaryGoal')) <> 3
    or not (p_policy -> 'primaryGoal') ?& array['id', 'label', 'priority']
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_policy #>> '{primaryGoal,id}', ''))) not between 1 and 128
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_policy #>> '{primaryGoal,label}', ''))) not between 1 and 128
    or coalesce(p_policy #>> '{primaryGoal,priority}', '') not in ('HIGH', 'MEDIUM', 'LOW')
  then
    raise exception 'financial_constitution_invalid_goal' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_policy -> 'confirmedAt') <> 'string'
    or (p_policy ->> 'confirmedAt')::timestamptz <> p_confirmed_at
  then
    raise exception 'financial_constitution_confirmation_mismatch' using errcode = '22023';
  end if;
  if p_policy_fingerprint !~ '^policy:[0-9a-f]{64}$' then
    raise exception 'financial_constitution_invalid_fingerprint' using errcode = '22023';
  end if;

  v_expected_fingerprint := 'policy:' ||
    eos_private.eos_financial_sha256_json_v1(p_policy);
  if p_policy_fingerprint <> v_expected_fingerprint then
    raise exception 'financial_constitution_fingerprint_mismatch' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('eos-financial-constitution:' || p_usuario_id::text, 0)
  );

  select *
    into v_current
    from public.eos_financial_constitutions_v1
    where usuario_id = p_usuario_id
      and superseded_at is null
    order by version desc
    limit 1
    for update;

  if found and v_current.policy_fingerprint = p_policy_fingerprint then
    if v_current.policy <> p_policy
      or v_current.confirmed_by_user_at <> p_confirmed_at
    then
      raise exception 'financial_constitution_replay_mismatch' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'constitutionId', v_current.id,
      'version', v_current.version,
      'policyFingerprint', v_current.policy_fingerprint,
      'replayed', true
    );
  end if;

  select *
    into v_existing
    from public.eos_financial_constitutions_v1
    where usuario_id = p_usuario_id
      and policy_fingerprint = p_policy_fingerprint
    limit 1;
  if found then
    raise exception 'financial_constitution_historical_policy_reuse' using errcode = '23505';
  end if;

  v_current_version := coalesce(v_current.version, 0);
  if v_current_version <> p_expected_current_version then
    raise exception 'financial_constitution_version_conflict' using errcode = '40001';
  end if;

  if v_current.id is not null then
    update public.eos_financial_constitutions_v1
      set superseded_at = pg_catalog.transaction_timestamp()
      where id = v_current.id;
  end if;

  insert into public.eos_financial_constitutions_v1 (
    usuario_id,
    version,
    effective_from,
    policy,
    policy_fingerprint,
    confirmed_by_user_at
  ) values (
    p_usuario_id,
    v_current_version + 1,
    pg_catalog.transaction_timestamp(),
    p_policy,
    p_policy_fingerprint,
    p_confirmed_at
  )
  returning * into v_created;

  return pg_catalog.jsonb_build_object(
    'constitutionId', v_created.id,
    'version', v_created.version,
    'policyFingerprint', v_created.policy_fingerprint,
    'replayed', false
  );
end;
$$;

revoke all on function public.eos_financial_persist_constitution_v1(
  uuid, jsonb, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.eos_financial_persist_constitution_v1(
  uuid, jsonb, text, timestamptz, integer
) to service_role;
