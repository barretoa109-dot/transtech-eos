-- Fase 5: canal auditable y atomico para el enriquecimiento diario desde n8n.
-- El Worker solo inserta una propuesta validada. El trigger la aplica al briefing
-- en la misma transaccion, por lo que el respaldo nunca queda parcialmente escrito.

create table if not exists public.eos_daily_briefing_enrichments (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  briefing_date date not null,
  payload jsonb not null,
  model_version text not null default 'gpt-5.4-mini',
  prompt_version text not null default 'briefing-prompt-v5',
  execution_id text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  constraint eos_daily_briefing_enrichments_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint eos_daily_briefing_enrichments_model_check
    check (nullif(btrim(model_version), '') is not null),
  constraint eos_daily_briefing_enrichments_prompt_check
    check (nullif(btrim(prompt_version), '') is not null)
);

create index if not exists eos_daily_briefing_enrichments_user_date_idx
  on public.eos_daily_briefing_enrichments (
    usuario_id,
    briefing_date desc,
    created_at desc
  );

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
      'execution_id', coalesce(new.execution_id, '')
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
  return new;
end;
$$;

drop trigger if exists eos_daily_briefing_enrichments_apply_v5
  on public.eos_daily_briefing_enrichments;

create trigger eos_daily_briefing_enrichments_apply_v5
before insert on public.eos_daily_briefing_enrichments
for each row
execute function public.eos_apply_daily_briefing_enrichment_v5();

alter table public.eos_daily_briefing_enrichments enable row level security;

revoke all on table public.eos_daily_briefing_enrichments
  from public, anon, authenticated;
grant all on table public.eos_daily_briefing_enrichments to service_role;

revoke all on function public.eos_apply_daily_briefing_enrichment_v5()
  from public, anon, authenticated;
grant execute on function public.eos_apply_daily_briefing_enrichment_v5()
  to service_role;

comment on table public.eos_daily_briefing_enrichments is
  'Propuestas auditables de enriquecimiento de briefings generadas por n8n/OpenAI.';

comment on function public.eos_apply_daily_briefing_enrichment_v5() is
  'Valida y aplica atomicamente un briefing enriquecido sin eliminar el respaldo existente.';
