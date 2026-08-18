-- EOS Financial Autopilot — source onboarding persistence RPC v1
-- DESIGN / NON-PRODUCTION VALIDATION ONLY. DO NOT APPLY DURING RC1.
-- Required predecessors: SCHEMA_V1_DRAFT.sql and
-- PERSISTENCE_MULTI_PROVIDER_RPC_V1_3_DRAFT.sql (canonical SHA helper).

create table if not exists public.eos_financial_source_onboarding_commits_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  consent jsonb not null,
  consent_fingerprint text not null check (consent_fingerprint ~ '^[0-9a-f]{64}$'),
  inventory jsonb not null,
  inventory_fingerprint text not null check (inventory_fingerprint ~ '^[0-9a-f]{64}$'),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (usuario_id, version),
  unique (usuario_id, consent_fingerprint, inventory_fingerprint)
);

create unique index if not exists eos_fin_source_onboarding_one_active_uidx
  on public.eos_financial_source_onboarding_commits_v1(usuario_id)
  where superseded_at is null;

alter table public.eos_financial_source_onboarding_commits_v1 enable row level security;
revoke all on table public.eos_financial_source_onboarding_commits_v1
  from public, anon, authenticated;

create or replace function public.eos_financial_persist_source_onboarding_v1(
  p_usuario_id uuid,
  p_consent jsonb,
  p_consent_fingerprint text,
  p_inventory jsonb,
  p_inventory_fingerprint text,
  p_expected_current_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.eos_financial_source_onboarding_commits_v1%rowtype;
  v_created public.eos_financial_source_onboarding_commits_v1%rowtype;
  v_source jsonb;
  v_current_version integer;
begin
  if p_usuario_id is null then
    raise exception 'financial_source_onboarding_missing_user' using errcode = '22023';
  end if;
  if p_expected_current_version is null or p_expected_current_version < 0 then
    raise exception 'financial_source_onboarding_invalid_expected_version' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_consent) <> 'object'
    or (select count(*) from pg_catalog.jsonb_object_keys(p_consent)) <> 8
    or not p_consent ?& array['version','userId','providerKey','grantedAt','validUntil','revokedAt','readScopes','movementAuthority']
    or p_consent ->> 'version' <> 'financial-read-consent-v1'
    or p_consent ->> 'userId' <> p_usuario_id::text
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_consent ->> 'providerKey', ''))) not between 1 and 128
    or p_consent -> 'movementAuthority' <> 'false'::jsonb
    or p_consent -> 'revokedAt' <> 'null'::jsonb
    or pg_catalog.jsonb_typeof(p_consent -> 'readScopes') <> 'array'
    or pg_catalog.jsonb_array_length(p_consent -> 'readScopes') <> 4
    or not (p_consent -> 'readScopes') ?& array['ACCOUNTS_READ','BALANCES_READ','LIABILITIES_READ','TRANSACTIONS_READ']
  then
    raise exception 'financial_source_onboarding_invalid_consent' using errcode = '22023';
  end if;
  if (p_consent ->> 'grantedAt')::timestamptz > pg_catalog.now() + interval '5 minutes'
    or (p_consent ->> 'validUntil')::timestamptz <= pg_catalog.now()
    or (p_consent ->> 'validUntil')::timestamptz <= (p_consent ->> 'grantedAt')::timestamptz
  then
    raise exception 'financial_source_onboarding_invalid_consent_window' using errcode = '22023';
  end if;
  if p_consent_fingerprint !~ '^[0-9a-f]{64}$'
    or p_consent_fingerprint <> eos_private.eos_financial_sha256_json_v1(p_consent)
  then
    raise exception 'financial_source_onboarding_consent_fingerprint_mismatch' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_inventory) <> 'object'
    or (select count(*) from pg_catalog.jsonb_object_keys(p_inventory)) <> 10
    or not p_inventory ?& array['contract','userId','asOf','validUntil','authority','scope','discoveryComplete','confidence','unresolvedMaterialSourceCount','expectedSources']
    or p_inventory ->> 'contract' <> 'trusted-financial-source-inventory-v1'
    or p_inventory ->> 'userId' <> p_usuario_id::text
    or p_inventory ->> 'authority' not in ('user_confirmed','provider_discovery','verified_document')
    or p_inventory ->> 'scope' not in ('global_user_finances','institution','provider_connection')
    or pg_catalog.jsonb_typeof(p_inventory -> 'discoveryComplete') <> 'boolean'
    or pg_catalog.jsonb_typeof(p_inventory -> 'confidence') <> 'number'
    or (p_inventory ->> 'confidence')::numeric < 0
    or (p_inventory ->> 'confidence')::numeric > 1
    or coalesce(p_inventory ->> 'unresolvedMaterialSourceCount','') !~ '^[0-9]+$'
    or pg_catalog.jsonb_typeof(p_inventory -> 'expectedSources') <> 'array'
  then
    raise exception 'financial_source_onboarding_invalid_inventory' using errcode = '22023';
  end if;
  if (p_inventory ->> 'asOf')::timestamptz > pg_catalog.now() + interval '5 minutes'
    or (p_inventory ->> 'validUntil')::timestamptz <= (p_inventory ->> 'asOf')::timestamptz
  then
    raise exception 'financial_source_onboarding_invalid_inventory_window' using errcode = '22023';
  end if;
  for v_source in select value from pg_catalog.jsonb_array_elements(p_inventory -> 'expectedSources') loop
    if pg_catalog.jsonb_typeof(v_source) <> 'object'
      or (select count(*) from pg_catalog.jsonb_object_keys(v_source)) <> 3
      or not v_source ?& array['sourceRef','materiality','confidence']
      or coalesce(v_source ->> 'sourceRef','') !~ '^fin-source:[0-9a-f]{64}$'
      or v_source ->> 'materiality' not in ('critical','material','optional')
      or pg_catalog.jsonb_typeof(v_source -> 'confidence') <> 'number'
      or (v_source ->> 'confidence')::numeric < 0
      or (v_source ->> 'confidence')::numeric > 1
    then
      raise exception 'financial_source_onboarding_invalid_expected_source' using errcode = '22023';
    end if;
  end loop;
  if p_inventory_fingerprint !~ '^[0-9a-f]{64}$'
    or p_inventory_fingerprint <> eos_private.eos_financial_sha256_json_v1(p_inventory)
  then
    raise exception 'financial_source_onboarding_inventory_fingerprint_mismatch' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('eos-financial-source-onboarding:' || p_usuario_id::text, 0)
  );
  select * into v_current
    from public.eos_financial_source_onboarding_commits_v1
    where usuario_id = p_usuario_id and superseded_at is null
    order by version desc limit 1 for update;

  if found and v_current.consent_fingerprint = p_consent_fingerprint
    and v_current.inventory_fingerprint = p_inventory_fingerprint
  then
    if v_current.consent <> p_consent or v_current.inventory <> p_inventory then
      raise exception 'financial_source_onboarding_replay_mismatch' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('commitId',v_current.id,'version',v_current.version,'consentFingerprint',v_current.consent_fingerprint,'inventoryFingerprint',v_current.inventory_fingerprint,'replayed',true);
  end if;

  v_current_version := coalesce(v_current.version, 0);
  if v_current_version <> p_expected_current_version then
    raise exception 'financial_source_onboarding_version_conflict' using errcode = '40001';
  end if;
  if v_current.id is not null then
    update public.eos_financial_source_onboarding_commits_v1
      set superseded_at = pg_catalog.transaction_timestamp() where id = v_current.id;
  end if;
  insert into public.eos_financial_source_onboarding_commits_v1(
    usuario_id,version,consent,consent_fingerprint,inventory,inventory_fingerprint
  ) values (
    p_usuario_id,v_current_version + 1,p_consent,p_consent_fingerprint,p_inventory,p_inventory_fingerprint
  ) returning * into v_created;
  return pg_catalog.jsonb_build_object('commitId',v_created.id,'version',v_created.version,'consentFingerprint',v_created.consent_fingerprint,'inventoryFingerprint',v_created.inventory_fingerprint,'replayed',false);
end;
$$;

revoke all on function public.eos_financial_persist_source_onboarding_v1(
  uuid,jsonb,text,jsonb,text,integer
) from public, anon, authenticated;
grant execute on function public.eos_financial_persist_source_onboarding_v1(
  uuid,jsonb,text,jsonb,text,integer
) to service_role;
