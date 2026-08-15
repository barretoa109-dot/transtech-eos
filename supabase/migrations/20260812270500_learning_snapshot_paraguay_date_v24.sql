begin;

create or replace function public.eos_capture_learning_snapshot_v13()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot_day date := (now() at time zone 'America/Asuncion')::date;
begin
  insert into public.eos_learning_snapshots_v13 (
    learning_id,
    usuario_id,
    snapshot_day,
    categoria,
    patron,
    recomendacion,
    tendencia,
    confianza,
    evidence_count,
    positive_count,
    negative_count,
    estado,
    first_observed_at,
    last_observed_at,
    captured_at,
    metadata
  ) values (
    new.id,
    new.usuario_id,
    v_snapshot_day,
    new.categoria,
    new.patron,
    new.recomendacion,
    new.tendencia,
    new.confianza,
    new.evidence_count,
    new.positive_count,
    new.negative_count,
    new.estado,
    new.first_observed_at,
    new.last_observed_at,
    now(),
    jsonb_build_object(
      'source','eos-learning-trigger-v13',
      'generated_at',new.generated_at,
      'model_version',new.model_version,
      'prompt_version',new.prompt_version,
      'snapshot_timezone','America/Asuncion'
    )
  )
  on conflict (learning_id, snapshot_day) do update set
    categoria=excluded.categoria,
    patron=excluded.patron,
    recomendacion=excluded.recomendacion,
    tendencia=excluded.tendencia,
    confianza=excluded.confianza,
    evidence_count=excluded.evidence_count,
    positive_count=excluded.positive_count,
    negative_count=excluded.negative_count,
    estado=excluded.estado,
    first_observed_at=excluded.first_observed_at,
    last_observed_at=excluded.last_observed_at,
    captured_at=excluded.captured_at,
    metadata=excluded.metadata;

  return new;
end;
$$;

revoke all on function public.eos_capture_learning_snapshot_v13()
  from public, anon, authenticated;
grant execute on function public.eos_capture_learning_snapshot_v13()
  to service_role;

comment on function public.eos_capture_learning_snapshot_v13() is
  'Captura el snapshot diario del aprendizaje usando fecha calendario America/Asuncion.';

commit;