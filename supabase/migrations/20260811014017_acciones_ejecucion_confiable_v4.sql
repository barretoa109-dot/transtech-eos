-- Fase 4: acciones y ejecución confiables.
-- Registra cada decisión del Worker, bloquea duplicados antes del efecto
-- secundario y conserva evidencia terminal verificable.

create extension if not exists pg_cron;

create table if not exists public.eos_action_commands (
  id uuid primary key,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  request_id uuid not null,
  accion text not null,
  estado text not null default 'recibida',
  conversacion_id uuid,
  mensaje_id uuid,
  origen text not null default 'eos-worker',
  payload jsonb not null default '{}'::jsonb,
  resultado jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  input_fingerprint text,
  retry_of uuid references public.eos_action_commands(id) on delete set null,
  attempt_count integer not null default 1,
  max_attempts integer not null default 3,
  started_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eos_action_commands_accion_check check (
    accion in (
      'RESPONDER',
      'GENERAR_EXCEL',
      'GENERAR_PDF',
      'GENERAR_WORD',
      'CREAR_TAREA',
      'CREAR_OBJETIVO',
      'GUARDAR_MEMORIA',
      'VER_DASHBOARD',
      'VER_BRIEFING'
    )
  ),
  constraint eos_action_commands_estado_check check (
    estado in (
      'recibida',
      'ejecutando',
      'completada',
      'error',
      'no_disponible',
      'cancelada'
    )
  ),
  constraint eos_action_commands_attempts_check check (
    attempt_count between 1 and max_attempts and max_attempts between 1 and 10
  ),
  constraint eos_action_commands_error_check check (
    estado <> 'error' or nullif(btrim(error_message), '') is not null
  )
);

create unique index if not exists eos_action_commands_request_action_uidx
  on public.eos_action_commands (usuario_id, request_id, accion);

create index if not exists eos_action_commands_user_created_idx
  on public.eos_action_commands (usuario_id, created_at desc);

create index if not exists eos_action_commands_conversation_idx
  on public.eos_action_commands (conversacion_id, created_at desc)
  where conversacion_id is not null;

create index if not exists eos_action_commands_open_lease_idx
  on public.eos_action_commands (lease_expires_at)
  where estado = 'ejecutando';

create index if not exists eos_action_commands_retry_of_idx
  on public.eos_action_commands (retry_of)
  where retry_of is not null;

create table if not exists public.eos_action_events (
  id bigint generated always as identity primary key,
  command_id uuid not null references public.eos_action_commands(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  tipo text not null,
  idempotency_key text not null,
  detalle jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  constraint eos_action_events_tipo_check check (
    tipo in ('iniciada', 'completada', 'error', 'no_disponible', 'cancelada')
  ),
  constraint eos_action_events_duration_check check (
    duration_ms is null or duration_ms >= 0
  )
);

create unique index if not exists eos_action_events_idempotency_uidx
  on public.eos_action_events (command_id, idempotency_key);

create index if not exists eos_action_events_command_created_idx
  on public.eos_action_events (command_id, created_at desc);

create index if not exists eos_action_events_user_created_idx
  on public.eos_action_events (usuario_id, created_at desc);

create or replace function public.eos_touch_action_command()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists eos_action_commands_touch_updated_at
  on public.eos_action_commands;

create trigger eos_action_commands_touch_updated_at
before update on public.eos_action_commands
for each row
execute function public.eos_touch_action_command();

create or replace function public.eos_validate_action_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  command_owner uuid;
begin
  select command.usuario_id
  into command_owner
  from public.eos_action_commands as command
  where command.id = new.command_id;

  if command_owner is null or command_owner <> new.usuario_id then
    raise exception 'El evento no corresponde al propietario de la orden.';
  end if;

  return new;
end;
$$;

drop trigger if exists eos_action_events_validate_owner
  on public.eos_action_events;

create trigger eos_action_events_validate_owner
before insert on public.eos_action_events
for each row
execute function public.eos_validate_action_event();

create or replace function public.eos_apply_action_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tipo = 'iniciada' then
    update public.eos_action_commands
    set
      estado = 'ejecutando',
      started_at = coalesce(started_at, new.created_at),
      lease_expires_at = new.created_at + interval '15 minutes',
      error_code = null,
      error_message = null
    where id = new.command_id
      and usuario_id = new.usuario_id
      and estado in ('recibida', 'error');

  elsif new.tipo = 'completada' then
    update public.eos_action_commands
    set
      estado = 'completada',
      resultado = coalesce(new.detalle, '{}'::jsonb),
      error_code = null,
      error_message = null,
      lease_expires_at = null,
      completed_at = new.created_at
    where id = new.command_id
      and usuario_id = new.usuario_id;

  elsif new.tipo = 'no_disponible' then
    update public.eos_action_commands
    set
      estado = 'no_disponible',
      resultado = coalesce(new.detalle, '{}'::jsonb),
      error_code = coalesce(new.error_code, 'ACTION_NOT_AVAILABLE'),
      error_message = coalesce(
        nullif(btrim(new.error_message), ''),
        'La acción todavía no está disponible.'
      ),
      lease_expires_at = null,
      completed_at = new.created_at
    where id = new.command_id
      and usuario_id = new.usuario_id;

  elsif new.tipo = 'error' then
    update public.eos_action_commands
    set
      estado = 'error',
      error_code = coalesce(new.error_code, 'ACTION_EXECUTION_ERROR'),
      error_message = coalesce(
        nullif(btrim(new.error_message), ''),
        'La ejecución terminó con error.'
      ),
      lease_expires_at = null,
      completed_at = new.created_at
    where id = new.command_id
      and usuario_id = new.usuario_id
      and estado not in ('completada', 'no_disponible', 'cancelada');

  elsif new.tipo = 'cancelada' then
    update public.eos_action_commands
    set
      estado = 'cancelada',
      resultado = coalesce(new.detalle, '{}'::jsonb),
      lease_expires_at = null,
      completed_at = new.created_at
    where id = new.command_id
      and usuario_id = new.usuario_id
      and estado not in ('completada', 'no_disponible');
  end if;

  return new;
end;
$$;

revoke all on function public.eos_apply_action_event() from public;

drop trigger if exists eos_action_events_apply_state
  on public.eos_action_events;

create trigger eos_action_events_apply_state
after insert on public.eos_action_events
for each row
execute function public.eos_apply_action_event();

create or replace function public.eos_start_action_command()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.eos_action_events (
    command_id,
    usuario_id,
    tipo,
    idempotency_key,
    detalle
  )
  values (
    new.id,
    new.usuario_id,
    'iniciada',
    'start:1',
    jsonb_build_object(
      'accion', new.accion,
      'request_id', new.request_id,
      'attempt', new.attempt_count,
      'origen', new.origen
    )
  );

  return new;
end;
$$;

revoke all on function public.eos_start_action_command() from public;

drop trigger if exists eos_action_commands_start_event
  on public.eos_action_commands;

create trigger eos_action_commands_start_event
after insert on public.eos_action_commands
for each row
execute function public.eos_start_action_command();

create or replace function public.eos_expire_stale_actions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer := 0;
begin
  with inserted as (
    insert into public.eos_action_events (
      command_id,
      usuario_id,
      tipo,
      idempotency_key,
      detalle,
      error_code,
      error_message
    )
    select
      command.id,
      command.usuario_id,
      'error',
      'timeout:' || command.attempt_count::text,
      jsonb_build_object(
        'accion', command.accion,
        'lease_expires_at', command.lease_expires_at
      ),
      'ACTION_TIMEOUT',
      'La ejecución no confirmó un resultado dentro de 15 minutos.'
    from public.eos_action_commands as command
    where command.estado = 'ejecutando'
      and command.lease_expires_at < now()
    on conflict (command_id, idempotency_key) do nothing
    returning 1
  )
  select count(*) into expired_count from inserted;

  return expired_count;
end;
$$;

revoke all on function public.eos_expire_stale_actions() from public, anon, authenticated;
grant execute on function public.eos_expire_stale_actions() to service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'eos-action-watchdog-v4'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'eos-action-watchdog-v4',
    '*/5 * * * *',
    'select public.eos_expire_stale_actions();'
  );
end;
$$;

alter table public.eos_action_commands enable row level security;
alter table public.eos_action_events enable row level security;

drop policy if exists eos_action_commands_select_own
  on public.eos_action_commands;

create policy eos_action_commands_select_own
on public.eos_action_commands
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = usuario_id
);

drop policy if exists eos_action_events_select_own
  on public.eos_action_events;

create policy eos_action_events_select_own
on public.eos_action_events
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = usuario_id
);

revoke all on table public.eos_action_commands from anon, authenticated;
revoke all on table public.eos_action_events from anon, authenticated;
grant select on table public.eos_action_commands to authenticated;
grant select on table public.eos_action_events to authenticated;
grant all on table public.eos_action_commands to service_role;
grant all on table public.eos_action_events to service_role;
grant usage, select on sequence public.eos_action_events_id_seq to service_role;

alter table public.eos_tasks
  add column if not exists action_command_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_tasks_action_command_id_fkey'
      and conrelid = 'public.eos_tasks'::regclass
  ) then
    alter table public.eos_tasks
      add constraint eos_tasks_action_command_id_fkey
      foreign key (action_command_id)
      references public.eos_action_commands(id)
      on delete set null;
  end if;
end;
$$;

create unique index if not exists eos_tasks_action_command_uidx
  on public.eos_tasks (action_command_id)
  where action_command_id is not null;

alter table public.eos_tasks enable row level security;

create or replace function public.eos_preserve_task_action_command()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
    and old.action_command_id is distinct from new.action_command_id then
    raise exception 'action_command_id es administrado exclusivamente por EOS.';
  end if;

  return new;
end;
$$;

drop trigger if exists eos_tasks_preserve_action_command
  on public.eos_tasks;

create trigger eos_tasks_preserve_action_command
before update on public.eos_tasks
for each row
execute function public.eos_preserve_task_action_command();

drop policy if exists eos_tasks_select_own on public.eos_tasks;
drop policy if exists eos_tasks_insert_own on public.eos_tasks;
drop policy if exists eos_tasks_update_own on public.eos_tasks;
drop policy if exists eos_tasks_delete_own on public.eos_tasks;

create policy eos_tasks_select_own
on public.eos_tasks
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = usuario_id
);

create policy eos_tasks_insert_own
on public.eos_tasks
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = usuario_id
  and action_command_id is null
);

create policy eos_tasks_update_own
on public.eos_tasks
for update
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = usuario_id
)
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = usuario_id
);

create policy eos_tasks_delete_own
on public.eos_tasks
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = usuario_id
);

grant select, insert, update, delete on table public.eos_tasks to authenticated;
grant all on table public.eos_tasks to service_role;

comment on table public.eos_action_commands is
  'Órdenes idempotentes del Worker EOS con estado y resultado verificables.';

comment on table public.eos_action_events is
  'Bitácora inmutable de inicio, éxito, indisponibilidad o error de cada acción EOS.';

comment on column public.eos_tasks.action_command_id is
  'Orden EOS que originó la tarea; evita duplicar el efecto secundario.';
