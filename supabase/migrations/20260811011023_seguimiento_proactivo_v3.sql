begin;

create table if not exists public.eos_followup_preferences (
  usuario_id uuid primary key references public.usuarios(id) on delete cascade,
  habilitado boolean not null default true,
  canal_web boolean not null default true,
  canal_email boolean not null default false,
  canal_whatsapp boolean not null default false,
  zona_horaria text not null default 'America/Asuncion',
  hora_local smallint not null default 8 check (hora_local between 0 and 23),
  dias_sin_avance smallint not null default 7 check (dias_sin_avance between 1 and 90),
  dias_vence_pronto smallint not null default 3 check (dias_vence_pronto between 1 and 30),
  dias_entre_recordatorios smallint not null default 3
    check (dias_entre_recordatorios between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.eos_proactive_followups (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  objetivo_id uuid not null references public.eos_goals(id) on delete cascade,
  tipo text not null check (
    tipo in ('objetivo_vencido', 'vence_pronto', 'sin_avance')
  ),
  severidad text not null check (
    severidad in ('media', 'alta', 'critica')
  ),
  titulo text not null,
  mensaje text not null,
  progreso_snapshot integer not null check (
    progreso_snapshot between 0 and 100
  ),
  fecha_limite_snapshot date,
  proximo_paso_snapshot text,
  estado text not null default 'pendiente' check (
    estado in ('pendiente', 'visto', 'resuelto', 'descartado')
  ),
  dedupe_key text not null,
  programado_para timestamptz not null default now(),
  generado_at timestamptz not null default now(),
  visto_at timestamptz,
  resuelto_at timestamptz,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.eos_followup_runs (
  id uuid primary key default gen_random_uuid(),
  origen text not null default 'n8n_schedule',
  solicitado_at timestamptz not null default now(),
  objetivos_evaluados integer not null default 0,
  seguimientos_creados integer not null default 0,
  estado text not null default 'pendiente' check (
    estado in ('pendiente', 'completado', 'error')
  ),
  error text,
  completado_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists eos_proactive_followups_dedupe_idx
  on public.eos_proactive_followups (objetivo_id, tipo, dedupe_key);

create index if not exists eos_proactive_followups_usuario_estado_idx
  on public.eos_proactive_followups (usuario_id, estado, generado_at desc)
  where estado in ('pendiente', 'visto');

create index if not exists eos_proactive_followups_objetivo_estado_idx
  on public.eos_proactive_followups (objetivo_id, estado);

create index if not exists eos_followup_runs_solicitado_idx
  on public.eos_followup_runs (solicitado_at desc);

create or replace function public.eos_followup_prepare_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();

  if new.estado = 'visto' then
    new.visto_at := coalesce(new.visto_at, now());
  elsif new.estado in ('resuelto', 'descartado') then
    new.visto_at := coalesce(new.visto_at, now());
    new.resuelto_at := coalesce(new.resuelto_at, now());
  end if;

  return new;
end;
$$;

create or replace function public.eos_generate_proactive_followups(
  p_now timestamptz default now()
)
returns table (
  objetivos_evaluados integer,
  seguimientos_creados integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cantidad_objetivos integer := 0;
  cantidad_creada integer := 0;
begin
  select count(*)::integer
  into cantidad_objetivos
  from public.eos_goals as g
  left join public.eos_followup_preferences as p
    on p.usuario_id = g.usuario_id
  where g.estado = 'activo'
    and coalesce(p.habilitado, true)
    and coalesce(p.canal_web, true);

  with elegibles as (
    select
      g.id as objetivo_id,
      g.usuario_id,
      g.titulo as objetivo_titulo,
      g.progreso,
      g.fecha_limite,
      g.proximo_paso,
      g.ultima_actualizacion_at,
      coalesce(p.zona_horaria, 'America/Asuncion') as zona_horaria,
      coalesce(p.dias_sin_avance, 7)::integer as dias_sin_avance,
      coalesce(p.dias_vence_pronto, 3)::integer as dias_vence_pronto,
      coalesce(p.dias_entre_recordatorios, 3)::integer
        as dias_entre_recordatorios,
      (p_now at time zone coalesce(
        p.zona_horaria,
        'America/Asuncion'
      ))::date as fecha_local
    from public.eos_goals as g
    left join public.eos_followup_preferences as p
      on p.usuario_id = g.usuario_id
    where g.estado = 'activo'
      and coalesce(p.habilitado, true)
      and coalesce(p.canal_web, true)
  ),
  candidatos as (
    select
      e.*,
      case
        when e.fecha_limite is not null
          and e.fecha_limite < e.fecha_local
          then 'objetivo_vencido'
        when e.fecha_limite is not null
          and e.fecha_limite between e.fecha_local
            and e.fecha_local + e.dias_vence_pronto
          then 'vence_pronto'
        when e.ultima_actualizacion_at <= p_now - make_interval(
          days => e.dias_sin_avance
        ) then 'sin_avance'
        else null
      end as tipo_seguimiento,
      greatest(
        0,
        e.fecha_local - coalesce(e.fecha_limite, e.fecha_local)
      )::integer as dias_vencido,
      greatest(
        0,
        coalesce(e.fecha_limite, e.fecha_local) - e.fecha_local
      )::integer as dias_para_vencer,
      greatest(
        0,
        floor(extract(epoch from (
          p_now - e.ultima_actualizacion_at
        )) / 86400)
      )::integer as dias_estancado
    from elegibles as e
  ),
  preparados as (
    select
      c.*,
      case c.tipo_seguimiento
        when 'objetivo_vencido' then 'critica'
        when 'vence_pronto' then 'alta'
        else 'media'
      end as severidad,
      case c.tipo_seguimiento
        when 'objetivo_vencido' then 'Objetivo vencido'
        when 'vence_pronto' then 'Fecha límite próxima'
        else 'Objetivo sin avance reciente'
      end as titulo_seguimiento,
      case c.tipo_seguimiento
        when 'objetivo_vencido' then format(
          'El objetivo "%s" venció hace %s día%s y está en %s%%. Próximo paso: %s',
          left(c.objetivo_titulo, 140),
          c.dias_vencido,
          case when c.dias_vencido = 1 then '' else 's' end,
          c.progreso,
          coalesce(c.proximo_paso, 'revisar la fecha y definir una acción concreta.')
        )
        when 'vence_pronto' then format(
          'El objetivo "%s" vence en %s día%s y está en %s%%. Próximo paso: %s',
          left(c.objetivo_titulo, 140),
          c.dias_para_vencer,
          case when c.dias_para_vencer = 1 then '' else 's' end,
          c.progreso,
          coalesce(c.proximo_paso, 'definir la acción de mayor impacto para hoy.')
        )
        else format(
          'El objetivo "%s" lleva %s días sin avance registrado y está en %s%%. Próximo paso: %s',
          left(c.objetivo_titulo, 140),
          c.dias_estancado,
          c.progreso,
          coalesce(c.proximo_paso, 'registrar evidencia o definir una acción ejecutable.')
        )
      end as mensaje_seguimiento,
      case c.tipo_seguimiento
        when 'objetivo_vencido' then concat(
          'v1:',
          c.fecha_limite,
          ':',
          floor(c.dias_vencido / nullif(c.dias_entre_recordatorios, 0))
        )
        when 'vence_pronto' then concat('v1:', c.fecha_limite)
        else concat(
          'v1:',
          c.ultima_actualizacion_at::date,
          ':',
          floor(
            greatest(0, c.dias_estancado - c.dias_sin_avance)
            / nullif(c.dias_entre_recordatorios, 0)
          )
        )
      end as dedupe_key
    from candidatos as c
    where c.tipo_seguimiento is not null
  ),
  insertados as (
    insert into public.eos_proactive_followups (
      usuario_id,
      objetivo_id,
      tipo,
      severidad,
      titulo,
      mensaje,
      progreso_snapshot,
      fecha_limite_snapshot,
      proximo_paso_snapshot,
      dedupe_key,
      programado_para,
      metadata
    )
    select
      p.usuario_id,
      p.objetivo_id,
      p.tipo_seguimiento,
      p.severidad,
      p.titulo_seguimiento,
      p.mensaje_seguimiento,
      p.progreso,
      p.fecha_limite,
      p.proximo_paso,
      p.dedupe_key,
      p_now,
      jsonb_build_object(
        'version', 'eos-followup-v3',
        'zona_horaria', p.zona_horaria,
        'dias_vencido', p.dias_vencido,
        'dias_para_vencer', p.dias_para_vencer,
        'dias_sin_avance', p.dias_estancado
      )
    from preparados as p
    on conflict (objetivo_id, tipo, dedupe_key) do nothing
    returning 1
  )
  select count(*)::integer
  into cantidad_creada
  from insertados;

  return query select cantidad_objetivos, cantidad_creada;
end;
$$;

create or replace function public.eos_process_followup_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cantidad_objetivos integer;
  cantidad_creada integer;
begin
  select
    resultado.objetivos_evaluados,
    resultado.seguimientos_creados
  into cantidad_objetivos, cantidad_creada
  from public.eos_generate_proactive_followups(new.solicitado_at)
    as resultado;

  update public.eos_followup_runs
  set objetivos_evaluados = cantidad_objetivos,
      seguimientos_creados = cantidad_creada,
      estado = 'completado',
      completado_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'version', 'eos-followup-v3'
      )
  where id = new.id;

  return new;
end;
$$;

create or replace function public.eos_resolve_followups_on_goal_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if
    new.progreso is distinct from old.progreso
    or new.valor_actual is distinct from old.valor_actual
    or new.estado is distinct from old.estado
    or new.proximo_paso is distinct from old.proximo_paso
  then
    update public.eos_proactive_followups
    set estado = 'resuelto',
        resuelto_at = now(),
        updated_at = now(),
        metadata = metadata || jsonb_build_object(
          'resuelto_por', 'avance_objetivo'
        )
    where objetivo_id = new.id
      and estado in ('pendiente', 'visto');
  end if;

  return new;
end;
$$;

drop trigger if exists eos_followup_prepare_before_write
on public.eos_proactive_followups;
create trigger eos_followup_prepare_before_write
before insert or update on public.eos_proactive_followups
for each row execute function public.eos_followup_prepare_row();

drop trigger if exists eos_followup_run_after_insert
on public.eos_followup_runs;
create trigger eos_followup_run_after_insert
after insert on public.eos_followup_runs
for each row execute function public.eos_process_followup_run();

drop trigger if exists eos_goal_resolve_followups_after_update
on public.eos_goals;
create trigger eos_goal_resolve_followups_after_update
after update on public.eos_goals
for each row execute function public.eos_resolve_followups_on_goal_change();

alter table public.eos_followup_preferences enable row level security;
alter table public.eos_proactive_followups enable row level security;
alter table public.eos_followup_runs enable row level security;

drop policy if exists eos_followup_preferences_select_own
on public.eos_followup_preferences;
drop policy if exists eos_followup_preferences_insert_own
on public.eos_followup_preferences;
drop policy if exists eos_followup_preferences_update_own
on public.eos_followup_preferences;

create policy eos_followup_preferences_select_own
on public.eos_followup_preferences
for select
to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_followup_preferences_insert_own
on public.eos_followup_preferences
for insert
to authenticated
with check ((select auth.uid()) = usuario_id);

create policy eos_followup_preferences_update_own
on public.eos_followup_preferences
for update
to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

drop policy if exists eos_proactive_followups_select_own
on public.eos_proactive_followups;
drop policy if exists eos_proactive_followups_update_own
on public.eos_proactive_followups;

create policy eos_proactive_followups_select_own
on public.eos_proactive_followups
for select
to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_proactive_followups_update_own
on public.eos_proactive_followups
for update
to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

revoke all on table public.eos_followup_preferences from anon, authenticated;
revoke all on table public.eos_proactive_followups from anon, authenticated;
revoke all on table public.eos_followup_runs from anon, authenticated;

grant select, insert, update
on table public.eos_followup_preferences
to authenticated;

grant select
on table public.eos_proactive_followups
to authenticated;

grant update (
  estado,
  visto_at,
  resuelto_at,
  updated_at
)
on table public.eos_proactive_followups
to authenticated;

grant all on table public.eos_followup_preferences to service_role;
grant all on table public.eos_proactive_followups to service_role;
grant all on table public.eos_followup_runs to service_role;

revoke all on function public.eos_followup_prepare_row() from public;
revoke all on function public.eos_generate_proactive_followups(timestamptz)
from public;
revoke all on function public.eos_process_followup_run() from public;
revoke all on function public.eos_resolve_followups_on_goal_change()
from public;

grant execute on function public.eos_followup_prepare_row()
to authenticated, service_role;
grant execute on function public.eos_generate_proactive_followups(timestamptz)
to service_role;
grant execute on function public.eos_process_followup_run()
to service_role;
grant execute on function public.eos_resolve_followups_on_goal_change()
to authenticated, service_role;

-- Las tablas heredadas quedan cerradas. Fase 3 usa eos_proactive_followups.
drop policy if exists "Allow read seguimientos" on public.seguimientos;
revoke all on table public.seguimientos from anon, authenticated;
revoke all on table public.eos_notifications from anon, authenticated;

comment on table public.eos_followup_preferences is
  'Preferencias de seguimiento proactivo por usuario y canal.';
comment on table public.eos_proactive_followups is
  'Alertas proactivas deduplicadas que se resuelven cuando el objetivo avanza.';
comment on table public.eos_followup_runs is
  'Auditoría técnica de cada ejecución programada del motor de seguimiento.';
comment on table public.seguimientos is
  'Tabla heredada. Fase 3 usa public.eos_proactive_followups.';

commit;
