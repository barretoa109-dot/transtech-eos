-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.


-- RC1 v77
-- Corrige una colision PL/pgSQL introducida por v59. Las variables
-- evidence_type/evidence_id hacian ambiguo el ON CONFLICT del insert de
-- evidencia y Postgres rechazaba cada enrichment valido con SQLSTATE 42702.

create or replace function public.eos_apply_learning_enrichment_v7()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  learning_item jsonb;
  evidence_item jsonb;
  canonical_item jsonb;
  canonical_evidence jsonb;
  seen_refs jsonb;
  v_learning_id uuid;
  normalized_key text;
  v_evidence_type text;
  v_evidence_id text;
  ref_key text;
  learning_count integer := 0;
  derived_evidence_count integer;
  derived_positive_count integer;
  derived_negative_count integer;
  v_first_observed_at timestamptz;
  v_last_observed_at timestamptz;
  v_context_eligible boolean := false;
  v_context_evidence_count integer := 0;
begin
  select ctx.eligible, ctx.evidence_count
    into v_context_eligible, v_context_evidence_count
  from public.eos_learning_context_v7 as ctx
  where ctx.usuario_id = new.usuario_id;

  if not found
     or not coalesce(v_context_eligible, false)
     or coalesce(v_context_evidence_count, 0) < 3 then
    raise exception 'EOS_LEARNING_CONTEXT_INELIGIBLE';
  end if;

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

    if jsonb_typeof(learning_item -> 'evidence') <> 'array'
       or jsonb_array_length(learning_item -> 'evidence') = 0 then
      raise exception 'EOS_LEARNING_EVIDENCE_REQUIRED';
    end if;

    if jsonb_array_length(learning_item -> 'evidence') > 50 then
      raise exception 'EOS_LEARNING_EVIDENCE_LIMIT_EXCEEDED';
    end if;

    canonical_evidence := '[]'::jsonb;
    seen_refs := '{}'::jsonb;
    derived_evidence_count := 0;
    derived_positive_count := 0;
    derived_negative_count := 0;
    v_first_observed_at := null;
    v_last_observed_at := null;

    for evidence_item in
      select value from jsonb_array_elements(learning_item -> 'evidence')
    loop
      v_evidence_type := btrim(coalesce(evidence_item ->> 'evidence_type', ''));
      v_evidence_id := btrim(coalesce(evidence_item ->> 'evidence_id', ''));

      if v_evidence_type not in ('decision_result', 'goal_event', 'action_event')
         or v_evidence_id = '' then
        raise exception 'EOS_LEARNING_EVIDENCE_REFERENCE_INVALID';
      end if;

      ref_key := v_evidence_type || ':' || v_evidence_id;
      if seen_refs ? ref_key then
        continue;
      end if;

      canonical_item := null;

      select source_item
        into canonical_item
      from public.eos_learning_context_v7 as ctx
      cross join lateral jsonb_array_elements(ctx.evidence) as source_item
      where ctx.usuario_id = new.usuario_id
        and source_item ->> 'evidence_type' = v_evidence_type
        and source_item ->> 'evidence_id' = v_evidence_id
      limit 1;

      if canonical_item is null then
        raise exception 'EOS_LEARNING_EVIDENCE_NOT_FOUND';
      end if;

      seen_refs := seen_refs || jsonb_build_object(ref_key, true);
      canonical_evidence := canonical_evidence || jsonb_build_array(canonical_item);
      derived_evidence_count := derived_evidence_count + 1;

      if canonical_item ->> 'signal' = 'positivo' then
        derived_positive_count := derived_positive_count + 1;
      elsif canonical_item ->> 'signal' = 'negativo' then
        derived_negative_count := derived_negative_count + 1;
      end if;

      if nullif(canonical_item ->> 'ocurrido_at', '') is not null then
        v_first_observed_at := least(
          coalesce(
            v_first_observed_at,
            (canonical_item ->> 'ocurrido_at')::timestamptz
          ),
          (canonical_item ->> 'ocurrido_at')::timestamptz
        );
        v_last_observed_at := greatest(
          coalesce(
            v_last_observed_at,
            (canonical_item ->> 'ocurrido_at')::timestamptz
          ),
          (canonical_item ->> 'ocurrido_at')::timestamptz
        );
      end if;
    end loop;

    if derived_evidence_count = 0 then
      raise exception 'EOS_LEARNING_EVIDENCE_REQUIRED';
    end if;

    insert into public.eos_learnings (
      usuario_id,
      clave,
      categoria,
      patron,
      recomendacion,
      tendencia,
      confianza,
      evidence_count,
      positive_count,
      negative_count,
      first_observed_at,
      last_observed_at,
      fuente,
      model_version,
      prompt_version,
      generated_at,
      metadata
    ) values (
      new.usuario_id,
      left(normalized_key, 160),
      case
        when learning_item ->> 'categoria' in
          ('decision', 'objetivo', 'ejecucion', 'contexto', 'general')
          then learning_item ->> 'categoria'
        else 'general'
      end,
      left(btrim(learning_item ->> 'patron'), 3000),
      left(btrim(learning_item ->> 'recomendacion'), 3000),
      case
        when learning_item ->> 'tendencia' in
          ('positiva', 'neutral', 'negativa', 'mixta')
          then learning_item ->> 'tendencia'
        else 'mixta'
      end,
      greatest(
        0,
        least(1, coalesce((learning_item ->> 'confianza')::numeric, 0.5))
      ),
      derived_evidence_count,
      derived_positive_count,
      derived_negative_count,
      v_first_observed_at,
      v_last_observed_at,
      'n8n-ai-v7',
      new.model_version,
      new.prompt_version,
      now(),
      coalesce(learning_item -> 'metadata', '{}'::jsonb)
        || jsonb_build_object(
          'evidence_binding', 'v59',
          'canonical_evidence_count', derived_evidence_count
        )
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
        public.eos_learnings.first_observed_at,
        excluded.first_observed_at
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

    for canonical_item in
      select value from jsonb_array_elements(canonical_evidence)
    loop
      insert into public.eos_learning_evidence (
        learning_id,
        usuario_id,
        evidence_type,
        evidence_id,
        signal,
        resumen,
        ocurrido_at,
        metadata
      ) values (
        v_learning_id,
        new.usuario_id,
        canonical_item ->> 'evidence_type',
        left(btrim(canonical_item ->> 'evidence_id'), 180),
        case
          when canonical_item ->> 'signal' in
            ('positivo', 'neutral', 'negativo', 'inconcluso')
            then canonical_item ->> 'signal'
          else 'neutral'
        end,
        left(
          btrim(
            coalesce(
              canonical_item ->> 'resumen',
              'Evidencia verificada por EOS'
            )
          ),
          2000
        ),
        (canonical_item ->> 'ocurrido_at')::timestamptz,
        jsonb_build_object(
          'source', 'eos-learning-context-v7',
          'evidence_binding', 'v59'
        )
      )
      on conflict (learning_id, evidence_type, evidence_id) do update set
        signal = excluded.signal,
        resumen = excluded.resumen,
        ocurrido_at = excluded.ocurrido_at,
        metadata = excluded.metadata;
    end loop;
  end loop;

  if learning_count = 0 then
    raise exception 'EOS_LEARNING_EMPTY';
  end if;

  new.evidence_count := v_context_evidence_count;
  new.applied_at := now();
  return new;
end;
$$;

revoke all on function public.eos_apply_learning_enrichment_v7()
  from public, anon, authenticated;
grant execute on function public.eos_apply_learning_enrichment_v7()
  to service_role;

comment on function public.eos_apply_learning_enrichment_v7() is
  'RC1 v77: conserva evidence binding v59 y elimina la ambiguedad PL/pgSQL 42702 en el upsert de evidencia.';


