-- Fase 5: briefing personalizado diario.
-- Endurece la tabla histórica, garantiza una sola versión diaria por usuario,
-- registra cada generación y expone un contexto consolidado solo al Worker.

alter table public.eos_daily_briefings
  add column if not exists briefing_date date,
  add column if not exists estado text not null default 'listo',
  add column if not exists titulo_dia text,
  add column if not exists enfoque_dia text,
  add column if not exists logros jsonb not null default '[]'::jsonb,
  add column if not exists riesgos jsonb not null default '[]'::jsonb,
  add column if not exists proximos_pasos jsonb not null default '[]'::jsonb,
  add column if not exists fuentes jsonb not null default '{}'::jsonb,
  add column if not exists modelo_version text not null default 'briefing-v5',
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.eos_daily_briefings
set
  generated_at = coalesce(created_at, now()),
  updated_at = coalesce(created_at, now())
where generated_at is distinct from coalesce(created_at, generated_at)
   or updated_at is distinct from coalesce(created_at, updated_at);

-- Conserva todos los registros heredados, pero solo promociona el más reciente
-- de cada día al historial diario canónico. Los duplicados quedan auditables.
with ranked_legacy as (
  select
    id,
    row_number() over (
      partition by
        usuario_id,
        (created_at at time zone 'America/Asuncion')::date
      order by created_at desc, id desc
    ) as daily_rank
  from public.eos_daily_briefings
  where briefing_date is null
)
update public.eos_daily_briefings as briefing
set briefing_date =
  (briefing.created_at at time zone 'America/Asuncion')::date
from ranked_legacy
where briefing.id = ranked_legacy.id
  and ranked_legacy.daily_rank = 1;

alter table public.eos_daily_briefings
  alter column usuario_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_daily_briefings_usuario_id_fkey'
      and conrelid = 'public.eos_daily_briefings'::regclass
  ) then
    alter table public.eos_daily_briefings
      add constraint eos_daily_briefings_usuario_id_fkey
      foreign key (usuario_id)
      references public.usuarios(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_daily_briefings_estado_check'
      and conrelid = 'public.eos_daily_briefings'::regclass
  ) then
    alter table public.eos_daily_briefings
      add constraint eos_daily_briefings_estado_check
      check (estado in ('generando', 'listo', 'error'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_daily_briefings_score_check'
      and conrelid = 'public.eos_daily_briefings'::regclass
  ) then
    alter table public.eos_daily_briefings
      add constraint eos_daily_briefings_score_check
      check (score is null or score between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_daily_briefings_json_arrays_check'
      and conrelid = 'public.eos_daily_briefings'::regclass
  ) then
    alter table public.eos_daily_briefings
      add constraint eos_daily_briefings_json_arrays_check
      check (
        jsonb_typeof(logros) = 'array'
        and jsonb_typeof(riesgos) = 'array'
        and jsonb_typeof(proximos_pasos) = 'array'
      );
  end if;
end;
$$;

create unique index if not exists eos_daily_briefings_user_date_uidx
  on public.eos_daily_briefings (usuario_id, briefing_date)
  where briefing_date is not null;

create index if not exists eos_daily_briefings_user_created_idx
  on public.eos_daily_briefings (usuario_id, created_at desc);

create or replace function public.eos_touch_daily_briefing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists eos_daily_briefings_touch_updated_at
  on public.eos_daily_briefings;

create trigger eos_daily_briefings_touch_updated_at
before update on public.eos_daily_briefings
for each row
execute function public.eos_touch_daily_briefing();

create table if not exists public.eos_daily_briefing_runs (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  briefing_date date not null,
  estado text not null default 'pendiente',
  attempt_count integer not null default 1,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_daily_briefing_runs_estado_check check (
    estado in ('pendiente', 'procesando', 'completado', 'error', 'omitido')
  ),
  constraint eos_daily_briefing_runs_attempt_check check (
    attempt_count between 1 and 5
  ),
  constraint eos_daily_briefing_runs_error_check check (
    estado <> 'error' or nullif(btrim(error_message), '') is not null
  ),
  constraint eos_daily_briefing_runs_user_date_key unique (
    usuario_id,
    briefing_date
  )
);

create index if not exists eos_daily_briefing_runs_pending_idx
  on public.eos_daily_briefing_runs (briefing_date, created_at)
  where estado in ('pendiente', 'procesando', 'error');

create or replace function public.eos_touch_daily_briefing_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists eos_daily_briefing_runs_touch_updated_at
  on public.eos_daily_briefing_runs;

create trigger eos_daily_briefing_runs_touch_updated_at
before update on public.eos_daily_briefing_runs
for each row
execute function public.eos_touch_daily_briefing_run();

create or replace view public.eos_daily_briefing_context_v5
with (security_invoker = true)
as
select
  usuario.id as usuario_id,
  (now() at time zone 'America/Asuncion')::date as briefing_date,
  coalesce(
    nullif(btrim(profile.nombre_visible), ''),
    nullif(btrim(usuario.nombre), ''),
    'Usuario'
  ) as nombre,
  coalesce(nullif(btrim(profile.tipo_usuario), ''), 'indefinido') as tipo_usuario,
  coalesce(nullif(btrim(profile.rubro), ''), '') as rubro,
  coalesce(nullif(btrim(profile.etapa_actual), ''), 'inicial') as etapa_actual,
  coalesce(profile.score_general, latest_intelligence.score, 0) as score_actual,
  coalesce(profile.prioridad_actual, '') as prioridad_actual,
  coalesce(profile.resumen_actual, '') as resumen_actual,
  coalesce(goals.items, '[]'::jsonb) as objetivos,
  coalesce(tasks.items, '[]'::jsonb) as tareas,
  coalesce(followups.items, '[]'::jsonb) as seguimientos,
  coalesce(actions.items, '[]'::jsonb) as acciones_recientes,
  coalesce(memory.items, '[]'::jsonb) as memorias_relevantes,
  coalesce(intelligence.items, '[]'::jsonb) as diagnosticos_recientes,
  coalesce(activity.items, '[]'::jsonb) as actividad_reciente,
  jsonb_build_object(
    'objetivos_activos', coalesce(goals.total, 0),
    'progreso_promedio', coalesce(goals.average_progress, 0),
    'tareas_pendientes', coalesce(tasks.total, 0),
    'seguimientos_pendientes', coalesce(followups.total, 0),
    'acciones_con_error', coalesce(actions.issue_total, 0),
    'mensajes_ultimos_7_dias', coalesce(activity.total, 0)
  ) as metricas,
  not exists (
    select 1
    from public.eos_daily_briefings as existing
    where existing.usuario_id = usuario.id
      and existing.briefing_date =
        (now() at time zone 'America/Asuncion')::date
      and existing.estado = 'listo'
  ) as necesita_generacion
from public.usuarios as usuario
left join lateral (
  select source.*
  from public.eos_profiles as source
  where source.usuario_id = usuario.id
  order by source.updated_at desc nulls last, source.created_at desc nulls last
  limit 1
) as profile on true
left join lateral (
  select
    count(*)::integer as total,
    round(coalesce(avg(source.progreso), 0))::integer as average_progress,
    jsonb_agg(
      jsonb_build_object(
        'id', source.id,
        'titulo', source.titulo,
        'progreso', source.progreso,
        'prioridad', source.prioridad,
        'proximo_paso', source.proximo_paso,
        'fecha_limite', source.fecha_limite,
        'estado', source.estado
      )
      order by source.prioridad, source.fecha_limite nulls last, source.updated_at desc
    ) as items
  from (
    select goal.*
    from public.eos_goals as goal
    where goal.usuario_id = usuario.id
      and goal.estado in ('activo', 'pausado')
    order by goal.prioridad, goal.fecha_limite nulls last, goal.updated_at desc
    limit 6
  ) as source
) as goals on true
left join lateral (
  select
    count(*)::integer as total,
    jsonb_agg(
      jsonb_build_object(
        'id', source.id,
        'titulo', source.titulo,
        'descripcion', source.descripcion,
        'prioridad', source.prioridad,
        'fecha_limite', source.fecha_limite,
        'estado', source.estado
      )
      order by source.prioridad, source.fecha_limite nulls last, source.created_at desc
    ) as items
  from (
    select task.*
    from public.eos_tasks as task
    where task.usuario_id = usuario.id
      and coalesce(task.estado, 'pendiente') not in ('completada', 'completado', 'cancelada')
    order by task.prioridad, task.fecha_limite nulls last, task.created_at desc
    limit 8
  ) as source
) as tasks on true
left join lateral (
  select
    count(*)::integer as total,
    jsonb_agg(
      jsonb_build_object(
        'tipo', source.tipo,
        'severidad', source.severidad,
        'titulo', source.titulo,
        'mensaje', source.mensaje,
        'progreso', source.progreso_snapshot,
        'fecha_limite', source.fecha_limite_snapshot,
        'proximo_paso', source.proximo_paso_snapshot
      )
      order by source.programado_para, source.generado_at desc
    ) as items
  from (
    select followup.*
    from public.eos_proactive_followups as followup
    where followup.usuario_id = usuario.id
      and followup.estado in ('pendiente', 'visto')
    order by followup.programado_para, followup.generado_at desc
    limit 6
  ) as source
) as followups on true
left join lateral (
  select
    count(*) filter (where source.estado in ('error', 'no_disponible'))::integer
      as issue_total,
    jsonb_agg(
      jsonb_build_object(
        'accion', source.accion,
        'estado', source.estado,
        'resultado', source.resultado,
        'error', source.error_message,
        'created_at', source.created_at
      )
      order by source.created_at desc
    ) as items
  from (
    select command.*
    from public.eos_action_commands as command
    where command.usuario_id = usuario.id
    order by command.created_at desc
    limit 10
  ) as source
) as actions on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'categoria', source.categoria,
      'titulo', source.titulo,
      'contenido', source.contenido,
      'importancia', source.importancia,
      'confianza', source.confianza,
      'confirmada', source.confirmada
    )
    order by source.importancia desc, source.ultima_observacion_at desc
  ) as items
  from (
    select memory_item.*
    from public.eos_memory as memory_item
    where memory_item.usuario_id = usuario.id
      and coalesce(memory_item.estado, 'activo') = 'activo'
    order by memory_item.importancia desc, memory_item.ultima_observacion_at desc
    limit 12
  ) as source
) as memory on true
left join lateral (
  select
    max(source.score) filter (where source.row_number = 1) as score,
    jsonb_agg(
      jsonb_build_object(
        'area', source.area_detectada,
        'prioridad', source.prioridad,
        'diagnostico', source.diagnostico,
        'recomendacion', source.recomendacion,
        'accion_sugerida', source.accion_sugerida,
        'score', source.score,
        'created_at', source.created_at
      )
      order by source.created_at desc
    ) as items
  from (
    select
      intelligence_item.*,
      row_number() over (order by intelligence_item.created_at desc) as row_number
    from public.eos_intelligence as intelligence_item
    where intelligence_item.usuario_id = usuario.id
      and coalesce(intelligence_item.estado, 'activo') = 'activo'
    order by intelligence_item.created_at desc
    limit 6
  ) as source
) as intelligence on true
left join lateral (
  select source.score
  from public.eos_intelligence as source
  where source.usuario_id = usuario.id
    and coalesce(source.estado, 'activo') = 'activo'
  order by source.created_at desc
  limit 1
) as latest_intelligence on true
left join lateral (
  select
    count(*)::integer as total,
    jsonb_agg(
      jsonb_build_object(
        'rol', source.rol,
        'texto', left(source.texto, 1200),
        'created_at', source.created_at
      )
      order by source.created_at desc
    ) as items
  from (
    select message.*
    from public.mensajes as message
    where message.usuario_id = usuario.id
      and message.created_at >= now() - interval '7 days'
    order by message.created_at desc
    limit 14
  ) as source
) as activity on true
where lower(coalesce(usuario.estado_suscripcion, 'active'))
  not in ('cancelled', 'canceled', 'inactive', 'suspended');

alter table public.eos_daily_briefings enable row level security;
alter table public.eos_daily_briefing_runs enable row level security;

drop policy if exists eos_daily_briefings_select_own
  on public.eos_daily_briefings;

create policy eos_daily_briefings_select_own
on public.eos_daily_briefings
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = usuario_id
);

drop policy if exists eos_daily_briefing_runs_select_own
  on public.eos_daily_briefing_runs;

create policy eos_daily_briefing_runs_select_own
on public.eos_daily_briefing_runs
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = usuario_id
);

revoke all on table public.eos_daily_briefings from anon, authenticated;
revoke all on table public.eos_daily_briefing_runs from anon, authenticated;
revoke all on table public.eos_daily_briefing_context_v5 from public, anon, authenticated;

grant select on table public.eos_daily_briefings to authenticated;
grant select on table public.eos_daily_briefing_runs to authenticated;
grant all on table public.eos_daily_briefings to service_role;
grant all on table public.eos_daily_briefing_runs to service_role;
grant select on table public.eos_daily_briefing_context_v5 to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'eos_daily_briefings'
  ) then
    alter publication supabase_realtime
      add table public.eos_daily_briefings;
  end if;
end;
$$;

comment on table public.eos_daily_briefings is
  'Briefing ejecutivo diario y personalizado de cada usuario EOS.';

comment on table public.eos_daily_briefing_runs is
  'Estado auditable de la generación diaria de briefings EOS.';

comment on view public.eos_daily_briefing_context_v5 is
  'Contexto consolidado para el Worker diario; acceso exclusivo service_role.';
