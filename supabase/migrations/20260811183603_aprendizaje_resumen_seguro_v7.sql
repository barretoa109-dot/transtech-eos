-- Fase 7: resumen visible al usuario sin exponer el contexto privado del worker.
-- La vista usa directamente tablas protegidas por RLS, evitando depender de
-- eos_learning_context_v7, que permanece disponible solo para service_role.

create or replace view public.eos_learning_summary_v7
with (security_invoker = true)
as
with evidence as (
  select
    dr.usuario_id,
    'decision_result'::text as evidence_type,
    case dr.tipo
      when 'positivo' then 'positivo'
      when 'negativo' then 'negativo'
      when 'inconcluso' then 'inconcluso'
      else 'neutral'
    end as signal,
    dr.ocurrido_at
  from public.eos_decision_results as dr
  join public.eos_decisions as d on d.id = dr.decision_id

  union all

  select
    ge.usuario_id,
    'goal_event',
    case
      when coalesce(ge.progreso_nuevo, 0) > coalesce(ge.progreso_anterior, 0)
        or ge.tipo = 'hito' then 'positivo'
      when coalesce(ge.progreso_nuevo, 0) < coalesce(ge.progreso_anterior, 0)
        then 'negativo'
      else 'neutral'
    end,
    ge.created_at
  from public.eos_goal_events as ge
  join public.eos_goals as g on g.id = ge.objetivo_id
  where ge.tipo <> 'creado'
    and ge.fuente <> 'migracion'

  union all

  select
    ae.usuario_id,
    'action_event',
    case ae.tipo
      when 'completada' then 'positivo'
      when 'error' then 'negativo'
      when 'no_disponible' then 'negativo'
      else 'neutral'
    end,
    ae.created_at
  from public.eos_action_events as ae
  join public.eos_action_commands as ac on ac.id = ae.command_id
  where ae.tipo in ('completada', 'error', 'no_disponible', 'cancelada')
), recent_evidence as (
  select e.*
  from evidence as e
  where e.ocurrido_at >= now() - interval '180 days'
), evidence_summary as (
  select
    e.usuario_id,
    count(*)::integer as evidence_count,
    count(*) filter (where e.signal = 'positivo')::integer as positive_count,
    count(*) filter (where e.signal = 'negativo')::integer as negative_count,
    count(*) filter (where e.signal in ('neutral', 'inconcluso'))::integer
      as neutral_count,
    count(distinct e.evidence_type)::integer as evidence_type_count
  from recent_evidence as e
  group by e.usuario_id
), learning_summary as (
  select
    el.usuario_id,
    count(*) filter (where el.estado = 'activo')::integer as active_learnings,
    round(avg(el.confianza) filter (where el.estado = 'activo'), 3)
      as average_confidence,
    max(el.generated_at) as latest_learning_at
  from public.eos_learnings as el
  group by el.usuario_id
)
select
  u.id as usuario_id,
  coalesce(es.evidence_count, 0)::integer as evidence_count,
  coalesce(es.positive_count, 0)::integer as positive_count,
  coalesce(es.negative_count, 0)::integer as negative_count,
  coalesce(es.neutral_count, 0)::integer as neutral_count,
  coalesce(es.evidence_type_count, 0)::integer as evidence_type_count,
  (coalesce(es.evidence_count, 0) >= 3) as eligible,
  coalesce(ls.active_learnings, 0)::integer as active_learnings,
  ls.average_confidence,
  ls.latest_learning_at
from public.usuarios as u
left join evidence_summary as es on es.usuario_id = u.id
left join learning_summary as ls on ls.usuario_id = u.id;

revoke all on table public.eos_learning_summary_v7 from anon, authenticated;
grant select on table public.eos_learning_summary_v7 to authenticated;
grant select on table public.eos_learning_summary_v7 to service_role;

comment on view public.eos_learning_summary_v7 is
  'Resumen Fase 7 visible por usuario; respeta RLS y no expone evidencia privada.';
