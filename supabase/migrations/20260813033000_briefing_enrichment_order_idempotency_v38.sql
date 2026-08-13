alter table public.eos_daily_briefing_enrichments
  add column if not exists execution_order bigint,
  add column if not exists apply_status text not null default 'pending',
  add column if not exists skip_reason text;

update public.eos_daily_briefing_enrichments
set execution_order = execution_id::bigint,
    apply_status = case when applied_at is not null then 'applied' else apply_status end
where nullif(btrim(execution_id), '') is not null
  and execution_id ~ '^[0-9]+$';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_daily_briefing_enrichments_apply_status_check'
      and conrelid = 'public.eos_daily_briefing_enrichments'::regclass
  ) then
    alter table public.eos_daily_briefing_enrichments
      add constraint eos_daily_briefing_enrichments_apply_status_check
      check (apply_status in ('pending', 'applied', 'skipped'));
  end if;
end;
$$;

create unique index if not exists eos_daily_briefing_enrichments_execution_uidx_v38
  on public.eos_daily_briefing_enrichments (usuario_id, briefing_date, execution_id)
  where execution_id is not null and btrim(execution_id) <> '';

create index if not exists eos_daily_briefing_enrichments_order_idx_v38
  on public.eos_daily_briefing_enrichments (
    usuario_id,
    briefing_date,
    execution_order desc
  )
  where apply_status = 'applied';

create or replace function public.eos_guard_daily_briefing_enrichment_v38()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution text := btrim(coalesce(new.execution_id, ''));
  v_order bigint;
begin
  if v_execution = '' or v_execution !~ '^[0-9]+$' then
    raise exception 'EOS_BRIEFING_EXECUTION_ID_INVALID';
  end if;

  begin
    v_order := v_execution::bigint;
  exception when numeric_value_out_of_range then
    raise exception 'EOS_BRIEFING_EXECUTION_ID_INVALID';
  end;

  new.execution_id := v_execution;
  new.execution_order := v_order;
  new.apply_status := 'pending';
  new.skip_reason := null;
  new.applied_at := null;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'eos-briefing:' || new.usuario_id::text || ':' || new.briefing_date::text,
      0
    )
  );

  if exists (
    select 1
    from public.eos_daily_briefing_enrichments e
    where e.usuario_id = new.usuario_id
      and e.briefing_date = new.briefing_date
      and e.execution_id = v_execution
  ) then
    return null;
  end if;

  if exists (
    select 1
    from public.eos_daily_briefing_enrichments e
    where e.usuario_id = new.usuario_id
      and e.briefing_date = new.briefing_date
      and e.apply_status = 'applied'
      and e.execution_order is not null
      and e.execution_order > v_order
  ) then
    new.apply_status := 'skipped';
    new.skip_reason := 'newer_execution_already_applied';
  end if;

  return new;
end;
$$;

revoke all on function public.eos_guard_daily_briefing_enrichment_v38()
  from public, anon, authenticated;
grant execute on function public.eos_guard_daily_briefing_enrichment_v38()
  to service_role;

drop trigger if exists eos_daily_briefing_enrichments_00_guard_v38
  on public.eos_daily_briefing_enrichments;
create trigger eos_daily_briefing_enrichments_00_guard_v38
before insert on public.eos_daily_briefing_enrichments
for each row
execute function public.eos_guard_daily_briefing_enrichment_v38();

create or replace function public.eos_apply_daily_briefing_enrichment_v5()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_payload jsonb := new.payload;
  source_score integer;
begin
  if new.apply_status = 'skipped' then
    return new;
  end if;

  if jsonb_typeof(source_payload) <> 'object' then
    raise exception 'briefing_payload_must_be_object';
  end if;

  if nullif(btrim(source_payload ->> 'saludo'), '') is null
     or nullif(btrim(source_payload ->> 'titulo_dia'), '') is null
     or nullif(btrim(source_payload ->> 'resumen'), '') is null
     or nullif(btrim(source_payload ->> 'enfoque_dia'), '') is null
     or nullif(btrim(source_payload ->> 'prioridad_1'), '') is null
     or nullif(btrim(source_payload ->> 'recomendacion_principal'), '') is null then
    raise exception 'briefing_payload_missing_required_text';
  end if;

  if jsonb_typeof(coalesce(source_payload -> 'logros', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(source_payload -> 'riesgos', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(source_payload -> 'proximos_pasos', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(source_payload -> 'fuentes', '{}'::jsonb)) <> 'object' then
    raise exception 'briefing_payload_invalid_json_shape';
  end if;

  source_score := greatest(
    0,
    least(
      100,
      case
        when jsonb_typeof(source_payload -> 'score') = 'number'
          then (source_payload ->> 'score')::integer
        else 0
      end
    )
  );

  insert into public.eos_daily_briefings (
    usuario_id,
    briefing_date,
    estado,
    tipo_usuario,
    saludo,
    titulo_dia,
    resumen,
    enfoque_dia,
    prioridad_1,
    prioridad_2,
    prioridad_3,
    recomendacion_principal,
    logros,
    riesgos,
    proximos_pasos,
    fuentes,
    score,
    modelo_version,
    generated_at,
    created_at,
    updated_at
  )
  values (
    new.usuario_id,
    new.briefing_date,
    'listo',
    coalesce(nullif(btrim(source_payload ->> 'tipo_usuario'), ''), 'indefinido'),
    left(source_payload ->> 'saludo', 220),
    left(source_payload ->> 'titulo_dia', 220),
    left(source_payload ->> 'resumen', 1800),
    left(source_payload ->> 'enfoque_dia', 600),
    left(source_payload ->> 'prioridad_1', 600),
    nullif(left(source_payload ->> 'prioridad_2', 600), ''),
    nullif(left(source_payload ->> 'prioridad_3', 600), ''),
    left(source_payload ->> 'recomendacion_principal', 1200),
    coalesce(source_payload -> 'logros', '[]'::jsonb),
    coalesce(source_payload -> 'riesgos', '[]'::jsonb),
    coalesce(source_payload -> 'proximos_pasos', '[]'::jsonb),
    coalesce(source_payload -> 'fuentes', '{}'::jsonb),
    source_score,
    left(new.model_version, 120),
    now(),
    now(),
    now()
  )
  on conflict (usuario_id, briefing_date)
    where briefing_date is not null
  do update set
    estado = excluded.estado,
    tipo_usuario = excluded.tipo_usuario,
    saludo = excluded.saludo,
    titulo_dia = excluded.titulo_dia,
    resumen = excluded.resumen,
    enfoque_dia = excluded.enfoque_dia,
    prioridad_1 = excluded.prioridad_1,
    prioridad_2 = excluded.prioridad_2,
    prioridad_3 = excluded.prioridad_3,
    recomendacion_principal = excluded.recomendacion_principal,
    logros = excluded.logros,
    riesgos = excluded.riesgos,
    proximos_pasos = excluded.proximos_pasos,
    fuentes = excluded.fuentes,
    score = excluded.score,
    modelo_version = excluded.modelo_version,
    generated_at = excluded.generated_at,
    updated_at = now();

  insert into public.eos_daily_briefing_runs (
    usuario_id,
    briefing_date,
    estado,
    started_at,
    completed_at,
    metadata
  )
  values (
    new.usuario_id,
    new.briefing_date,
    'completado',
    coalesce(new.created_at, now()),
    now(),
    jsonb_build_object(
      'generator', 'n8n-ai-v5',
      'enrichment_id', new.id,
      'model_version', new.model_version,
      'prompt_version', new.prompt_version,
      'execution_id', new.execution_id,
      'execution_order', new.execution_order,
      'ordering_guard', 'v38'
    )
  )
  on conflict (usuario_id, briefing_date)
  do update set
    estado = 'completado',
    error_code = null,
    error_message = null,
    started_at = coalesce(
      public.eos_daily_briefing_runs.started_at,
      excluded.started_at
    ),
    completed_at = now(),
    metadata = public.eos_daily_briefing_runs.metadata || excluded.metadata,
    updated_at = now();

  new.applied_at := now();
  new.apply_status := 'applied';
  new.skip_reason := null;
  return new;
end;
$$;

revoke all on function public.eos_apply_daily_briefing_enrichment_v5()
  from public, anon, authenticated;
grant execute on function public.eos_apply_daily_briefing_enrichment_v5()
  to service_role;

comment on function public.eos_guard_daily_briefing_enrichment_v38() is
  'RC1 v38: serializa enriquecimientos por usuario/dia, hace idempotente execution_id y marca ejecuciones antiguas como skipped antes de aplicar.';
comment on table public.eos_daily_briefing_enrichments is
  'Propuestas auditables de enriquecimiento diario; v38 conserva execution_order/apply_status para evitar retries duplicados y last-finisher-wins.';