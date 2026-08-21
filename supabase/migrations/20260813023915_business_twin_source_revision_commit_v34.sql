-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

create table if not exists public.eos_business_twin_source_state_v34 (
  usuario_id uuid primary key references public.usuarios(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  changed_at timestamptz not null default now(),
  last_source text,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.eos_business_twin_source_state_v34 enable row level security;
revoke all on table public.eos_business_twin_source_state_v34 from public, anon, authenticated;
grant all on table public.eos_business_twin_source_state_v34 to service_role;

insert into public.eos_business_twin_source_state_v34 (usuario_id, revision, changed_at, last_source)
select u.id, 0, now(), 'v34-baseline'
from public.usuarios u
on conflict (usuario_id) do nothing;

create or replace function public.eos_invalidate_business_twin_v34()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  v_source text := tg_table_name;
  v_semantic_score_changed boolean := true;
begin
  if tg_op = 'DELETE' then
    owner_id := old.usuario_id;
  else
    owner_id := new.usuario_id;
  end if;

  if tg_table_name = 'eos_intelligence_score_snapshots_v10' and tg_op = 'UPDATE' then
    v_semantic_score_changed := not (
      old.snapshot_day is not distinct from new.snapshot_day
      and old.score is not distinct from new.score
      and old.contexto is not distinct from new.contexto
      and old.objetivos is not distinct from new.objetivos
      and old.ejecucion is not distinct from new.ejecucion
      and old.decisiones is not distinct from new.decisiones
      and old.aprendizaje is not distinct from new.aprendizaje
      and old.active_goals is not distinct from new.active_goals
      and old.pending_alerts is not distinct from new.pending_alerts
      and old.critical_alerts is not distinct from new.critical_alerts
      and old.completed_actions is not distinct from new.completed_actions
      and old.measured_decisions is not distinct from new.measured_decisions
      and old.learning_evidence is not distinct from new.learning_evidence
      and old.strongest_dimension is not distinct from new.strongest_dimension
      and old.weakest_dimension is not distinct from new.weakest_dimension
      and old.formula_version is not distinct from new.formula_version
    );

    if not v_semantic_score_changed then
      return new;
    end if;
  end if;

  if owner_id is not null then
    insert into public.eos_business_twin_source_state_v34 (
      usuario_id,
      revision,
      changed_at,
      last_source,
      metadata
    ) values (
      owner_id,
      1,
      now(),
      v_source,
      jsonb_build_object('trigger_op', tg_op)
    )
    on conflict (usuario_id) do update set
      revision = public.eos_business_twin_source_state_v34.revision + 1,
      changed_at = excluded.changed_at,
      last_source = excluded.last_source,
      metadata = excluded.metadata;

    update public.eos_business_twins_v14
    set valid_until = least(valid_until, now())
    where usuario_id = owner_id
      and valid_until > now();
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.eos_invalidate_business_twin_v34() from public, anon, authenticated;
grant execute on function public.eos_invalidate_business_twin_v34() to service_role;

drop trigger if exists eos_master_contexts_invalidate_twin_v34 on public.eos_master_contexts;
create trigger eos_master_contexts_invalidate_twin_v34
after insert or update or delete on public.eos_master_contexts
for each row execute function public.eos_invalidate_business_twin_v34();

drop trigger if exists eos_goals_invalidate_twin_v34 on public.eos_goals;
create trigger eos_goals_invalidate_twin_v34
after insert or update or delete on public.eos_goals
for each row execute function public.eos_invalidate_business_twin_v34();

drop trigger if exists eos_followups_invalidate_twin_v34 on public.eos_proactive_followups;
create trigger eos_followups_invalidate_twin_v34
after insert or update or delete on public.eos_proactive_followups
for each row execute function public.eos_invalidate_business_twin_v34();

drop trigger if exists eos_action_commands_invalidate_twin_v34 on public.eos_action_commands;
create trigger eos_action_commands_invalidate_twin_v34
after insert or update or delete on public.eos_action_commands
for each row execute function public.eos_invalidate_business_twin_v34();

drop trigger if exists eos_decisions_invalidate_twin_v34 on public.eos_decisions;
create trigger eos_decisions_invalidate_twin_v34
after insert or update or delete on public.eos_decisions
for each row execute function public.eos_invalidate_business_twin_v34();

drop trigger if exists eos_decision_results_invalidate_twin_v34 on public.eos_decision_results;
create trigger eos_decision_results_invalidate_twin_v34
after insert or update or delete on public.eos_decision_results
for each row execute function public.eos_invalidate_business_twin_v34();

drop trigger if exists eos_learnings_invalidate_twin_v34 on public.eos_learnings;
create trigger eos_learnings_invalidate_twin_v34
after insert or update or delete on public.eos_learnings
for each row execute function public.eos_invalidate_business_twin_v34();

drop trigger if exists eos_autonomy_profile_invalidate_twin_v34 on public.eos_autonomy_profiles_v12;
create trigger eos_autonomy_profile_invalidate_twin_v34
after insert or update or delete on public.eos_autonomy_profiles_v12
for each row execute function public.eos_invalidate_business_twin_v34();

drop trigger if exists eos_score_snapshot_invalidate_twin_v34 on public.eos_intelligence_score_snapshots_v10;
create trigger eos_score_snapshot_invalidate_twin_v34
after insert or update or delete on public.eos_intelligence_score_snapshots_v10
for each row execute function public.eos_invalidate_business_twin_v34();

create or replace function public.eos_get_business_twin_source_revision_v34()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_revision bigint;
begin
  if v_uid is null then
    raise exception 'EOS_UNAUTHENTICATED';
  end if;

  if not exists (select 1 from public.usuarios where id = v_uid) then
    raise exception 'EOS_TWIN_USER_NOT_FOUND';
  end if;

  insert into public.eos_business_twin_source_state_v34 (usuario_id, revision, changed_at, last_source)
  values (v_uid, 0, now(), 'revision-read-init')
  on conflict (usuario_id) do nothing;

  select s.revision into v_revision
  from public.eos_business_twin_source_state_v34 s
  where s.usuario_id = v_uid;

  return coalesce(v_revision, 0);
end;
$$;

revoke all on function public.eos_get_business_twin_source_revision_v34() from public, anon, service_role;
grant execute on function public.eos_get_business_twin_source_revision_v34() to authenticated;

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
    return jsonb_build_object(
      'twin', to_jsonb(v_current),
      'changed', false,
      'source_revision', v_revision,
      'stale', v_current.valid_until <= now()
    );
  end if;

  if v_current.usuario_id is not null then
    v_version := v_current.version + 1;
  end if;

  insert into public.eos_business_twins_v14 (
    usuario_id,
    version,
    model_version,
    source_fingerprint,
    identity,
    current_state,
    desired_state,
    gaps,
    constraints,
    capabilities,
    risks,
    opportunities,
    priorities,
    execution_profile,
    learning_profile,
    autonomy_profile,
    intelligence_score,
    confidence,
    source_completeness,
    generated_at,
    valid_until,
    metadata
  ) values (
    v_uid,
    v_version,
    left(coalesce(nullif(btrim(p_model_version), ''), 'business-twin-v14'), 120),
    p_source_fingerprint,
    coalesce(p_identity, '{}'::jsonb),
    coalesce(p_current_state, '{}'::jsonb),
    coalesce(p_desired_state, '{}'::jsonb),
    coalesce(p_gaps, '[]'::jsonb),
    coalesce(p_constraints, '[]'::jsonb),
    coalesce(p_capabilities, '[]'::jsonb),
    coalesce(p_risks, '[]'::jsonb),
    coalesce(p_opportunities, '[]'::jsonb),
    coalesce(p_priorities, '[]'::jsonb),
    coalesce(p_execution_profile, '{}'::jsonb),
    coalesce(p_learning_profile, '{}'::jsonb),
    coalesce(p_autonomy_profile, '{}'::jsonb),
    p_intelligence_score,
    p_confidence,
    p_source_completeness,
    now(),
    now() + interval '6 hours',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'commit_version', 'v34',
      'source_revision', v_revision,
      'source_revision_guard', true
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
    'stale', false
  );
end;
$$;

revoke all on function public.eos_commit_business_twin_v34(bigint, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, numeric, numeric, jsonb) from public, anon, service_role;
grant execute on function public.eos_commit_business_twin_v34(bigint, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, numeric, numeric, jsonb) to authenticated;

comment on table public.eos_business_twin_source_state_v34 is
  'Revision monotona de las fuentes directas del Business Twin para impedir commits construidos sobre datos que cambiaron durante el refresh.';
comment on function public.eos_get_business_twin_source_revision_v34() is
  'Devuelve la revision self-scoped que debe acompañar un refresh del Business Twin.';
comment on function public.eos_commit_business_twin_v34(bigint, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, numeric, numeric, jsonb) is
  'RC1 v34: commit self-scoped del Business Twin con versionado bajo lock y source-revision guard; snapshots quedan a cargo del trigger v28.';
