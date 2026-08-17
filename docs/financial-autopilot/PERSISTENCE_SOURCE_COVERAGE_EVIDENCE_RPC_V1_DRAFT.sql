-- EOS Financial Autopilot — independent source coverage evidence v1
-- DESIGN / NON-PRODUCTION ONLY. DO NOT APPLY DURING EOS 4.0 RC1.

create table if not exists public.eos_financial_source_coverage_evidence_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  inventory_fingerprint text not null check (inventory_fingerprint ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null,
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  resolved_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique (usuario_id, evidence_fingerprint)
);
create index if not exists eos_fin_coverage_evidence_user_valid_idx
  on public.eos_financial_source_coverage_evidence_v1(usuario_id, valid_until desc);
alter table public.eos_financial_source_coverage_evidence_v1 enable row level security;
revoke all on table public.eos_financial_source_coverage_evidence_v1 from public, anon, authenticated;

create or replace function public.eos_financial_persist_source_coverage_evidence_v1(
  p_usuario_id uuid,
  p_evidence jsonb,
  p_evidence_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.eos_financial_source_coverage_evidence_v1%rowtype;
  v_created public.eos_financial_source_coverage_evidence_v1%rowtype;
begin
  if p_usuario_id is null or pg_catalog.jsonb_typeof(p_evidence) <> 'object'
    or (select count(*) from pg_catalog.jsonb_object_keys(p_evidence)) <> 15
    or not p_evidence ?& array['version','userId','inventoryFingerprint','resolvedAt','validUntil','criticalSourcesComplete','criticalSourcesFresh','expectedMaterialCount','connectedMaterialCount','missingMaterialCount','staleConnectedSourceCount','connectedSourceCount','reasonCodes','freshnessReasonCodes','fingerprint']
    or p_evidence ->> 'version' <> 'source-coverage-evidence-v1'
    or p_evidence ->> 'userId' <> p_usuario_id::text
    or coalesce(p_evidence ->> 'inventoryFingerprint','') !~ '^[0-9a-f]{64}$'
    or p_evidence ->> 'fingerprint' <> p_evidence_fingerprint
  then raise exception 'financial_coverage_evidence_invalid_identity' using errcode = '22023'; end if;
  if p_evidence_fingerprint !~ '^[0-9a-f]{64}$'
    or p_evidence_fingerprint <> eos_private.eos_financial_sha256_json_v1(p_evidence - 'fingerprint')
  then raise exception 'financial_coverage_evidence_fingerprint_mismatch' using errcode = '22023'; end if;
  if (p_evidence ->> 'validUntil')::timestamptz <= (p_evidence ->> 'resolvedAt')::timestamptz
    or (p_evidence ->> 'resolvedAt')::timestamptz > pg_catalog.now() + interval '5 minutes'
    or pg_catalog.jsonb_typeof(p_evidence -> 'reasonCodes') <> 'array'
    or pg_catalog.jsonb_typeof(p_evidence -> 'freshnessReasonCodes') <> 'array'
  then raise exception 'financial_coverage_evidence_invalid_window' using errcode = '22023'; end if;
  if coalesce(p_evidence ->> 'expectedMaterialCount','') !~ '^[0-9]+$'
    or coalesce(p_evidence ->> 'connectedMaterialCount','') !~ '^[0-9]+$'
    or coalesce(p_evidence ->> 'missingMaterialCount','') !~ '^[0-9]+$'
    or coalesce(p_evidence ->> 'staleConnectedSourceCount','') !~ '^[0-9]+$'
    or coalesce(p_evidence ->> 'connectedSourceCount','') !~ '^[0-9]+$'
    or (p_evidence ->> 'connectedMaterialCount')::integer + (p_evidence ->> 'missingMaterialCount')::integer <> (p_evidence ->> 'expectedMaterialCount')::integer
  then raise exception 'financial_coverage_evidence_invalid_counts' using errcode = '22023'; end if;
  if (p_evidence ->> 'criticalSourcesComplete')::boolean
    and ((p_evidence ->> 'missingMaterialCount')::integer <> 0 or pg_catalog.jsonb_array_length(p_evidence -> 'reasonCodes') <> 0)
  then raise exception 'financial_coverage_evidence_false_complete' using errcode = '22023'; end if;

  select * into v_existing from public.eos_financial_source_coverage_evidence_v1
    where usuario_id = p_usuario_id and evidence_fingerprint = p_evidence_fingerprint;
  if found then
    if v_existing.evidence <> p_evidence then raise exception 'financial_coverage_evidence_replay_mismatch' using errcode = '23505'; end if;
    return pg_catalog.jsonb_build_object('evidenceId',v_existing.id,'evidenceFingerprint',v_existing.evidence_fingerprint,'replayed',true);
  end if;
  insert into public.eos_financial_source_coverage_evidence_v1(usuario_id,inventory_fingerprint,evidence,evidence_fingerprint,resolved_at,valid_until)
    values (p_usuario_id,p_evidence ->> 'inventoryFingerprint',p_evidence,p_evidence_fingerprint,(p_evidence ->> 'resolvedAt')::timestamptz,(p_evidence ->> 'validUntil')::timestamptz)
    returning * into v_created;
  return pg_catalog.jsonb_build_object('evidenceId',v_created.id,'evidenceFingerprint',v_created.evidence_fingerprint,'replayed',false);
end;
$$;
revoke all on function public.eos_financial_persist_source_coverage_evidence_v1(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.eos_financial_persist_source_coverage_evidence_v1(uuid,jsonb,text) to service_role;
