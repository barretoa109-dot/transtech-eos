begin;

-- EOS usa public.eos_goals como tabla canónica de objetivos.
alter table public.eos_goals
  add column if not exists tipo_medicion text not null default 'porcentaje',
  add column if not exists valor_inicial numeric(18, 4),
  add column if not exists valor_actual numeric(18, 4),
  add column if not exists valor_objetivo numeric(18, 4),
  add column if not exists unidad text,
  add column if not exists prioridad smallint not null default 3,
  add column if not exists criterio_exito text,
  add column if not exists proximo_paso text,
  add column if not exists fecha_inicio date not null default current_date,
  add column if not exists fecha_limite date,
  add column if not exists request_id uuid,
  add column if not exists conversacion_id uuid,
  add column if not exists mensaje_id uuid,
  add column if not exists progreso_confianza numeric(4, 3) not null default 1.000,
  add column if not exists ultima_actualizacion_at timestamptz not null default now(),
  add column if not exists completado_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.eos_goals
set progreso = coalesce(progreso, 0),
    estado = coalesce(nullif(btrim(estado), ''), 'activo'),
    titulo = coalesce(nullif(btrim(titulo), ''), 'Objetivo EOS'),
    tipo_medicion = coalesce(nullif(btrim(tipo_medicion), ''), 'porcentaje'),
    prioridad = coalesce(prioridad, 3),
    progreso_confianza = coalesce(progreso_confianza, 1.000),
    fecha_inicio = coalesce(fecha_inicio, created_at::date, current_date),
    ultima_actualizacion_at = coalesce(ultima_actualizacion_at, created_at, now()),
    updated_at = coalesce(updated_at, created_at, now()),
    metadata = coalesce(metadata, '{}'::jsonb);

alter table public.eos_goals
  alter column usuario_id set not null,
  alter column titulo set not null,
  alter column progreso set default 0,
  alter column progreso set not null,
  alter column estado set default 'activo',
  alter column estado set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_goals_usuario_id_fkey'
      and conrelid = 'public.eos_goals'::regclass
  ) then
    alter table public.eos_goals
      add constraint eos_goals_usuario_id_fkey
      foreign key (usuario_id)
      references public.usuarios(id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_goals_conversacion_id_fkey'
      and conrelid = 'public.eos_goals'::regclass
  ) then
    alter table public.eos_goals
      add constraint eos_goals_conversacion_id_fkey
      foreign key (conversacion_id)
      references public.conversaciones(id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_goals_mensaje_id_fkey'
      and conrelid = 'public.eos_goals'::regclass
  ) then
    alter table public.eos_goals
      add constraint eos_goals_mensaje_id_fkey
      foreign key (mensaje_id)
      references public.mensajes(id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_goals_progreso_check'
      and conrelid = 'public.eos_goals'::regclass
  ) then
    alter table public.eos_goals
      add constraint eos_goals_progreso_check
      check (progreso >= 0 and progreso <= 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_goals_estado_check'
      and conrelid = 'public.eos_goals'::regclass
  ) then
    alter table public.eos_goals
      add constraint eos_goals_estado_check
      check (estado in ('borrador', 'activo', 'pausado', 'completado', 'cancelado'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_goals_tipo_medicion_check'
      and conrelid = 'public.eos_goals'::regclass
  ) then
    alter table public.eos_goals
      add constraint eos_goals_tipo_medicion_check
      check (tipo_medicion in ('porcentaje', 'numerico', 'monetario', 'hitos'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_goals_prioridad_check'
      and conrelid = 'public.eos_goals'::regclass
  ) then
    alter table public.eos_goals
      add constraint eos_goals_prioridad_check
      check (prioridad between 1 and 5);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_goals_progreso_confianza_check'
      and conrelid = 'public.eos_goals'::regclass
  ) then
    alter table public.eos_goals
      add constraint eos_goals_progreso_confianza_check
      check (progreso_confianza >= 0 and progreso_confianza <= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_goals_fechas_check'
      and conrelid = 'public.eos_goals'::regclass
  ) then
    alter table public.eos_goals
      add constraint eos_goals_fechas_check
      check (fecha_limite is null or fecha_limite >= fecha_inicio);
  end if;
end
$$;

alter table public.eos_goals validate constraint eos_goals_usuario_id_fkey;
alter table public.eos_goals validate constraint eos_goals_conversacion_id_fkey;
alter table public.eos_goals validate constraint eos_goals_mensaje_id_fkey;

create table if not exists public.eos_goal_milestones (
  id uuid primary key default gen_random_uuid(),
  objetivo_id uuid not null references public.eos_goals(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  clave text,
  titulo text not null,
  descripcion text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_progreso', 'completado', 'cancelado')),
  peso numeric(8, 4) not null default 1.0000 check (peso > 0),
  orden smallint not null default 0,
  fecha_limite date,
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  mensaje_id uuid references public.mensajes(id) on delete set null,
  completado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.eos_goal_events (
  id uuid primary key default gen_random_uuid(),
  objetivo_id uuid not null references public.eos_goals(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  tipo text not null
    check (tipo in ('creado', 'progreso', 'estado', 'hito', 'evidencia', 'ajuste')),
  progreso_anterior integer check (
    progreso_anterior is null or progreso_anterior between 0 and 100
  ),
  progreso_nuevo integer check (
    progreso_nuevo is null or progreso_nuevo between 0 and 100
  ),
  valor_anterior numeric(18, 4),
  valor_nuevo numeric(18, 4),
  descripcion text not null,
  evidencia jsonb not null default '{}'::jsonb,
  fuente text not null default 'sistema',
  confianza numeric(4, 3) not null default 1.000
    check (confianza >= 0 and confianza <= 1),
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  mensaje_id uuid references public.mensajes(id) on delete set null,
  request_id uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists eos_goals_usuario_request_unique_idx
  on public.eos_goals (usuario_id, request_id)
  where request_id is not null;

create index if not exists eos_goals_usuario_estado_updated_idx
  on public.eos_goals (usuario_id, estado, updated_at desc);

create index if not exists eos_goals_usuario_fecha_limite_idx
  on public.eos_goals (usuario_id, fecha_limite)
  where estado in ('activo', 'pausado');

create index if not exists eos_goals_proyecto_idx
  on public.eos_goals (proyecto_id)
  where proyecto_id is not null;

create index if not exists eos_goals_conversacion_idx
  on public.eos_goals (conversacion_id)
  where conversacion_id is not null;

create index if not exists eos_goals_mensaje_idx
  on public.eos_goals (mensaje_id)
  where mensaje_id is not null;

create unique index if not exists eos_goal_milestones_objetivo_clave_unique_idx
  on public.eos_goal_milestones (objetivo_id, clave)
  where clave is not null;

create index if not exists eos_goal_milestones_objetivo_estado_orden_idx
  on public.eos_goal_milestones (objetivo_id, estado, orden);

create index if not exists eos_goal_milestones_usuario_idx
  on public.eos_goal_milestones (usuario_id);

create index if not exists eos_goal_milestones_conversacion_idx
  on public.eos_goal_milestones (conversacion_id)
  where conversacion_id is not null;

create index if not exists eos_goal_milestones_mensaje_idx
  on public.eos_goal_milestones (mensaje_id)
  where mensaje_id is not null;

create index if not exists eos_goal_events_objetivo_created_idx
  on public.eos_goal_events (objetivo_id, created_at desc);

create index if not exists eos_goal_events_usuario_created_idx
  on public.eos_goal_events (usuario_id, created_at desc);

create index if not exists eos_goal_events_conversacion_idx
  on public.eos_goal_events (conversacion_id)
  where conversacion_id is not null;

create index if not exists eos_goal_events_mensaje_idx
  on public.eos_goal_events (mensaje_id)
  where mensaje_id is not null;

create or replace function public.eos_goal_prepare_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  progreso_calculado numeric;
begin
  new.titulo := btrim(new.titulo);
  new.descripcion := nullif(btrim(coalesce(new.descripcion, '')), '');
  new.unidad := nullif(btrim(coalesce(new.unidad, '')), '');
  new.criterio_exito := nullif(btrim(coalesce(new.criterio_exito, '')), '');
  new.proximo_paso := nullif(btrim(coalesce(new.proximo_paso, '')), '');
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.fecha_inicio := coalesce(new.fecha_inicio, current_date);
    new.ultima_actualizacion_at := coalesce(new.ultima_actualizacion_at, now());
  elsif
    new.progreso is distinct from old.progreso
    or new.valor_actual is distinct from old.valor_actual
    or new.estado is distinct from old.estado
    or new.proximo_paso is distinct from old.proximo_paso
    or new.metadata is distinct from old.metadata
  then
    new.ultima_actualizacion_at := now();
  end if;

  if new.tipo_medicion in ('numerico', 'monetario')
    and new.valor_inicial is not null
    and new.valor_actual is not null
    and new.valor_objetivo is not null
    and new.valor_objetivo <> new.valor_inicial
  then
    progreso_calculado :=
      ((new.valor_actual - new.valor_inicial)
        / (new.valor_objetivo - new.valor_inicial)) * 100;
    new.progreso := round(greatest(0, least(100, progreso_calculado)))::integer;
  else
    new.progreso := greatest(0, least(100, coalesce(new.progreso, 0)));
  end if;

  if new.estado = 'completado' then
    new.progreso := 100;
    new.completado_at := coalesce(new.completado_at, now());
  elsif new.progreso = 100 and new.estado not in ('cancelado', 'pausado') then
    new.estado := 'completado';
    new.completado_at := coalesce(new.completado_at, now());
  elsif new.progreso < 100 then
    new.completado_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.eos_goal_log_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tipo_evento text;
  descripcion_evento text;
begin
  if tg_op = 'INSERT' then
    tipo_evento := 'creado';
    descripcion_evento := coalesce(
      nullif(new.metadata ->> 'evidencia', ''),
      'Objetivo creado en EOS.'
    );
  elsif new.progreso is distinct from old.progreso
    or new.valor_actual is distinct from old.valor_actual
  then
    tipo_evento := 'progreso';
    descripcion_evento := coalesce(
      nullif(new.metadata ->> 'evidencia', ''),
      format('Progreso actualizado de %s%% a %s%%.', old.progreso, new.progreso)
    );
  elsif new.estado is distinct from old.estado then
    tipo_evento := 'estado';
    descripcion_evento := coalesce(
      nullif(new.metadata ->> 'evidencia', ''),
      format('Estado actualizado de %s a %s.', old.estado, new.estado)
    );
  elsif new.metadata is distinct from old.metadata then
    tipo_evento := 'evidencia';
    descripcion_evento := coalesce(
      nullif(new.metadata ->> 'evidencia', ''),
      'EOS registró nueva evidencia para el objetivo.'
    );
  else
    return new;
  end if;

  insert into public.eos_goal_events (
    objetivo_id,
    usuario_id,
    tipo,
    progreso_anterior,
    progreso_nuevo,
    valor_anterior,
    valor_nuevo,
    descripcion,
    evidencia,
    fuente,
    confianza,
    conversacion_id,
    mensaje_id,
    request_id
  ) values (
    new.id,
    new.usuario_id,
    tipo_evento,
    case when tg_op = 'UPDATE' then old.progreso else null end,
    new.progreso,
    case when tg_op = 'UPDATE' then old.valor_actual else null end,
    new.valor_actual,
    descripcion_evento,
    jsonb_build_object(
      'tipo_medicion', new.tipo_medicion,
      'unidad', new.unidad,
      'metadata', new.metadata
    ),
    coalesce(nullif(new.metadata ->> 'fuente', ''), 'sistema'),
    new.progreso_confianza,
    new.conversacion_id,
    new.mensaje_id,
    new.request_id
  );

  return new;
end;
$$;

create or replace function public.eos_goal_prepare_milestone()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  propietario_id uuid;
begin
  select g.usuario_id
  into propietario_id
  from public.eos_goals as g
  where g.id = new.objetivo_id;

  if propietario_id is null then
    raise exception 'Objetivo no disponible.';
  end if;

  new.usuario_id := propietario_id;
  new.titulo := btrim(new.titulo);
  new.clave := nullif(btrim(coalesce(new.clave, '')), '');
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  new.updated_at := now();

  if new.estado = 'completado' then
    new.completado_at := coalesce(new.completado_at, now());
  else
    new.completado_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.eos_goal_recalculate_from_milestones()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  objetivo uuid;
  peso_total numeric;
  peso_completado numeric;
  progreso_calculado integer;
  hito_titulo text;
begin
  objetivo := coalesce(new.objetivo_id, old.objetivo_id);
  hito_titulo := coalesce(new.titulo, old.titulo, 'Hito');

  select
    coalesce(sum(m.peso) filter (where m.estado <> 'cancelado'), 0),
    coalesce(sum(m.peso) filter (where m.estado = 'completado'), 0)
  into peso_total, peso_completado
  from public.eos_goal_milestones as m
  where m.objetivo_id = objetivo;

  if peso_total > 0 then
    progreso_calculado := round((peso_completado / peso_total) * 100)::integer;

    update public.eos_goals
    set tipo_medicion = 'hitos',
        progreso = progreso_calculado,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'fuente', 'hitos',
          'evidencia', format('Hito actualizado: %s.', hito_titulo)
        )
    where id = objetivo;
  end if;

  return null;
end;
$$;

drop trigger if exists eos_goal_prepare_before_write on public.eos_goals;
create trigger eos_goal_prepare_before_write
before insert or update on public.eos_goals
for each row execute function public.eos_goal_prepare_row();

drop trigger if exists eos_goal_log_after_write on public.eos_goals;
create trigger eos_goal_log_after_write
after insert or update on public.eos_goals
for each row execute function public.eos_goal_log_event();

drop trigger if exists eos_goal_milestone_prepare_before_write
on public.eos_goal_milestones;
create trigger eos_goal_milestone_prepare_before_write
before insert or update on public.eos_goal_milestones
for each row execute function public.eos_goal_prepare_milestone();

drop trigger if exists eos_goal_milestone_recalculate_after_write
on public.eos_goal_milestones;
create trigger eos_goal_milestone_recalculate_after_write
after insert or update or delete on public.eos_goal_milestones
for each row execute function public.eos_goal_recalculate_from_milestones();

revoke all on function public.eos_goal_prepare_row() from public;
revoke all on function public.eos_goal_log_event() from public;
revoke all on function public.eos_goal_prepare_milestone() from public;
revoke all on function public.eos_goal_recalculate_from_milestones() from public;

grant execute on function public.eos_goal_prepare_row() to authenticated, service_role;
grant execute on function public.eos_goal_log_event() to authenticated, service_role;
grant execute on function public.eos_goal_prepare_milestone() to authenticated, service_role;
grant execute on function public.eos_goal_recalculate_from_milestones() to authenticated, service_role;

alter table public.eos_goals enable row level security;
alter table public.eos_goal_milestones enable row level security;
alter table public.eos_goal_events enable row level security;

drop policy if exists eos_goals_select_own on public.eos_goals;
drop policy if exists eos_goals_insert_own on public.eos_goals;
drop policy if exists eos_goals_update_own on public.eos_goals;
drop policy if exists eos_goals_delete_own on public.eos_goals;

create policy eos_goals_select_own
on public.eos_goals
for select
to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_goals_insert_own
on public.eos_goals
for insert
to authenticated
with check ((select auth.uid()) = usuario_id);

create policy eos_goals_update_own
on public.eos_goals
for update
to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

create policy eos_goals_delete_own
on public.eos_goals
for delete
to authenticated
using ((select auth.uid()) = usuario_id);

drop policy if exists eos_goal_milestones_select_own
on public.eos_goal_milestones;
drop policy if exists eos_goal_milestones_insert_own
on public.eos_goal_milestones;
drop policy if exists eos_goal_milestones_update_own
on public.eos_goal_milestones;
drop policy if exists eos_goal_milestones_delete_own
on public.eos_goal_milestones;

create policy eos_goal_milestones_select_own
on public.eos_goal_milestones
for select
to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_goal_milestones_insert_own
on public.eos_goal_milestones
for insert
to authenticated
with check ((select auth.uid()) = usuario_id);

create policy eos_goal_milestones_update_own
on public.eos_goal_milestones
for update
to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

create policy eos_goal_milestones_delete_own
on public.eos_goal_milestones
for delete
to authenticated
using ((select auth.uid()) = usuario_id);

drop policy if exists eos_goal_events_select_own on public.eos_goal_events;
drop policy if exists eos_goal_events_insert_own on public.eos_goal_events;

create policy eos_goal_events_select_own
on public.eos_goal_events
for select
to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_goal_events_insert_own
on public.eos_goal_events
for insert
to authenticated
with check ((select auth.uid()) = usuario_id);

revoke all on table public.eos_goals from anon, authenticated;
revoke all on table public.eos_goal_milestones from anon, authenticated;
revoke all on table public.eos_goal_events from anon, authenticated;

grant select, insert, update, delete on table public.eos_goals to authenticated;
grant select, insert, update, delete on table public.eos_goal_milestones to authenticated;
grant select, insert on table public.eos_goal_events to authenticated;

grant all on table public.eos_goals to service_role;
grant all on table public.eos_goal_milestones to service_role;
grant all on table public.eos_goal_events to service_role;

comment on table public.eos_goals is
  'Objetivos canónicos de EOS con medición, trazabilidad y progreso automático.';
comment on table public.eos_goal_milestones is
  'Hitos ponderados de los objetivos de EOS.';
comment on table public.eos_goal_events is
  'Historial inmutable de evidencias y cambios de progreso de objetivos.';
comment on table public.objetivos is
  'Tabla heredada. EOS usa public.eos_goals como fuente canónica desde Objetivos v2.';

-- Crea una evidencia inicial para los objetivos anteriores a esta fase.
insert into public.eos_goal_events (
  objetivo_id,
  usuario_id,
  tipo,
  progreso_nuevo,
  valor_nuevo,
  descripcion,
  evidencia,
  fuente,
  confianza,
  conversacion_id,
  mensaje_id,
  request_id,
  created_at
)
select
  g.id,
  g.usuario_id,
  'creado',
  g.progreso,
  g.valor_actual,
  'Objetivo incorporado al seguimiento automático de EOS.',
  jsonb_build_object('migracion', 'objetivos_v2'),
  'migracion',
  1.000,
  g.conversacion_id,
  g.mensaje_id,
  g.request_id,
  coalesce(g.created_at, now())
from public.eos_goals as g
where not exists (
  select 1
  from public.eos_goal_events as e
  where e.objetivo_id = g.id
);

commit;
