begin;

alter table public.eos_decision_results
  add column if not exists request_id uuid;

create unique index if not exists eos_decision_results_user_request_uidx_v32
  on public.eos_decision_results (usuario_id, request_id)
  where request_id is not null;

create or replace function public.eos_record_decision_result_v32(
  p_decision_id uuid,
  p_request_id uuid,
  p_tipo text,
  p_resumen text,
  p_aprendizaje text,
  p_evaluation_status text,
  p_evaluation_summary text,
  p_evaluation_confidence numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_decision public.eos_decisions%rowtype;
  v_result public.eos_decision_results%rowtype;
  v_existing public.eos_decision_results%rowtype;
begin
  if v_uid is null then
    raise exception 'EOS_UNAUTHENTICATED';
  end if;

  if p_request_id is null then
    raise exception 'EOS_DECISION_RESULT_REQUEST_ID_REQUIRED';
  end if;

  if p_tipo not in ('positivo','neutral','negativo','inconcluso','observacion') then
    raise exception 'EOS_DECISION_RESULT_TYPE_INVALID';
  end if;

  if nullif(btrim(coalesce(p_resumen, '')), '') is null then
    raise exception 'EOS_DECISION_RESULT_REQUIRED';
  end if;

  if p_evaluation_status not in ('pendiente','midiendo','validado','inconcluso') then
    raise exception 'EOS_DECISION_EVALUATION_STATUS_INVALID';
  end if;

  if p_evaluation_confidence is null or p_evaluation_confidence < 0 or p_evaluation_confidence > 1 then
    raise exception 'EOS_DECISION_EVALUATION_CONFIDENCE_INVALID';
  end if;

  select r.*
    into v_existing
  from public.eos_decision_results r
  where r.usuario_id = v_uid
    and r.request_id = p_request_id;

  if found then
    if v_existing.decision_id <> p_decision_id then
      raise exception 'EOS_DECISION_RESULT_IDEMPOTENCY_CONFLICT';
    end if;

    select d.* into v_decision
    from public.eos_decisions d
    where d.id = p_decision_id and d.usuario_id = v_uid;

    return jsonb_build_object(
      'result', to_jsonb(v_existing),
      'evaluation', jsonb_build_object(
        'status', v_decision.resultado_estado,
        'summary', v_decision.evaluacion_eos,
        'confidence', v_decision.evaluacion_confianza
      ),
      'idempotent', true
    );
  end if;

  select d.*
    into v_decision
  from public.eos_decisions d
  where d.id = p_decision_id
    and d.usuario_id = v_uid
  for update;

  if not found then
    raise exception 'EOS_DECISION_NOT_FOUND';
  end if;

  insert into public.eos_decision_results (
    decision_id,
    usuario_id,
    tipo,
    resumen,
    aprendizaje,
    fuente,
    request_id
  ) values (
    p_decision_id,
    v_uid,
    p_tipo,
    left(btrim(p_resumen), 3000),
    nullif(left(btrim(coalesce(p_aprendizaje, '')), 3000), ''),
    'eos-web',
    p_request_id
  )
  returning * into v_result;

  update public.eos_decisions
  set resultado_estado = p_evaluation_status,
      evaluacion_eos = left(btrim(coalesce(p_evaluation_summary, '')), 3000),
      evaluacion_confianza = p_evaluation_confidence,
      evaluada_at = now()
  where id = p_decision_id
    and usuario_id = v_uid;

  if not found then
    raise exception 'EOS_DECISION_EVALUATION_UPDATE_FAILED';
  end if;

  return jsonb_build_object(
    'result', to_jsonb(v_result),
    'evaluation', jsonb_build_object(
      'status', p_evaluation_status,
      'summary', left(btrim(coalesce(p_evaluation_summary, '')), 3000),
      'confidence', p_evaluation_confidence
    ),
    'idempotent', false
  );
end;
$$;

revoke all on function public.eos_record_decision_result_v32(uuid, uuid, text, text, text, text, text, numeric)
  from public, anon, service_role;
grant execute on function public.eos_record_decision_result_v32(uuid, uuid, text, text, text, text, text, numeric)
  to authenticated;

create or replace view public.eos_decision_registry_v6
with (security_invoker = true)
as
select
  d.id,
  d.usuario_id,
  d.proyecto_id,
  d.objetivo_id,
  d.conversacion_id,
  d.mensaje_id,
  d.titulo,
  d.decision,
  d.contexto,
  d.razon,
  d.resultado_esperado,
  d.metrica,
  d.valor_base,
  d.valor_objetivo,
  d.unidad,
  d.estado,
  d.confianza,
  d.fuente,
  d.request_id,
  d.fecha_decision,
  d.fecha_revision,
  d.cerrada_at,
  d.created_at,
  d.updated_at,
  d.metadata,
  coalesce(r.result_count, 0)::integer as result_count,
  r.latest_result_at,
  r.latest_result_type,
  r.latest_result_summary,
  r.latest_learning,
  d.resultado_estado,
  d.evaluacion_eos,
  d.evaluacion_confianza,
  d.evaluada_at
from public.eos_decisions as d
left join lateral (
  select
    count(*) as result_count,
    max(dr.ocurrido_at) as latest_result_at,
    (array_agg(dr.tipo order by dr.ocurrido_at desc, dr.created_at desc))[1]
      as latest_result_type,
    (array_agg(dr.resumen order by dr.ocurrido_at desc, dr.created_at desc))[1]
      as latest_result_summary,
    (array_agg(dr.aprendizaje order by dr.ocurrido_at desc, dr.created_at desc)
      filter (where dr.aprendizaje is not null))[1] as latest_learning
  from public.eos_decision_results as dr
  where dr.decision_id = d.id
) as r on true;

comment on function public.eos_record_decision_result_v32(uuid, uuid, text, text, text, text, text, numeric) is
  'RC1 v32: registra resultado y evaluacion de decision de forma atomica e idempotente por request_id.';

comment on view public.eos_decision_registry_v6 is
  'Registro consolidado de decisiones, resultados, aprendizaje y evaluacion EOS actualizada.';

commit;
