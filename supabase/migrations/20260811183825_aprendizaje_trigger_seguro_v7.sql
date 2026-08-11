-- Fase 7: corrige colision entre variable PL/pgSQL y columna learning_id.

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

