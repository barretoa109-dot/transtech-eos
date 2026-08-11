begin;

create table if not exists public.eos_learnings (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  clave text not null,
  categoria text not null
    check (categoria in ('decision', 'objetivo', 'ejecucion', 'contexto', 'general')),
  patron text not null,
  recomendacion text not null,
  tendencia text not null default 'mixta'
    check (tendencia in ('positiva', 'neutral', 'negativa', 'mixta')),
  confianza numeric(4, 3) not null default 0.500
    check (confianza >= 0 and confianza <= 1),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  positive_count integer not null default 0 check (positive_count >= 0),
  negative_count integer not null default 0 check (negative_count >= 0),
  estado text not null default 'activo'
    check (estado in ('activo', 'en_revision', 'descartado')),
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  fuente text not null default 'n8n-ai-v7',
  model_version text,
  prompt_version text,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_learnings_key_not_blank check (btrim(clave) <> ''),
  constraint eos_learnings_pattern_not_blank check (btrim(patron) <> ''),
  constraint eos_learnings_recommendation_not_blank check (btrim(recomendacion) <> ''),
  constraint eos_learnings_counts_check check (
    positive_count + negative_count <= evidence_count
  )
);

create table if not exists public.eos_learning_evidence (
  id uuid primary key default gen_random_uuid(),
  learning_id uuid not null references public.eos_learnings(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  evidence_type text not null
    check (evidence_type in ('decision_result', 'goal_event', 'action_event')),
  evidence_id text not null,
  signal text not null default 'neutral'
    check (signal in ('positivo', 'neutral', 'negativo', 'inconcluso')),
  resumen text not null,
  ocurrido_at timestamptz not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_learning_evidence_id_not_blank check (btrim(evidence_id) <> ''),
  constraint eos_learning_evidence_summary_not_blank check (btrim(resumen) <> '')
);

create table if not exists public.eos_learning_enrichments (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  analysis_date date not null default current_date,
  evidence_count integer not null check (evidence_count >= 3),
  payload jsonb not null,
  model_version text not null,
  prompt_version text not null,
  execution_id text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  constraint eos_learning_enrichments_payload_object check (jsonb_typeof(payload) = 'object')
);

create unique index if not exists eos_learnings_user_key_uidx
  on public.eos_learnings (usuario_id, clave);

create index if not exists eos_learnings_user_active_confidence_idx
  on public.eos_learnings (usuario_id, confianza desc, updated_at desc)
  where estado = 'activo';

create unique index if not exists eos_learning_evidence_source_uidx
  on public.eos_learning_evidence (learning_id, evidence_type, evidence_id);

create index if not exists eos_learning_evidence_user_date_idx
  on public.eos_learning_evidence (usuario_id, ocurrido_at desc);

create index if not exists eos_learning_evidence_learning_date_idx
  on public.eos_learning_evidence (learning_id, ocurrido_at desc);

create unique index if not exists eos_learning_enrichments_run_uidx
  on public.eos_learning_enrichments (usuario_id, analysis_date, prompt_version);

create index if not exists eos_learning_enrichments_pending_idx
  on public.eos_learning_enrichments (created_at)
  where applied_at is null;

create or replace view public.eos_learning_context_v7
with (security_invoker = true)
as
with evidence as (
  select
    dr.usuario_id,
    'decision_result'::text as evidence_type,
    dr.id::text as evidence_id,
    case dr.tipo
      when 'positivo' then 'positivo'
      when 'negativo' then 'negativo'
      when 'inconcluso' then 'inconcluso'
      else 'neutral'
    end as signal,
    dr.resumen,
    jsonb_build_object(
      'decision_titulo', d.titulo,
      'decision', d.decision,
      'razon', d.razon,
      'resultado_esperado', d.resultado_esperado,
      'aprendizaje_declarado', dr.aprendizaje,
      'fuente', dr.fuente
    ) as contexto,
    dr.ocurrido_at
  from public.eos_decision_results as dr
  join public.eos_decisions as d on d.id = dr.decision_id

  union all

  select
    ge.usuario_id,
    'goal_event',
    ge.id::text,
    case
      when coalesce(ge.progreso_nuevo, 0) > coalesce(ge.progreso_anterior, 0)
        or ge.tipo = 'hito' then 'positivo'
      when coalesce(ge.progreso_nuevo, 0) < coalesce(ge.progreso_anterior, 0)
        then 'negativo'
      else 'neutral'
    end,
    ge.descripcion,
    jsonb_build_object(
      'objetivo_titulo', g.titulo,
      'tipo_evento', ge.tipo,
      'progreso_anterior', ge.progreso_anterior,
      'progreso_nuevo', ge.progreso_nuevo,
      'evidencia', ge.evidencia,
      'fuente', ge.fuente
    ),
    ge.created_at
  from public.eos_goal_events as ge
  join public.eos_goals as g on g.id = ge.objetivo_id
  where ge.tipo <> 'creado'
    and ge.fuente <> 'migracion'

  union all

  select
    ae.usuario_id,
    'action_event',
    ae.id::text,
    case ae.tipo
      when 'completada' then 'positivo'
      when 'error' then 'negativo'
      when 'no_disponible' then 'negativo'
      else 'neutral'
    end,
    concat('Accion ', ac.accion, ': ', ae.tipo),
    jsonb_build_object(
      'accion', ac.accion,
      'tipo_evento', ae.tipo,
      'detalle', ae.detalle,
      'error_code', ae.error_code,
      'error_message', ae.error_message,
      'duration_ms', ae.duration_ms
    ),
    ae.created_at
  from public.eos_action_events as ae
  join public.eos_action_commands as ac on ac.id = ae.command_id
  where ae.tipo in ('completada', 'error', 'no_disponible', 'cancelada')
), recent_evidence as (
  select e.*
  from evidence as e
  where e.ocurrido_at >= now() - interval '180 days'
)
select
  u.id as usuario_id,
  current_date as analysis_date,
  count(e.evidence_id)::integer as evidence_count,
  count(*) filter (where e.signal = 'positivo')::integer as positive_count,
  count(*) filter (where e.signal = 'negativo')::integer as negative_count,
  count(*) filter (where e.signal in ('neutral', 'inconcluso'))::integer
    as neutral_count,
  count(distinct e.evidence_type)::integer as evidence_type_count,
  (count(e.evidence_id) >= 3) as eligible,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'evidence_type', e.evidence_type,
        'evidence_id', e.evidence_id,
        'signal', e.signal,
        'resumen', e.resumen,
        'contexto', e.contexto,
        'ocurrido_at', e.ocurrido_at
      ) order by e.ocurrido_at desc
    ) filter (where e.evidence_id is not null),
    '[]'::jsonb
  ) as evidence
from public.usuarios as u
left join recent_evidence as e on e.usuario_id = u.id
group by u.id;

create or replace view public.eos_learning_summary_v7
with (security_invoker = true)
as
select
  ctx.usuario_id,
  ctx.evidence_count,
  ctx.positive_count,
  ctx.negative_count,
  ctx.neutral_count,
  ctx.evidence_type_count,
  ctx.eligible,
  coalesce(l.active_learnings, 0)::integer as active_learnings,
  l.average_confidence,
  l.latest_learning_at
from public.eos_learning_context_v7 as ctx
left join lateral (
  select
    count(*) filter (where el.estado = 'activo') as active_learnings,
    round(avg(el.confianza) filter (where el.estado = 'activo'), 3)
      as average_confidence,
    max(el.generated_at) as latest_learning_at
  from public.eos_learnings as el
  where el.usuario_id = ctx.usuario_id
) as l on true;

create or replace function public.eos_apply_learning_enrichment_v7()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  learning_item jsonb;
  evidence_item jsonb;
  v_learning_id uuid;
  normalized_key text;
  learning_count integer := 0;
begin
  if jsonb_typeof(new.payload -> 'learnings') <> 'array' then
    raise exception 'EOS_LEARNING_PAYLOAD_INVALID';
  end if;

  if jsonb_array_length(new.payload -> 'learnings') > 5 then
    raise exception 'EOS_LEARNING_LIMIT_EXCEEDED';
  end if;

  for learning_item in
    select value from jsonb_array_elements(new.payload -> 'learnings')
  loop
    normalized_key := lower(regexp_replace(
      btrim(coalesce(learning_item ->> 'clave', '')),
      '[^a-zA-Z0-9_-]+', '-', 'g'
    ));

    if normalized_key = ''
      or nullif(btrim(learning_item ->> 'patron'), '') is null
      or nullif(btrim(learning_item ->> 'recomendacion'), '') is null then
      raise exception 'EOS_LEARNING_REQUIRED_FIELDS_MISSING';
    end if;

    insert into public.eos_learnings (
      usuario_id, clave, categoria, patron, recomendacion, tendencia,
      confianza, evidence_count, positive_count, negative_count,
      first_observed_at, last_observed_at, fuente, model_version,
      prompt_version, generated_at, metadata
    ) values (
      new.usuario_id,
      left(normalized_key, 160),
      case when learning_item ->> 'categoria' in
        ('decision', 'objetivo', 'ejecucion', 'contexto', 'general')
        then learning_item ->> 'categoria' else 'general' end,
      left(btrim(learning_item ->> 'patron'), 3000),
      left(btrim(learning_item ->> 'recomendacion'), 3000),
      case when learning_item ->> 'tendencia' in
        ('positiva', 'neutral', 'negativa', 'mixta')
        then learning_item ->> 'tendencia' else 'mixta' end,
      greatest(0, least(1, coalesce((learning_item ->> 'confianza')::numeric, 0.5))),
      greatest(0, coalesce((learning_item ->> 'evidence_count')::integer, 0)),
      greatest(0, coalesce((learning_item ->> 'positive_count')::integer, 0)),
      greatest(0, coalesce((learning_item ->> 'negative_count')::integer, 0)),
      nullif(learning_item ->> 'first_observed_at', '')::timestamptz,
      nullif(learning_item ->> 'last_observed_at', '')::timestamptz,
      'n8n-ai-v7', new.model_version, new.prompt_version, now(),
      coalesce(learning_item -> 'metadata', '{}'::jsonb)
    )
    on conflict (usuario_id, clave) do update set
      categoria = excluded.categoria,
      patron = excluded.patron,
      recomendacion = excluded.recomendacion,
      tendencia = excluded.tendencia,
      confianza = excluded.confianza,
      evidence_count = excluded.evidence_count,
      positive_count = excluded.positive_count,
      negative_count = excluded.negative_count,
      first_observed_at = coalesce(
        public.eos_learnings.first_observed_at, excluded.first_observed_at
      ),
      last_observed_at = excluded.last_observed_at,
      fuente = excluded.fuente,
      model_version = excluded.model_version,
      prompt_version = excluded.prompt_version,
      generated_at = excluded.generated_at,
      updated_at = now(),
      metadata = excluded.metadata
    returning id into v_learning_id;

    learning_count := learning_count + 1;

    if jsonb_typeof(learning_item -> 'evidence') = 'array' then
      for evidence_item in
        select value from jsonb_array_elements(learning_item -> 'evidence')
      loop
        if evidence_item ->> 'evidence_type' in
          ('decision_result', 'goal_event', 'action_event')
          and nullif(btrim(evidence_item ->> 'evidence_id'), '') is not null
          and nullif(btrim(evidence_item ->> 'resumen'), '') is not null then
          insert into public.eos_learning_evidence (
            learning_id, usuario_id, evidence_type, evidence_id,
            signal, resumen, ocurrido_at, metadata
          ) values (
            v_learning_id,
            new.usuario_id,
            evidence_item ->> 'evidence_type',
            left(btrim(evidence_item ->> 'evidence_id'), 180),
            case when evidence_item ->> 'signal' in
              ('positivo', 'neutral', 'negativo', 'inconcluso')
              then evidence_item ->> 'signal' else 'neutral' end,
            left(btrim(evidence_item ->> 'resumen'), 2000),
            coalesce(
              nullif(evidence_item ->> 'ocurrido_at', '')::timestamptz,
              now()
            ),
            coalesce(evidence_item -> 'metadata', '{}'::jsonb)
          )
          on conflict (learning_id, evidence_type, evidence_id) do update set
            signal = excluded.signal,
            resumen = excluded.resumen,
            ocurrido_at = excluded.ocurrido_at,
            metadata = excluded.metadata;
        end if;
      end loop;
    end if;
  end loop;

  if learning_count = 0 then
    raise exception 'EOS_LEARNING_EMPTY';
  end if;

  new.applied_at := now();
  return new;
end;
$$;

drop trigger if exists eos_learning_enrichments_apply_v7
  on public.eos_learning_enrichments;
create trigger eos_learning_enrichments_apply_v7
before insert on public.eos_learning_enrichments
for each row execute function public.eos_apply_learning_enrichment_v7();

alter table public.eos_learnings enable row level security;
alter table public.eos_learning_evidence enable row level security;
alter table public.eos_learning_enrichments enable row level security;

create policy eos_learnings_select_own on public.eos_learnings
for select to authenticated using ((select auth.uid()) = usuario_id);

create policy eos_learning_evidence_select_own on public.eos_learning_evidence
for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_learnings from anon, authenticated;
revoke all on table public.eos_learning_evidence from anon, authenticated;
revoke all on table public.eos_learning_enrichments from anon, authenticated;
revoke all on table public.eos_learning_context_v7 from anon, authenticated;
revoke all on table public.eos_learning_summary_v7 from anon, authenticated;

grant select on table public.eos_learnings to authenticated;
grant select on table public.eos_learning_evidence to authenticated;
grant select on table public.eos_learning_summary_v7 to authenticated;

grant all on table public.eos_learnings to service_role;
grant all on table public.eos_learning_evidence to service_role;
grant all on table public.eos_learning_enrichments to service_role;
grant select on table public.eos_learning_context_v7 to service_role;
grant select on table public.eos_learning_summary_v7 to service_role;

revoke all on function public.eos_apply_learning_enrichment_v7()
from public, anon, authenticated;
grant execute on function public.eos_apply_learning_enrichment_v7()
to service_role;

comment on table public.eos_learnings is
  'Fase 7: patrones comprobables aprendidos de resultados, objetivos y acciones.';
comment on table public.eos_learning_evidence is
  'Evidencia trazable que respalda cada aprendizaje de EOS.';
comment on view public.eos_learning_context_v7 is
  'Contexto privado para n8n; exige al menos tres evidencias antes de aprender.';

commit;
