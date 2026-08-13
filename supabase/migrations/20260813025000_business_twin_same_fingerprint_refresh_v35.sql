create or replace function public.eos_commit_business_twin_v34(
  p_source_revision bigint,
  p_model_version text,
  p_source_fingerprint text,
  p_identity jsonb,
  p_current_state jsonb,
  p_desired_state jsonb,
  p_gaps jsonb,
  p_constraints jsonb,
  p_capabilities jsonb,
  p_risks jsonb,
  p_opportunities jsonb,
  p_priorities jsonb,
  p_execution_profile jsonb,
  p_learning_profile jsonb,
  p_autonomy_profile jsonb,
  p_intelligence_score integer,
  p_confidence numeric,
  p_source_completeness numeric,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_revision bigint;
  v_current public.eos_business_twins_v14%rowtype;
  v_saved public.eos_business_twins_v14%rowtype;
  v_version integer := 1;
begin
  if v_uid is null then
    raise exception 'EOS_UNAUTHENTICATED';
  end if;

  if p_source_revision is null or p_source_revision < 0 then
    raise exception 'EOS_TWIN_SOURCE_REVISION_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_source_fingerprint, '')), '') is null then
    raise exception 'EOS_TWIN_FINGERPRINT_REQUIRED';
  end if;

  if p_intelligence_score is not null and (p_intelligence_score < 0 or p_intelligence_score > 100) then
    raise exception 'EOS_TWIN_SCORE_INVALID';
  end if;

  if p_confidence < 0 or p_confidence > 1 or p_source_completeness < 0 or p_source_completeness > 1 then
    raise exception 'EOS_TWIN_CONFIDENCE_INVALID';
  end if;

  perform 1
  from public.usuarios
  where id = v_uid
  for update;

  if not found then
    raise exception 'EOS_TWIN_USER_NOT_FOUND';
  end if;

  insert into public.eos_business_twin_source_state_v34 (usuario_id, revision, changed_at, last_source)
  values (v_uid, 0, now(), 'commit-init')
  on conflict (usuario_id) do nothing;

  select s.revision into v_revision
  from public.eos_business_twin_source_state_v34 s
  where s.usuario_id = v_uid
  for update;

  if v_revision is distinct from p_source_revision then
    raise exception 'EOS_TWIN_SOURCE_CHANGED';
  end if;

  select t.* into v_current
  from public.eos_business_twins_v14 t
  where t.usuario_id = v_uid
  for update;

  if found and v_current.source_fingerprint = p_source_fingerprint then
    update public.eos_business_twins_v14
    set generated_at = now(),
        valid_until = now() + interval '6 hours',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'commit_version', 'v35',
          'source_revision', v_revision,
          'source_revision_guard', true,
          'same_fingerprint_refresh', true
        )
    where usuario_id = v_uid
    returning * into v_current;

    return jsonb_build_object(
      'twin', to_jsonb(v_current),
      'changed', false,
      'source_revision', v_revision,
      'stale', false,
      'refreshed', true
    );
  end if;

  if v_current.usuario_id is not null then
    v_version := v_current.version + 1;
  end if;

  insert into public.eos_business_twins_v14 (
    usuario_id, version, model_version, source_fingerprint, identity, current_state,
    desired_state, gaps, constraints, capabilities, risks, opportunities, priorities,
    execution_profile, learning_profile, autonomy_profile, intelligence_score,
    confidence, source_completeness, generated_at, valid_until, metadata
  ) values (
    v_uid, v_version,
    left(coalesce(nullif(btrim(p_model_version), ''), 'business-twin-v14'), 120),
    p_source_fingerprint,
    coalesce(p_identity, '{}'::jsonb), coalesce(p_current_state, '{}'::jsonb),
    coalesce(p_desired_state, '{}'::jsonb), coalesce(p_gaps, '[]'::jsonb),
    coalesce(p_constraints, '[]'::jsonb), coalesce(p_capabilities, '[]'::jsonb),
    coalesce(p_risks, '[]'::jsonb), coalesce(p_opportunities, '[]'::jsonb),
    coalesce(p_priorities, '[]'::jsonb), coalesce(p_execution_profile, '{}'::jsonb),
    coalesce(p_learning_profile, '{}'::jsonb), coalesce(p_autonomy_profile, '{}'::jsonb),
    p_intelligence_score, p_confidence, p_source_completeness, now(),
    now() + interval '6 hours',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'commit_version', 'v35', 'source_revision', v_revision, 'source_revision_guard', true
    )
  )
  on conflict (usuario_id) do update set
    version = excluded.version,
    model_version = excluded.model_version,
    source_fingerprint = excluded.source_fingerprint,
    identity = excluded.identity,
    current_state = excluded.current_state,
    desired_state = excluded.desired_state,
    gaps = excluded.gaps,
    constraints = excluded.constraints,
    capabilities = excluded.capabilities,
    risks = excluded.risks,
    opportunities = excluded.opportunities,
    priorities = excluded.priorities,
    execution_profile = excluded.execution_profile,
    learning_profile = excluded.learning_profile,
    autonomy_profile = excluded.autonomy_profile,
    intelligence_score = excluded.intelligence_score,
    confidence = excluded.confidence,
    source_completeness = excluded.source_completeness,
    generated_at = excluded.generated_at,
    valid_until = excluded.valid_until,
    metadata = excluded.metadata
  returning * into v_saved;

  return jsonb_build_object(
    'twin', to_jsonb(v_saved),
    'changed', true,
    'source_revision', v_revision,
    'stale', false,
    'refreshed', false
  );
end;
$$;

revoke all on function public.eos_commit_business_twin_v34(bigint, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, numeric, numeric, jsonb) from public, anon, service_role;
grant execute on function public.eos_commit_business_twin_v34(bigint, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, numeric, numeric, jsonb) to authenticated;

comment on function public.eos_commit_business_twin_v34(bigint, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, numeric, numeric, jsonb) is
  'RC1 v35: commit self-scoped del Twin con source-revision guard; fingerprint identico renueva vigencia sin incrementar version ni generar snapshot.';