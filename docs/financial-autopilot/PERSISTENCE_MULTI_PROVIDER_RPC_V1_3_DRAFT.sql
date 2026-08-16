-- EOS Financial Autopilot — atomic multi-provider persistence RPC v1.3
-- DESIGN / NON-PRODUCTION VALIDATION ONLY.
-- DO NOT APPLY TO PRODUCTION DURING THE EOS 4.0 RC1 FREEZE.
--
-- Required predecessors, in order:
--   1. SCHEMA_V1_DRAFT.sql
--   2. PERSISTENCE_FIRST_FORECAST_RISK_V1_1_DRAFT.sql
--   3. PERSISTENCE_CRITICAL_OBLIGATIONS_V1_2_DRAFT.sql
--   4. PERSISTENCE_CRITICAL_SOURCES_V1_3_DRAFT.sql
--   5. GLOBAL_CONTEXT_COMMIT_V1_3_DRAFT.sql
--
-- One invocation is one PostgreSQL transaction:
--   validate every identity -> lock user -> persist every provider scope
--   -> persist optional global context -> insert global commit LAST.
-- Any exception rolls the complete invocation back.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists eos_private;
revoke all on schema eos_private from public, anon, authenticated;

-- Mirrors the TypeScript stableFinancialFingerprintMaterial contract for the
-- JSON shapes used by Financial Autopilot: object keys are C-sorted, arrays
-- retain order, and scalar values use PostgreSQL's JSON representation.
create or replace function eos_private.eos_financial_canonical_json_v1(
  p_value jsonb
)
returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
declare
  v_kind text;
  v_result text;
begin
  v_kind := pg_catalog.jsonb_typeof(p_value);

  if v_kind = 'object' then
    select '{' || coalesce(
      pg_catalog.string_agg(
        pg_catalog.to_jsonb(entry.key)::text || ':' ||
          eos_private.eos_financial_canonical_json_v1(entry.value),
        ',' order by entry.key collate "C"
      ),
      ''
    ) || '}'
      into v_result
      from pg_catalog.jsonb_each(p_value) as entry(key, value);
    return v_result;
  end if;

  if v_kind = 'array' then
    select '[' || coalesce(
      pg_catalog.string_agg(
        eos_private.eos_financial_canonical_json_v1(entry.value),
        ',' order by entry.ordinality
      ),
      ''
    ) || ']'
      into v_result
      from pg_catalog.jsonb_array_elements(p_value)
        with ordinality as entry(value, ordinality);
    return v_result;
  end if;

  return p_value::text;
end;
$$;

create or replace function eos_private.eos_financial_sha256_json_v1(
  p_value jsonb
)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      eos_private.eos_financial_canonical_json_v1(p_value),
      'sha256'
    ),
    'hex'
  )
$$;

create or replace function eos_private.eos_financial_canonical_iso_v1(
  p_value text
)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select pg_catalog.to_char(
    p_value::timestamptz at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
$$;

revoke all on function eos_private.eos_financial_canonical_json_v1(jsonb)
  from public, anon, authenticated;
revoke all on function eos_private.eos_financial_sha256_json_v1(jsonb)
  from public, anon, authenticated;
revoke all on function eos_private.eos_financial_canonical_iso_v1(text)
  from public, anon, authenticated;

-- Immutable provider-scope receipt. Mutable connection/account/Ledger rows may
-- advance later, but one scope identity can never acquire different material.
create table if not exists public.eos_financial_provider_scopes_v1_3 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  provider_key text not null,
  scope_fingerprint text not null
    check (scope_fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot_fingerprint text not null
    check (snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_plan_fingerprint text not null
    check (provider_plan_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_plan_material_hash text not null
    check (provider_plan_material_hash ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (usuario_id, provider_key, scope_fingerprint),
  unique (usuario_id, provider_plan_fingerprint)
);

create index if not exists eos_fin_provider_scopes_user_time_idx
  on public.eos_financial_provider_scopes_v1_3(usuario_id, created_at desc);

-- Full-plan receipt. Its row is created inside the same transaction as all
-- provider writes and the optional global marker. Exact replay exits before
-- mutable rows are touched.
create table if not exists public.eos_financial_multi_provider_plans_v1_3 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  plan_fingerprint text not null
    check (plan_fingerprint ~ '^[0-9a-f]{64}$'),
  plan_material_hash text not null
    check (plan_material_hash ~ '^[0-9a-f]{64}$'),
  manifest_fingerprint text not null
    check (manifest_fingerprint ~ '^[0-9a-f]{64}$'),
  global_context_revision text
    check (
      global_context_revision is null or
      global_context_revision ~ '^ctx:[0-9a-f]{64}$'
    ),
  global_context_commit_fingerprint text
    check (
      global_context_commit_fingerprint is null or
      global_context_commit_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  created_at timestamptz not null default now(),
  unique (usuario_id, plan_fingerprint),
  check (
    (global_context_revision is null) =
    (global_context_commit_fingerprint is null)
  )
);

create index if not exists eos_fin_multi_provider_plans_user_time_idx
  on public.eos_financial_multi_provider_plans_v1_3(usuario_id, created_at desc);

alter table public.eos_financial_provider_scopes_v1_3 enable row level security;
alter table public.eos_financial_multi_provider_plans_v1_3 enable row level security;

revoke all on table public.eos_financial_provider_scopes_v1_3
  from public, anon, authenticated;
revoke all on table public.eos_financial_multi_provider_plans_v1_3
  from public, anon, authenticated;

-- Deliberately no browser policies. These receipts expose provider topology,
-- replay identities and orchestration provenance and remain server-only.

create or replace function public.eos_financial_persist_multi_provider_v1_3(
  p_usuario_id uuid,
  p_batch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manifest jsonb;
  v_provider_plans jsonb;
  v_global_context jsonb;
  v_provider_plan jsonb;
  v_manifest_scope jsonb;
  v_connection jsonb;
  v_account jsonb;
  v_event jsonb;
  v_ledger jsonb;

  v_plan_fingerprint text;
  v_plan_material_hash text;
  v_expected_plan_fingerprint text;
  v_manifest_fingerprint text;
  v_expected_manifest_fingerprint text;
  v_provider_key text;
  v_scope_fingerprint text;
  v_snapshot_fingerprint text;
  v_provider_plan_fingerprint text;
  v_expected_provider_plan_fingerprint text;
  v_provider_plan_material_hash text;
  v_global_context_revision text;
  v_global_context_source_fingerprint text;
  v_expected_global_context_fingerprint text;
  v_global_commit_fingerprint text;
  v_global_context_material jsonb;
  v_provider_bindings jsonb;
  v_generated_at text;

  v_connection_id uuid;
  v_account_id uuid;
  v_source_event_id uuid;
  v_original_ledger_id uuid;
  v_existing_plan public.eos_financial_multi_provider_plans_v1_3%rowtype;
  v_existing_scope public.eos_financial_provider_scopes_v1_3%rowtype;
  v_existing_event public.eos_financial_ingestion_events_v1%rowtype;

  v_provider_count integer;
  v_manifest_scope_count integer;
  v_row_count integer;
  v_provider_scopes_touched integer := 0;
  v_ingestion_rows_touched integer := 0;
  v_ledger_rows_touched integer := 0;
  v_global_context_eligible boolean;
  v_sources_fresh boolean;
  v_critical_sources_complete boolean;
  v_critical_obligations_complete boolean;
begin
  if p_usuario_id is null then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_missing_user';
  end if;

  if p_batch is null or pg_catalog.jsonb_typeof(p_batch) <> 'object' then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_invalid_batch';
  end if;

  if p_batch ->> 'version' <> 'multi-provider-scoped-persistence-plan-v1' then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_unsupported_version';
  end if;

  if nullif(p_batch ->> 'userId', '')::uuid is distinct from p_usuario_id then
    raise exception using errcode = '42501',
      message = 'financial_multi_provider_persistence_user_mismatch';
  end if;

  v_plan_fingerprint := nullif(p_batch ->> 'planFingerprint', '');
  if v_plan_fingerprint is null or v_plan_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_invalid_plan_fingerprint';
  end if;

  v_manifest := p_batch -> 'manifest';
  v_provider_plans := p_batch -> 'providerPlans';
  v_global_context := p_batch -> 'globalContextPlan';

  if coalesce(pg_catalog.jsonb_typeof(v_manifest), 'null') <> 'object'
     or coalesce(pg_catalog.jsonb_typeof(v_provider_plans), 'null') <> 'array'
     or coalesce(pg_catalog.jsonb_typeof(v_global_context), 'null')
        not in ('object', 'null') then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_invalid_structure';
  end if;

  if v_manifest ->> 'version' <> 'multi-provider-persistence-manifest-v1'
     or nullif(v_manifest ->> 'trustedUserId', '')::uuid
        is distinct from p_usuario_id
     or coalesce(
          pg_catalog.jsonb_typeof(v_manifest -> 'providerScopes'),
          'null'
        ) <> 'array'
     or coalesce(
          pg_catalog.jsonb_typeof(v_manifest -> 'globalContextEligible'),
          'null'
        ) <> 'boolean' then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_invalid_manifest';
  end if;

  v_manifest_fingerprint := nullif(
    v_manifest ->> 'manifestFingerprint',
    ''
  );
  if v_manifest_fingerprint is null
     or v_manifest_fingerprint !~ '^[0-9a-f]{64}$'
     or coalesce(v_manifest ->> 'analysisFingerprint', '')
        !~ '^[0-9a-f]{64}$'
     or coalesce(v_manifest ->> 'globalResultFingerprint', '')
        !~ '^[0-9a-f]{64}$'
     or (
       v_manifest ->> 'globalCoverageFingerprint' is not null and
       v_manifest ->> 'globalCoverageFingerprint' !~ '^[0-9a-f]{64}$'
     )
     or (
       v_manifest ->> 'sourceOrchestrationFingerprint' is not null and
       v_manifest ->> 'sourceOrchestrationFingerprint' !~ '^[0-9a-f]{64}$'
     ) then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_invalid_manifest_identity';
  end if;

  v_global_context_eligible :=
    (v_manifest ->> 'globalContextEligible')::boolean;
  if v_global_context_eligible and (
    v_manifest ->> 'globalCoverageFingerprint' is null or
    v_manifest ->> 'sourceOrchestrationFingerprint' is null or
    pg_catalog.jsonb_typeof(v_global_context) <> 'object'
  ) then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_missing_global_context';
  end if;
  if not v_global_context_eligible and
     pg_catalog.jsonb_typeof(v_global_context) = 'object' then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_unexpected_global_context';
  end if;

  v_provider_count := pg_catalog.jsonb_array_length(v_provider_plans);
  v_manifest_scope_count := pg_catalog.jsonb_array_length(
    v_manifest -> 'providerScopes'
  );
  if v_provider_count <= 0 or v_provider_count <> v_manifest_scope_count then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_provider_scope_count_mismatch';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_manifest -> 'providerScopes')
        as scope(value)
     where coalesce(scope.value ->> 'providerKey', '') = ''
        or pg_catalog.btrim(scope.value ->> 'providerKey')
           <> scope.value ->> 'providerKey'
        or coalesce(scope.value ->> 'scopeFingerprint', '')
           !~ '^[0-9a-f]{64}$'
        or coalesce(scope.value ->> 'snapshotFingerprint', '')
           !~ '^[0-9a-f]{64}$'
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_manifest -> 'providerScopes')
        as scope(value)
     group by scope.value ->> 'providerKey'
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_manifest -> 'providerScopes')
        as scope(value)
     group by scope.value ->> 'scopeFingerprint'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_invalid_manifest_scope';
  end if;

  v_expected_manifest_fingerprint :=
    eos_private.eos_financial_sha256_json_v1(
      pg_catalog.jsonb_build_object(
        'contract', 'multi-provider-persistence-manifest-v1',
        'trustedUserId', p_usuario_id::text,
        'providerScopes', (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'providerKey', scope.value ->> 'providerKey',
              'scopeFingerprint', scope.value ->> 'scopeFingerprint'
            ) order by scope.ordinality
          )
            from pg_catalog.jsonb_array_elements(
              v_manifest -> 'providerScopes'
            ) with ordinality as scope(value, ordinality)
        ),
        'analysisFingerprint', v_manifest -> 'analysisFingerprint',
        'globalCoverageFingerprint',
          v_manifest -> 'globalCoverageFingerprint',
        'sourceOrchestrationFingerprint',
          v_manifest -> 'sourceOrchestrationFingerprint',
        'globalResultFingerprint', v_manifest -> 'globalResultFingerprint',
        'globalContextEligible', v_manifest -> 'globalContextEligible'
      )
    );
  if v_expected_manifest_fingerprint <> v_manifest_fingerprint then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_manifest_fingerprint_mismatch';
  end if;

  -- Validate every provider plan and its exact positional manifest binding
  -- before the first write.
  for v_provider_plan, v_manifest_scope in
    select provider.value, scope.value
      from pg_catalog.jsonb_array_elements(v_provider_plans)
        with ordinality as provider(value, ordinality)
      join pg_catalog.jsonb_array_elements(v_manifest -> 'providerScopes')
        with ordinality as scope(value, ordinality)
        using (ordinality)
  loop
    if pg_catalog.jsonb_typeof(v_provider_plan) <> 'object'
       or coalesce(
            pg_catalog.jsonb_typeof(v_provider_plan -> 'connectionUpserts'),
            'null'
          ) <> 'array'
       or coalesce(
            pg_catalog.jsonb_typeof(v_provider_plan -> 'accountUpserts'),
            'null'
          ) <> 'array'
       or coalesce(
            pg_catalog.jsonb_typeof(v_provider_plan -> 'ingestionEventUpserts'),
            'null'
          ) <> 'array'
       or coalesce(
            pg_catalog.jsonb_typeof(v_provider_plan -> 'ledgerUpserts'),
            'null'
          ) <> 'array' then
      raise exception using errcode = '22023',
        message = 'financial_multi_provider_persistence_invalid_provider_plan';
    end if;

    v_provider_key := v_provider_plan ->> 'providerKey';
    v_scope_fingerprint := v_provider_plan ->> 'scopeFingerprint';
    v_snapshot_fingerprint := v_provider_plan ->> 'snapshotFingerprint';
    v_provider_plan_fingerprint :=
      v_provider_plan ->> 'providerPlanFingerprint';

    if coalesce(v_provider_key, '') = ''
       or pg_catalog.btrim(v_provider_key) <> v_provider_key
       or coalesce(v_scope_fingerprint, '')
          !~ '^[0-9a-f]{64}$'
       or coalesce(v_snapshot_fingerprint, '')
          !~ '^[0-9a-f]{64}$'
       or coalesce(v_provider_plan_fingerprint, '')
          !~ '^[0-9a-f]{64}$'
       or v_manifest_scope ->> 'providerKey' is distinct from v_provider_key
       or v_manifest_scope ->> 'scopeFingerprint'
          is distinct from v_scope_fingerprint
       or v_manifest_scope ->> 'snapshotFingerprint'
          is distinct from v_snapshot_fingerprint then
      raise exception using errcode = '22023',
        message = 'financial_multi_provider_persistence_provider_manifest_mismatch';
    end if;

    v_expected_provider_plan_fingerprint :=
      eos_private.eos_financial_sha256_json_v1(
        pg_catalog.jsonb_build_object(
          'contract', 'multi-provider-scoped-provider-plan-v1',
          'providerKey', v_provider_plan -> 'providerKey',
          'scopeFingerprint', v_provider_plan -> 'scopeFingerprint',
          'snapshotFingerprint', v_provider_plan -> 'snapshotFingerprint',
          'connectionUpserts', v_provider_plan -> 'connectionUpserts',
          'accountUpserts', v_provider_plan -> 'accountUpserts',
          'ingestionEventUpserts',
            v_provider_plan -> 'ingestionEventUpserts',
          'ledgerUpserts', v_provider_plan -> 'ledgerUpserts'
        )
      );
    if v_expected_provider_plan_fingerprint
       <> v_provider_plan_fingerprint then
      raise exception using errcode = '22023',
        message = 'financial_multi_provider_persistence_provider_plan_fingerprint_mismatch';
    end if;

    if exists (
      select 1
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'connectionUpserts'
        ) as item(value)
       where nullif(item.value ->> 'userId', '')::uuid
             is distinct from p_usuario_id
          or item.value ->> 'providerKey' is distinct from v_provider_key
          or coalesce(item.value ->> 'connectionKey', '') = ''
    ) or exists (
      select 1
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'connectionUpserts'
        ) as item(value)
       group by item.value ->> 'connectionKey'
      having pg_catalog.count(*) > 1
    ) then
      raise exception using errcode = '42501',
        message = 'financial_multi_provider_persistence_connection_scope_mismatch';
    end if;

    if exists (
      select 1
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'accountUpserts'
        ) as item(value)
       where nullif(item.value ->> 'userId', '')::uuid
             is distinct from p_usuario_id
          or not exists (
            select 1
              from pg_catalog.jsonb_array_elements(
                v_provider_plan -> 'connectionUpserts'
              ) as connection(value)
             where connection.value ->> 'connectionKey'
                   = item.value ->> 'connectionKey'
          )
          or coalesce(item.value ->> 'externalAccountId', '') = ''
    ) or exists (
      select 1
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'accountUpserts'
        ) as item(value)
       group by item.value ->> 'connectionKey',
                item.value ->> 'externalAccountId'
      having pg_catalog.count(*) > 1
    ) then
      raise exception using errcode = '42501',
        message = 'financial_multi_provider_persistence_account_scope_mismatch';
    end if;

    if exists (
      select 1
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'ingestionEventUpserts'
        ) as item(value)
       where nullif(item.value ->> 'userId', '')::uuid
             is distinct from p_usuario_id
          or item.value ->> 'providerKey' is distinct from v_provider_key
          or coalesce(item.value ->> 'sourceFingerprint', '')
             !~ '^[0-9a-f]{64}$'
          or coalesce(item.value ->> 'payloadHash', '')
             !~ '^[0-9a-f]{64}$'
          or coalesce(item.value ->> 'externalEventId', '') = ''
          or not exists (
            select 1
              from pg_catalog.jsonb_array_elements(
                v_provider_plan -> 'accountUpserts'
              ) as account(value)
             where account.value ->> 'connectionKey'
                   = item.value ->> 'connectionKey'
               and account.value ->> 'externalAccountId'
                   = item.value ->> 'accountExternalId'
          )
    ) or exists (
      select 1
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'ingestionEventUpserts'
        ) as item(value)
       group by item.value ->> 'connectionKey',
                item.value ->> 'accountExternalId',
                item.value ->> 'sourceEventKey'
      having pg_catalog.count(*) > 1
    ) then
      raise exception using errcode = '42501',
        message = 'financial_multi_provider_persistence_ingestion_scope_mismatch';
    end if;

    if exists (
      select 1
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'ledgerUpserts'
        ) as item(value)
       where nullif(item.value ->> 'userId', '')::uuid
             is distinct from p_usuario_id
          or item.value ->> 'providerKey' is distinct from v_provider_key
          or coalesce(item.value ->> 'canonicalKey', '')
             !~ '^(ext|src|fp):[0-9a-f]{64}$'
          or not exists (
            select 1
              from pg_catalog.jsonb_array_elements(
                v_provider_plan -> 'ingestionEventUpserts'
              ) as event(value)
             where event.value ->> 'connectionKey'
                   = item.value ->> 'connectionKey'
               and event.value ->> 'accountExternalId'
                   = item.value ->> 'accountExternalId'
               and event.value ->> 'sourceEventKey'
                   = item.value ->> 'sourceEventKey'
          )
    ) or exists (
      select 1
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'ledgerUpserts'
        ) as item(value)
       group by item.value ->> 'canonicalKey'
      having pg_catalog.count(*) > 1
    ) then
      raise exception using errcode = '42501',
        message = 'financial_multi_provider_persistence_ledger_scope_mismatch';
    end if;
  end loop;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_provider_plans) as provider(value)
     group by provider.value ->> 'providerKey'
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_provider_plans) as provider(value)
     group by provider.value ->> 'scopeFingerprint'
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_provider_plans) as provider(value)
     group by provider.value ->> 'providerPlanFingerprint'
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_provider_plans) as provider(value)
      cross join lateral pg_catalog.jsonb_array_elements(
        provider.value -> 'ledgerUpserts'
      ) as ledger(value)
     group by ledger.value ->> 'canonicalKey'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_duplicate_global_identity';
  end if;

  v_expected_plan_fingerprint :=
    eos_private.eos_financial_sha256_json_v1(
      pg_catalog.jsonb_build_object(
        'contract', 'multi-provider-scoped-persistence-plan-v1',
        'trustedUserId', p_usuario_id::text,
        'manifestFingerprint', v_manifest_fingerprint,
        'providerPlans', (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'providerKey', provider.value -> 'providerKey',
              'scopeFingerprint', provider.value -> 'scopeFingerprint',
              'providerPlanFingerprint',
                provider.value -> 'providerPlanFingerprint'
            ) order by provider.ordinality
          )
            from pg_catalog.jsonb_array_elements(v_provider_plans)
              with ordinality as provider(value, ordinality)
        ),
        'globalContextRevision', case
          when pg_catalog.jsonb_typeof(v_global_context) = 'object'
            then v_global_context -> 'revision'
          else 'null'::jsonb
        end
      )
    );
  if v_expected_plan_fingerprint <> v_plan_fingerprint then
    raise exception using errcode = '22023',
      message = 'financial_multi_provider_persistence_plan_fingerprint_mismatch';
  end if;

  v_plan_material_hash :=
    eos_private.eos_financial_sha256_json_v1(p_batch);

  if pg_catalog.jsonb_typeof(v_global_context) = 'object' then
    if nullif(v_global_context ->> 'userId', '')::uuid
       is distinct from p_usuario_id
       or v_global_context ->> 'manifestFingerprint'
          is distinct from v_manifest_fingerprint
       or v_global_context ->> 'analysisFingerprint'
          is distinct from v_manifest ->> 'analysisFingerprint'
       or v_global_context ->> 'globalCoverageFingerprint'
          is distinct from v_manifest ->> 'globalCoverageFingerprint'
       or v_global_context ->> 'sourceOrchestrationFingerprint'
          is distinct from v_manifest ->> 'sourceOrchestrationFingerprint'
       or v_global_context ->> 'globalResultFingerprint'
          is distinct from v_manifest ->> 'globalResultFingerprint' then
      raise exception using errcode = '42501',
        message = 'financial_multi_provider_persistence_global_context_scope_mismatch';
    end if;

    if not (v_global_context ? 'minimumProjectedCashAt')
       or not (v_global_context ? 'firstForecastRisk')
       or not (v_global_context ? 'criticalSourcesComplete')
       or not (v_global_context ? 'criticalObligationsComplete')
       or coalesce(
            pg_catalog.jsonb_typeof(v_global_context -> 'confidence'),
            'null'
          ) <> 'object'
       or coalesce(
            pg_catalog.jsonb_typeof(v_global_context -> 'explanationRefs'),
            'null'
          ) <> 'array'
       or coalesce(
            pg_catalog.jsonb_typeof(v_global_context -> 'sourcesFresh'),
            'null'
          ) <> 'boolean'
       or coalesce(
            pg_catalog.jsonb_typeof(
              v_global_context -> 'criticalSourcesComplete'
            ),
            'null'
          ) <> 'boolean'
       or coalesce(
            pg_catalog.jsonb_typeof(
              v_global_context -> 'criticalObligationsComplete'
            ),
            'null'
          ) <> 'boolean'
       or coalesce(
            pg_catalog.jsonb_typeof(v_global_context -> 'firstForecastRisk'),
            'null'
          ) not in ('object', 'null') then
      raise exception using errcode = '22023',
        message = 'financial_multi_provider_persistence_invalid_global_context';
    end if;

    v_generated_at := v_global_context ->> 'generatedAt';
    if coalesce(v_generated_at, '') = ''
       or eos_private.eos_financial_canonical_iso_v1(v_generated_at)
          <> v_generated_at then
      raise exception using errcode = '22023',
        message = 'financial_multi_provider_persistence_noncanonical_generated_at';
    end if;

    v_sources_fresh := (v_global_context ->> 'sourcesFresh')::boolean;
    v_critical_sources_complete :=
      (v_global_context ->> 'criticalSourcesComplete')::boolean;
    v_critical_obligations_complete :=
      (v_global_context ->> 'criticalObligationsComplete')::boolean;
    if (
      not v_sources_fresh or
      not v_critical_sources_complete or
      not v_critical_obligations_complete
    ) and v_global_context ->> 'status' is distinct from 'DEGRADED' then
      raise exception using errcode = '22023',
        message = 'financial_multi_provider_persistence_safety_status_conflict';
    end if;

    if pg_catalog.jsonb_typeof(v_global_context -> 'firstForecastRisk') = 'object'
       and (
         v_global_context #>> '{firstForecastRisk,status}'
           not in ('ATTENTION', 'ACTION_REQUIRED')
         or coalesce(
              v_global_context #>> '{firstForecastRisk,horizonDays}',
              ''
            ) !~ '^[0-9]+$'
         or (v_global_context #>> '{firstForecastRisk,horizonDays}')::integer <= 0
         or coalesce(
              v_global_context #>> '{firstForecastRisk,reserveGapMinor}',
              ''
            ) !~ '^[0-9]+$'
         or coalesce(
              v_global_context #>> '{firstForecastRisk,negativeCashGapMinor}',
              ''
            ) !~ '^[0-9]+$'
         or coalesce(
              v_global_context #>> '{firstForecastRisk,until}',
              ''
            ) = ''
       ) then
      raise exception using errcode = '22023',
        message = 'financial_multi_provider_persistence_invalid_first_forecast_risk';
    end if;
    if pg_catalog.jsonb_typeof(v_global_context -> 'firstForecastRisk') = 'object' then
      perform (v_global_context #>> '{firstForecastRisk,until}')::timestamptz;
    end if;

    v_global_context_material := pg_catalog.jsonb_build_object(
      'contract', 'multi-provider-global-financial-context-v1',
      'trustedUserId', p_usuario_id::text,
      'manifestFingerprint', v_global_context -> 'manifestFingerprint',
      'analysisFingerprint', v_global_context -> 'analysisFingerprint',
      'globalCoverageFingerprint',
        v_global_context -> 'globalCoverageFingerprint',
      'sourceOrchestrationFingerprint',
        v_global_context -> 'sourceOrchestrationFingerprint',
      'globalResultFingerprint',
        v_global_context -> 'globalResultFingerprint',
      'currency', v_global_context -> 'currency',
      'status', v_global_context -> 'status',
      'horizonUntil', v_global_context -> 'horizonUntil',
      'horizonReason', v_global_context -> 'horizonReason',
      'liquidityUsableMinor', v_global_context -> 'liquidityUsableMinor',
      'protectedCommitmentsMinor',
        v_global_context -> 'protectedCommitmentsMinor',
      'essentialSpendExpectedMinor',
        v_global_context -> 'essentialSpendExpectedMinor',
      'protectedReserveMinor', v_global_context -> 'protectedReserveMinor',
      'criticalProvisionsMinor',
        v_global_context -> 'criticalProvisionsMinor',
      'confirmedIncomeMinor', v_global_context -> 'confirmedIncomeMinor',
      'uncertaintyBufferMinor',
        v_global_context -> 'uncertaintyBufferMinor',
      'availableRealSafeMinor',
        v_global_context -> 'availableRealSafeMinor',
      'minimumProjectedCashMinor',
        v_global_context -> 'minimumProjectedCashMinor',
      'minimumProjectedCashAt',
        v_global_context -> 'minimumProjectedCashAt',
      'confidence', v_global_context -> 'confidence',
      'sourcesFresh', v_global_context -> 'sourcesFresh',
      'criticalSourcesComplete',
        v_global_context -> 'criticalSourcesComplete',
      'criticalObligationsComplete',
        v_global_context -> 'criticalObligationsComplete',
      'firstForecastRisk', v_global_context -> 'firstForecastRisk',
      'generatedAt', v_global_context -> 'generatedAt',
      'validUntil', v_global_context -> 'validUntil',
      'explanationRefs', v_global_context -> 'explanationRefs'
    );
    v_expected_global_context_fingerprint :=
      eos_private.eos_financial_sha256_json_v1(v_global_context_material);
    v_global_context_source_fingerprint :=
      v_global_context ->> 'sourceFingerprint';
    v_global_context_revision := v_global_context ->> 'revision';
    if v_global_context_source_fingerprint
       <> v_expected_global_context_fingerprint
       or v_global_context_revision
          <> 'ctx:' || v_expected_global_context_fingerprint then
      raise exception using errcode = '22023',
        message = 'financial_multi_provider_persistence_global_context_fingerprint_mismatch';
    end if;

    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'providerKey', provider.value -> 'providerKey',
        'scopeFingerprint', provider.value -> 'scopeFingerprint',
        'snapshotFingerprint', provider.value -> 'snapshotFingerprint',
        'providerPlanFingerprint', provider.value -> 'providerPlanFingerprint'
      ) order by provider.value ->> 'providerKey' collate "C",
                 provider.value ->> 'scopeFingerprint' collate "C"
    )
      into v_provider_bindings
      from pg_catalog.jsonb_array_elements(v_provider_plans) as provider(value);

    v_global_commit_fingerprint :=
      eos_private.eos_financial_sha256_json_v1(
        pg_catalog.jsonb_build_object(
          'contract', 'multi-provider-global-context-commit-v1',
          'trustedUserId', p_usuario_id::text,
          'manifestFingerprint', v_manifest_fingerprint,
          'globalContextRevision', v_global_context_revision,
          'globalContextFingerprint', v_global_context_source_fingerprint,
          'globalCoverageFingerprint',
            v_global_context -> 'globalCoverageFingerprint',
          'sourceOrchestrationFingerprint',
            v_global_context -> 'sourceOrchestrationFingerprint',
          'analysisFingerprint', v_global_context -> 'analysisFingerprint',
          'globalResultFingerprint',
            v_global_context -> 'globalResultFingerprint',
          'providerBindings', v_provider_bindings,
          'committedAt', v_generated_at
        )
      );
  else
    v_global_context_revision := null;
    v_global_context_source_fingerprint := null;
    v_global_commit_fingerprint := null;
    v_provider_bindings := null;
  end if;

  -- Serialize every Financial Autopilot write for one user. This prevents two
  -- distinct plans from interleaving provider/account/event state.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'eos-financial-multi-provider-v1.3:' || p_usuario_id::text,
      0
    )
  );

  select *
    into v_existing_plan
    from public.eos_financial_multi_provider_plans_v1_3 plan
   where plan.usuario_id = p_usuario_id
     and plan.plan_fingerprint = v_plan_fingerprint;

  if found then
    if v_existing_plan.plan_material_hash <> v_plan_material_hash
       or v_existing_plan.manifest_fingerprint <> v_manifest_fingerprint
       or v_existing_plan.global_context_revision
          is distinct from v_global_context_revision
       or v_existing_plan.global_context_commit_fingerprint
          is distinct from v_global_commit_fingerprint then
      raise exception using errcode = '23505',
        message = 'financial_multi_provider_plan_replay_mismatch';
    end if;

    return pg_catalog.jsonb_build_object(
      'replayed', true,
      'planFingerprint', v_plan_fingerprint,
      'globalContextRevision', v_global_context_revision,
      'globalContextCommitFingerprint', v_global_commit_fingerprint,
      'providerScopesTouched', 0,
      'ledgerRowsTouched', 0,
      'ingestionRowsTouched', 0
    );
  end if;

  insert into public.eos_financial_multi_provider_plans_v1_3 (
    usuario_id,
    plan_fingerprint,
    plan_material_hash,
    manifest_fingerprint,
    global_context_revision,
    global_context_commit_fingerprint
  ) values (
    p_usuario_id,
    v_plan_fingerprint,
    v_plan_material_hash,
    v_manifest_fingerprint,
    v_global_context_revision,
    v_global_commit_fingerprint
  );

  -- Provider-scoped writes. A conflict in any late provider raises and rolls
  -- back both this plan receipt and every earlier provider mutation.
  for v_provider_plan in
    select provider.value
      from pg_catalog.jsonb_array_elements(v_provider_plans)
        with ordinality as provider(value, ordinality)
     order by provider.ordinality
  loop
    v_provider_key := v_provider_plan ->> 'providerKey';
    v_scope_fingerprint := v_provider_plan ->> 'scopeFingerprint';
    v_snapshot_fingerprint := v_provider_plan ->> 'snapshotFingerprint';
    v_provider_plan_fingerprint :=
      v_provider_plan ->> 'providerPlanFingerprint';
    v_provider_plan_material_hash :=
      eos_private.eos_financial_sha256_json_v1(v_provider_plan);

    select *
      into v_existing_scope
      from public.eos_financial_provider_scopes_v1_3 scope
     where scope.usuario_id = p_usuario_id
       and scope.provider_key = v_provider_key
       and scope.scope_fingerprint = v_scope_fingerprint;

    if found then
      if v_existing_scope.snapshot_fingerprint <> v_snapshot_fingerprint
         or v_existing_scope.provider_plan_fingerprint
            <> v_provider_plan_fingerprint
         or v_existing_scope.provider_plan_material_hash
            <> v_provider_plan_material_hash then
        raise exception using errcode = '23505',
          message = 'financial_multi_provider_scope_replay_mismatch';
      end if;
    else
      if exists (
        select 1
          from public.eos_financial_provider_scopes_v1_3 scope
         where scope.usuario_id = p_usuario_id
           and scope.provider_plan_fingerprint = v_provider_plan_fingerprint
      ) then
        raise exception using errcode = '23505',
          message = 'financial_multi_provider_plan_identity_reused';
      end if;

      insert into public.eos_financial_provider_scopes_v1_3 (
        usuario_id,
        provider_key,
        scope_fingerprint,
        snapshot_fingerprint,
        provider_plan_fingerprint,
        provider_plan_material_hash,
        fetched_at
      ) values (
        p_usuario_id,
        v_provider_key,
        v_scope_fingerprint,
        v_snapshot_fingerprint,
        v_provider_plan_fingerprint,
        v_provider_plan_material_hash,
        (v_provider_plan ->> 'fetchedAt')::timestamptz
      );
      v_provider_scopes_touched := v_provider_scopes_touched + 1;
    end if;

    for v_connection in
      select item.value
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'connectionUpserts'
        ) as item(value)
    loop
      insert into public.eos_financial_connections_v1 as target_row (
        usuario_id,
        provider_key,
        connection_key,
        connection_type,
        country,
        status,
        last_sync_at,
        last_success_at,
        fresh_until,
        health
      ) values (
        p_usuario_id,
        v_provider_key,
        v_connection ->> 'connectionKey',
        v_connection ->> 'connectionType',
        coalesce(
          nullif(v_connection ->> 'country', ''),
          'PY'
        ),
        v_connection ->> 'status',
        nullif(v_connection ->> 'lastSyncAt', '')::timestamptz,
        nullif(v_connection ->> 'lastSuccessAt', '')::timestamptz,
        nullif(v_connection ->> 'freshUntil', '')::timestamptz,
        v_connection ->> 'health'
      )
      on conflict (usuario_id, provider_key, connection_key)
      do update set
        connection_type = excluded.connection_type,
        country = excluded.country,
        status = excluded.status,
        last_sync_at = excluded.last_sync_at,
        last_success_at = excluded.last_success_at,
        fresh_until = excluded.fresh_until,
        health = excluded.health,
        updated_at = pg_catalog.now()
      where (
        target_row.connection_type,
        target_row.country,
        target_row.status,
        target_row.last_sync_at,
        target_row.last_success_at,
        target_row.fresh_until,
        target_row.health
      ) is distinct from (
        excluded.connection_type,
        excluded.country,
        excluded.status,
        excluded.last_sync_at,
        excluded.last_success_at,
        excluded.fresh_until,
        excluded.health
      );
    end loop;

    for v_account in
      select item.value
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'accountUpserts'
        ) as item(value)
    loop
      v_connection_id := null;
      select connection.id
        into v_connection_id
        from public.eos_financial_connections_v1 connection
       where connection.usuario_id = p_usuario_id
         and connection.provider_key = v_provider_key
         and connection.connection_key = v_account ->> 'connectionKey';
      if v_connection_id is null then
        raise exception using errcode = '23503',
          message = 'financial_multi_provider_account_connection_missing';
      end if;

      insert into public.eos_financial_accounts_v1 as target_row (
        usuario_id,
        connection_id,
        external_account_id,
        account_type,
        institution_name,
        display_name,
        currency,
        ownership,
        available_balance_minor,
        ledger_balance_minor,
        balance_as_of,
        fresh_until,
        status
      ) values (
        p_usuario_id,
        v_connection_id,
        v_account ->> 'externalAccountId',
        v_account ->> 'accountType',
        nullif(v_account ->> 'institutionName', ''),
        nullif(v_account ->> 'displayName', ''),
        v_account ->> 'currency',
        v_account ->> 'ownership',
        nullif(
          v_account ->> 'availableBalanceMinor',
          ''
        )::bigint,
        nullif(
          v_account ->> 'ledgerBalanceMinor',
          ''
        )::bigint,
        nullif(v_account ->> 'balanceAsOf', '')::timestamptz,
        nullif(v_account ->> 'freshUntil', '')::timestamptz,
        v_account ->> 'status'
      )
      on conflict (usuario_id, connection_id, external_account_id)
      do update set
        account_type = excluded.account_type,
        institution_name = excluded.institution_name,
        display_name = excluded.display_name,
        currency = excluded.currency,
        ownership = excluded.ownership,
        available_balance_minor = excluded.available_balance_minor,
        ledger_balance_minor = excluded.ledger_balance_minor,
        balance_as_of = excluded.balance_as_of,
        fresh_until = excluded.fresh_until,
        status = excluded.status,
        updated_at = pg_catalog.now()
      where (
        target_row.account_type,
        target_row.institution_name,
        target_row.display_name,
        target_row.currency,
        target_row.ownership,
        target_row.available_balance_minor,
        target_row.ledger_balance_minor,
        target_row.balance_as_of,
        target_row.fresh_until,
        target_row.status
      ) is distinct from (
        excluded.account_type,
        excluded.institution_name,
        excluded.display_name,
        excluded.currency,
        excluded.ownership,
        excluded.available_balance_minor,
        excluded.ledger_balance_minor,
        excluded.balance_as_of,
        excluded.fresh_until,
        excluded.status
      );
    end loop;

    for v_event in
      select item.value
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'ingestionEventUpserts'
        ) as item(value)
    loop
      v_connection_id := null;
      v_account_id := null;
      select connection.id
        into v_connection_id
        from public.eos_financial_connections_v1 connection
       where connection.usuario_id = p_usuario_id
         and connection.provider_key = v_provider_key
         and connection.connection_key = v_event ->> 'connectionKey';
      select account.id
        into v_account_id
        from public.eos_financial_accounts_v1 account
       where account.usuario_id = p_usuario_id
         and account.connection_id = v_connection_id
         and account.external_account_id = v_event ->> 'accountExternalId';
      if v_connection_id is null or v_account_id is null then
        raise exception using errcode = '23503',
          message = 'financial_multi_provider_ingestion_parent_missing';
      end if;

      select *
        into v_existing_event
        from public.eos_financial_ingestion_events_v1 event
       where event.usuario_id = p_usuario_id
         and event.provider_key = v_provider_key
         and event.connection_id = v_connection_id
         and event.external_event_id = v_event ->> 'externalEventId';

      if found then
        if v_existing_event.account_id is distinct from v_account_id
           or v_existing_event.event_type
              is distinct from v_event ->> 'eventType'
           or v_existing_event.provider_status
              is distinct from v_event ->> 'providerStatus'
           or v_existing_event.occurred_at is distinct from
              nullif(v_event ->> 'occurredAt', '')::timestamptz
           or v_existing_event.received_at is distinct from
              nullif(v_event ->> 'receivedAt', '')::timestamptz
           or v_existing_event.payload_hash
              is distinct from v_event ->> 'payloadHash'
           or v_existing_event.source_fingerprint
              is distinct from v_event ->> 'sourceFingerprint'
           or v_existing_event.metadata ->> 'sourceEventKey'
              is distinct from v_event ->> 'sourceEventKey' then
          raise exception using errcode = '23505',
            message = 'financial_multi_provider_ingestion_replay_mismatch';
        end if;
      else
        if exists (
          select 1
            from public.eos_financial_ingestion_events_v1 event
           where event.usuario_id = p_usuario_id
             and event.provider_key = v_provider_key
             and event.source_fingerprint = v_event ->> 'sourceFingerprint'
        ) then
          raise exception using errcode = '23505',
            message = 'financial_multi_provider_ingestion_fingerprint_reused';
        end if;

        insert into public.eos_financial_ingestion_events_v1 (
          usuario_id,
          connection_id,
          account_id,
          provider_key,
          external_event_id,
          event_type,
          provider_status,
          occurred_at,
          received_at,
          payload_hash,
          source_fingerprint,
          metadata
        ) values (
          p_usuario_id,
          v_connection_id,
          v_account_id,
          v_provider_key,
          v_event ->> 'externalEventId',
          v_event ->> 'eventType',
          v_event ->> 'providerStatus',
          nullif(v_event ->> 'occurredAt', '')::timestamptz,
          nullif(v_event ->> 'receivedAt', '')::timestamptz,
          v_event ->> 'payloadHash',
          v_event ->> 'sourceFingerprint',
          pg_catalog.jsonb_build_object(
            'sourceEventKey', v_event ->> 'sourceEventKey',
            'providerKey', v_provider_key
          )
        );
        v_ingestion_rows_touched := v_ingestion_rows_touched + 1;
      end if;
    end loop;

    for v_ledger in
      select item.value
        from pg_catalog.jsonb_array_elements(
          v_provider_plan -> 'ledgerUpserts'
        ) as item(value)
    loop
      v_connection_id := null;
      v_account_id := null;
      v_source_event_id := null;
      select connection.id
        into v_connection_id
        from public.eos_financial_connections_v1 connection
       where connection.usuario_id = p_usuario_id
         and connection.provider_key = v_provider_key
         and connection.connection_key = v_ledger ->> 'connectionKey';
      select account.id
        into v_account_id
        from public.eos_financial_accounts_v1 account
       where account.usuario_id = p_usuario_id
         and account.connection_id = v_connection_id
         and account.external_account_id = v_ledger ->> 'accountExternalId';
      select event.id
        into v_source_event_id
        from public.eos_financial_ingestion_events_v1 event
       where event.usuario_id = p_usuario_id
         and event.provider_key = v_provider_key
         and event.connection_id = v_connection_id
         and event.account_id = v_account_id
         and event.external_event_id = v_ledger ->> 'sourceEventKey';
      if v_connection_id is null
         or v_account_id is null
         or v_source_event_id is null then
        raise exception using errcode = '23503',
          message = 'financial_multi_provider_ledger_source_missing';
      end if;

      insert into public.eos_financial_ledger_v1 as target_row (
        usuario_id,
        account_id,
        source_event_id,
        canonical_key,
        external_transaction_id,
        transaction_type,
        direction,
        status,
        amount_minor,
        currency,
        occurred_at,
        posted_at,
        description_raw,
        merchant_normalized,
        category,
        subcategory,
        counterparty_ref,
        confidence,
        provenance,
        metadata
      ) values (
        p_usuario_id,
        v_account_id,
        v_source_event_id,
        v_ledger ->> 'canonicalKey',
        nullif(v_ledger ->> 'externalTransactionId', ''),
        v_ledger ->> 'transactionType',
        v_ledger ->> 'direction',
        v_ledger ->> 'status',
        (v_ledger ->> 'amountMinor')::bigint,
        v_ledger ->> 'currency',
        (v_ledger ->> 'occurredAt')::timestamptz,
        nullif(v_ledger ->> 'postedAt', '')::timestamptz,
        nullif(v_ledger ->> 'descriptionRaw', ''),
        nullif(v_ledger ->> 'merchantNormalized', ''),
        nullif(v_ledger ->> 'category', ''),
        nullif(v_ledger ->> 'subcategory', ''),
        nullif(v_ledger ->> 'counterpartyRef', ''),
        (v_ledger ->> 'confidence')::numeric,
        v_ledger ->> 'provenance',
        pg_catalog.jsonb_build_object(
          'providerKey', v_provider_key,
          'recurrenceKey', v_ledger -> 'recurrenceKey'
        )
      )
      on conflict (usuario_id, canonical_key)
      do update set
        account_id = excluded.account_id,
        source_event_id = excluded.source_event_id,
        external_transaction_id = excluded.external_transaction_id,
        transaction_type = excluded.transaction_type,
        direction = excluded.direction,
        status = excluded.status,
        amount_minor = excluded.amount_minor,
        currency = excluded.currency,
        occurred_at = excluded.occurred_at,
        posted_at = excluded.posted_at,
        description_raw = excluded.description_raw,
        merchant_normalized = excluded.merchant_normalized,
        category = excluded.category,
        subcategory = excluded.subcategory,
        counterparty_ref = excluded.counterparty_ref,
        confidence = excluded.confidence,
        provenance = excluded.provenance,
        metadata = excluded.metadata,
        updated_at = pg_catalog.now()
      where (
        target_row.account_id,
        target_row.source_event_id,
        target_row.external_transaction_id,
        target_row.transaction_type,
        target_row.direction,
        target_row.status,
        target_row.amount_minor,
        target_row.currency,
        target_row.occurred_at,
        target_row.posted_at,
        target_row.description_raw,
        target_row.merchant_normalized,
        target_row.category,
        target_row.subcategory,
        target_row.counterparty_ref,
        target_row.confidence,
        target_row.provenance,
        target_row.metadata
      ) is distinct from (
        excluded.account_id,
        excluded.source_event_id,
        excluded.external_transaction_id,
        excluded.transaction_type,
        excluded.direction,
        excluded.status,
        excluded.amount_minor,
        excluded.currency,
        excluded.occurred_at,
        excluded.posted_at,
        excluded.description_raw,
        excluded.merchant_normalized,
        excluded.category,
        excluded.subcategory,
        excluded.counterparty_ref,
        excluded.confidence,
        excluded.provenance,
        excluded.metadata
      );
      get diagnostics v_row_count = row_count;
      v_ledger_rows_touched := v_ledger_rows_touched + v_row_count;
    end loop;
  end loop;

  -- Resolve reversals only after every provider's Ledger rows exist. This also
  -- supports a valid cross-provider canonical reversal reference.
  for v_ledger in
    select ledger.value
      from pg_catalog.jsonb_array_elements(v_provider_plans) as provider(value)
      cross join lateral pg_catalog.jsonb_array_elements(
        provider.value -> 'ledgerUpserts'
      ) as ledger(value)
  loop
    if nullif(v_ledger ->> 'reversalCanonicalKey', '') is not null then
      if v_ledger ->> 'reversalCanonicalKey'
         !~ '^(ext|src|fp):[0-9a-f]{64}$' then
        raise exception using errcode = '22023',
          message = 'financial_multi_provider_reversal_invalid_identity';
      end if;

      v_original_ledger_id := null;
      select original.id
        into v_original_ledger_id
        from public.eos_financial_ledger_v1 original
       where original.usuario_id = p_usuario_id
         and original.canonical_key = v_ledger ->> 'reversalCanonicalKey';
      if v_original_ledger_id is null then
        raise exception using errcode = '23503',
          message = 'financial_multi_provider_reversal_source_missing';
      end if;

      update public.eos_financial_ledger_v1 target
         set reversal_of = v_original_ledger_id,
             updated_at = pg_catalog.now()
       where target.usuario_id = p_usuario_id
         and target.canonical_key = v_ledger ->> 'canonicalKey'
         and target.reversal_of is distinct from v_original_ledger_id;
    end if;
  end loop;

  if pg_catalog.jsonb_typeof(v_global_context) = 'object' then
    if exists (
      select 1
        from public.eos_financial_contexts_v1 context
       where context.usuario_id = p_usuario_id
         and (
           context.revision = v_global_context_revision or
           context.source_fingerprint = v_global_context_source_fingerprint
         )
         and not (
           context.revision = v_global_context_revision
           and context.source_fingerprint = v_global_context_source_fingerprint
           and context.currency = v_global_context ->> 'currency'
           and context.status = v_global_context ->> 'status'
           and context.horizon_until =
             (v_global_context ->> 'horizonUntil')::timestamptz
           and context.horizon_reason = v_global_context ->> 'horizonReason'
           and context.liquidity_usable_minor =
             (v_global_context ->> 'liquidityUsableMinor')::bigint
           and context.protected_commitments_minor =
             (v_global_context ->> 'protectedCommitmentsMinor')::bigint
           and context.essential_spend_expected_minor =
             (v_global_context ->> 'essentialSpendExpectedMinor')::bigint
           and context.protected_reserve_minor =
             (v_global_context ->> 'protectedReserveMinor')::bigint
           and context.critical_provisions_minor =
             (v_global_context ->> 'criticalProvisionsMinor')::bigint
           and context.confirmed_income_minor =
             (v_global_context ->> 'confirmedIncomeMinor')::bigint
           and context.uncertainty_buffer_minor =
             (v_global_context ->> 'uncertaintyBufferMinor')::bigint
           and context.available_real_safe_minor =
             (v_global_context ->> 'availableRealSafeMinor')::bigint
           and context.minimum_projected_cash_minor is not distinct from
             nullif(
               v_global_context ->> 'minimumProjectedCashMinor',
               ''
             )::bigint
           and context.minimum_projected_cash_at is not distinct from
             nullif(
               v_global_context ->> 'minimumProjectedCashAt',
               ''
             )::timestamptz
           and context.confidence = v_global_context -> 'confidence'
           and context.explanation_refs = v_global_context -> 'explanationRefs'
           and context.sources_fresh = v_sources_fresh
           and context.first_forecast_risk =
             v_global_context -> 'firstForecastRisk'
           and context.critical_sources_complete =
             v_critical_sources_complete
           and context.critical_obligations_complete =
             v_critical_obligations_complete
           and context.generated_at =
             (v_global_context ->> 'generatedAt')::timestamptz
           and context.valid_until is not distinct from
             nullif(v_global_context ->> 'validUntil', '')::timestamptz
         )
    ) then
      raise exception using errcode = '23505',
        message = 'financial_multi_provider_global_context_replay_mismatch';
    end if;

    if not exists (
      select 1
        from public.eos_financial_contexts_v1 context
       where context.usuario_id = p_usuario_id
         and context.revision = v_global_context_revision
         and context.source_fingerprint = v_global_context_source_fingerprint
    ) then
      insert into public.eos_financial_contexts_v1 (
        usuario_id,
        revision,
        currency,
        status,
        horizon_until,
        horizon_reason,
        liquidity_usable_minor,
        protected_commitments_minor,
        essential_spend_expected_minor,
        protected_reserve_minor,
        critical_provisions_minor,
        confirmed_income_minor,
        uncertainty_buffer_minor,
        available_real_safe_minor,
        minimum_projected_cash_minor,
        minimum_projected_cash_at,
        confidence,
        explanation_refs,
        sources_fresh,
        source_fingerprint,
        generated_at,
        valid_until,
        first_forecast_risk,
        critical_obligations_complete,
        critical_sources_complete
      ) values (
        p_usuario_id,
        v_global_context_revision,
        v_global_context ->> 'currency',
        v_global_context ->> 'status',
        (v_global_context ->> 'horizonUntil')::timestamptz,
        v_global_context ->> 'horizonReason',
        (v_global_context ->> 'liquidityUsableMinor')::bigint,
        (v_global_context ->> 'protectedCommitmentsMinor')::bigint,
        (v_global_context ->> 'essentialSpendExpectedMinor')::bigint,
        (v_global_context ->> 'protectedReserveMinor')::bigint,
        (v_global_context ->> 'criticalProvisionsMinor')::bigint,
        (v_global_context ->> 'confirmedIncomeMinor')::bigint,
        (v_global_context ->> 'uncertaintyBufferMinor')::bigint,
        (v_global_context ->> 'availableRealSafeMinor')::bigint,
        nullif(
          v_global_context ->> 'minimumProjectedCashMinor',
          ''
        )::bigint,
        nullif(
          v_global_context ->> 'minimumProjectedCashAt',
          ''
        )::timestamptz,
        v_global_context -> 'confidence',
        v_global_context -> 'explanationRefs',
        v_sources_fresh,
        v_global_context_source_fingerprint,
        (v_global_context ->> 'generatedAt')::timestamptz,
        nullif(v_global_context ->> 'validUntil', '')::timestamptz,
        v_global_context -> 'firstForecastRisk',
        v_critical_obligations_complete,
        v_critical_sources_complete
      );
    end if;

    -- The separately owned marker is the final insert in the transaction. Its
    -- existence proves commitment of an exact evidence/context set, not SAFE.
    if exists (
      select 1
        from public.eos_financial_global_context_commits_v1_3 marker
       where marker.usuario_id = p_usuario_id
         and (
           marker.commit_fingerprint = v_global_commit_fingerprint or
           marker.context_revision = v_global_context_revision or
           marker.context_source_fingerprint =
             v_global_context_source_fingerprint
         )
         and not (
           marker.commit_fingerprint = v_global_commit_fingerprint
           and marker.manifest_fingerprint = v_manifest_fingerprint
           and marker.context_revision = v_global_context_revision
           and marker.context_source_fingerprint =
             v_global_context_source_fingerprint
           and marker.global_coverage_fingerprint =
             v_global_context ->> 'globalCoverageFingerprint'
           and marker.source_orchestration_fingerprint =
             v_global_context ->> 'sourceOrchestrationFingerprint'
           and marker.analysis_fingerprint =
             v_global_context ->> 'analysisFingerprint'
           and marker.global_result_fingerprint =
             v_global_context ->> 'globalResultFingerprint'
           and marker.provider_bindings = v_provider_bindings
           and marker.committed_at = v_generated_at::timestamptz
         )
    ) then
      raise exception using errcode = '23505',
        message = 'financial_multi_provider_global_commit_replay_mismatch';
    end if;

    if not exists (
      select 1
        from public.eos_financial_global_context_commits_v1_3 marker
       where marker.usuario_id = p_usuario_id
         and marker.commit_fingerprint = v_global_commit_fingerprint
    ) then
      insert into public.eos_financial_global_context_commits_v1_3 (
        usuario_id,
        commit_fingerprint,
        manifest_fingerprint,
        context_revision,
        context_source_fingerprint,
        global_coverage_fingerprint,
        source_orchestration_fingerprint,
        analysis_fingerprint,
        global_result_fingerprint,
        provider_bindings,
        committed_at
      ) values (
        p_usuario_id,
        v_global_commit_fingerprint,
        v_manifest_fingerprint,
        v_global_context_revision,
        v_global_context_source_fingerprint,
        v_global_context ->> 'globalCoverageFingerprint',
        v_global_context ->> 'sourceOrchestrationFingerprint',
        v_global_context ->> 'analysisFingerprint',
        v_global_context ->> 'globalResultFingerprint',
        v_provider_bindings,
        v_generated_at::timestamptz
      );
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'replayed', false,
    'planFingerprint', v_plan_fingerprint,
    'globalContextRevision', v_global_context_revision,
    'globalContextCommitFingerprint', v_global_commit_fingerprint,
    'providerScopesTouched', v_provider_scopes_touched,
    'ledgerRowsTouched', v_ledger_rows_touched,
    'ingestionRowsTouched', v_ingestion_rows_touched
  );
end;
$$;

-- Fail closed by default. The function is callable only through a trusted
-- server/service boundary; browser roles cannot execute it or inspect receipts.
revoke all on function public.eos_financial_persist_multi_provider_v1_3(uuid, jsonb)
  from public;
revoke all on function public.eos_financial_persist_multi_provider_v1_3(uuid, jsonb)
  from anon;
revoke all on function public.eos_financial_persist_multi_provider_v1_3(uuid, jsonb)
  from authenticated;
grant execute on function public.eos_financial_persist_multi_provider_v1_3(uuid, jsonb)
  to service_role;

-- Promotion gates before this draft may become a real migration:
--   1. validate canonical JSON/SHA parity against TypeScript fixtures;
--   2. fresh write + exact replay + conflicting replay;
--   3. two concurrent sessions for the same user;
--   4. late-provider failure proves complete rollback;
--   5. cross-user/provider/account substitution fails before mutation;
--   6. incomplete closure persists raw scopes with no global context/commit;
--   7. complete-but-stale context commits as DEGRADED, never synthetic SAFE;
--   8. anon/authenticated EXECUTE denied and receipt tables unreadable;
--   9. Security/Performance Advisors clean or explicitly dispositioned;
--  10. rollback rehearsal completed;
--  11. no production application until EOS 4.0 RC1 gates close.
