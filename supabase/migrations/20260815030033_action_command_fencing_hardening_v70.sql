-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

create or replace function public.eos_claim_action_command_v65(
  p_command_id uuid,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command public.eos_action_commands%rowtype;
  v_attempt integer;
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 900));
  v_token uuid;
  v_claim_key text;
begin
  if p_command_id is null then
    raise exception 'EOS_COMMAND_ID_REQUIRED';
  end if;

  select c.* into v_command
  from public.eos_action_commands c
  where c.id = p_command_id
  for update;

  if not found then
    raise exception 'EOS_COMMAND_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.eos_autonomy_events_v12 e
    where e.command_id = v_command.id
      and e.usuario_id = v_command.usuario_id
      and e.event_type in ('auto_allowed', 'consumed')
  ) then
    raise exception 'EOS_COMMAND_NOT_AUTHORIZED';
  end if;

  if v_command.estado = 'completada' then
    return jsonb_build_object(
      'ok', true,
      'claimed', false,
      'idempotent', true,
      'code', 'EOS_COMMAND_ALREADY_COMPLETED',
      'command_id', v_command.id,
      'estado', v_command.estado,
      'attempt_count', v_command.attempt_count,
      'max_attempts', v_command.max_attempts,
      'resultado', v_command.resultado
    );
  end if;

  if v_command.estado in ('cancelada', 'no_disponible') then
    return jsonb_build_object(
      'ok', false,
      'claimed', false,
      'idempotent', true,
      'code', 'EOS_COMMAND_NOT_EXECUTABLE',
      'command_id', v_command.id,
      'estado', v_command.estado,
      'attempt_count', v_command.attempt_count,
      'max_attempts', v_command.max_attempts
    );
  end if;

  if v_command.estado = 'ejecutando'
     and v_command.lease_token is not null
     and v_command.lease_expires_at is not null
     and v_command.lease_expires_at > now() then
    return jsonb_build_object(
      'ok', true,
      'claimed', false,
      'idempotent', true,
      'code', 'EOS_COMMAND_IN_PROGRESS',
      'command_id', v_command.id,
      'estado', v_command.estado,
      'attempt_count', v_command.attempt_count,
      'max_attempts', v_command.max_attempts,
      'lease_expires_at', v_command.lease_expires_at
    );
  end if;

  if v_command.estado not in ('recibida', 'ejecutando', 'error') then
    raise exception 'EOS_COMMAND_STATE_INVALID: %', v_command.estado;
  end if;

  v_attempt := case
    when v_command.lease_token is null
         and v_command.estado in ('recibida', 'ejecutando')
      then v_command.attempt_count
    else v_command.attempt_count + 1
  end;

  if v_attempt > v_command.max_attempts then
    update public.eos_action_commands c
    set estado = 'error',
        lease_expires_at = null,
        lease_token = null,
        error_code = 'EOS_COMMAND_MAX_ATTEMPTS',
        error_message = 'Se agotó el máximo de intentos permitidos para esta orden.',
        updated_at = now()
    where c.id = v_command.id;

    return jsonb_build_object(
      'ok', false,
      'claimed', false,
      'idempotent', true,
      'code', 'EOS_COMMAND_MAX_ATTEMPTS',
      'command_id', v_command.id,
      'estado', 'error',
      'attempt_count', v_command.attempt_count,
      'max_attempts', v_command.max_attempts
    );
  end if;

  v_token := gen_random_uuid();

  update public.eos_action_commands c
  set estado = 'ejecutando',
      attempt_count = v_attempt,
      started_at = coalesce(c.started_at, now()),
      claimed_at = now(),
      lease_token = v_token,
      lease_expires_at = now() + make_interval(secs => v_lease_seconds),
      completed_at = null,
      error_code = null,
      error_message = null,
      updated_at = now()
  where c.id = v_command.id
  returning c.* into v_command;

  v_claim_key := 'claim:' || v_attempt::text;
  insert into public.eos_action_events (
    command_id,
    usuario_id,
    tipo,
    idempotency_key,
    detalle
  ) values (
    v_command.id,
    v_command.usuario_id,
    'iniciada',
    v_claim_key,
    jsonb_build_object(
      'accion', v_command.accion,
      'request_id', v_command.request_id,
      'attempt', v_attempt,
      'source', 'worker_claim_v70'
    )
  )
  on conflict (command_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'idempotent', false,
    'code', null,
    'command_id', v_command.id,
    'estado', v_command.estado,
    'attempt_count', v_command.attempt_count,
    'max_attempts', v_command.max_attempts,
    'lease_token', v_command.lease_token,
    'lease_expires_at', v_command.lease_expires_at
  );
end;
$$;

create or replace function public.eos_renew_action_command_lease_v65(
  p_command_id uuid,
  p_lease_token uuid,
  p_attempt_count integer,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command public.eos_action_commands%rowtype;
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 900));
begin
  if p_command_id is null or p_lease_token is null or p_attempt_count is null then
    raise exception 'EOS_COMMAND_LEASE_ARGUMENTS_REQUIRED';
  end if;

  select c.* into v_command
  from public.eos_action_commands c
  where c.id = p_command_id
  for update;

  if not found then
    raise exception 'EOS_COMMAND_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.eos_autonomy_events_v12 e
    where e.command_id = v_command.id
      and e.usuario_id = v_command.usuario_id
      and e.event_type in ('auto_allowed', 'consumed')
  ) then
    raise exception 'EOS_COMMAND_NOT_AUTHORIZED';
  end if;

  if v_command.attempt_count <> p_attempt_count
     or v_command.lease_token is distinct from p_lease_token then
    raise exception 'EOS_COMMAND_STALE_ATTEMPT';
  end if;

  if v_command.estado <> 'ejecutando' then
    raise exception 'EOS_COMMAND_NOT_EXECUTING';
  end if;

  if v_command.lease_expires_at is null or v_command.lease_expires_at <= now() then
    raise exception 'EOS_COMMAND_LEASE_EXPIRED';
  end if;

  if not exists (
    select 1
    from public.eos_action_events e
    where e.command_id = v_command.id
      and e.usuario_id = v_command.usuario_id
      and e.idempotency_key = 'claim:' || p_attempt_count::text
  ) then
    raise exception 'EOS_COMMAND_ATTEMPT_NOT_CLAIMED';
  end if;

  update public.eos_action_commands c
  set lease_expires_at = now() + make_interval(secs => v_lease_seconds),
      updated_at = now()
  where c.id = v_command.id
  returning c.* into v_command;

  return jsonb_build_object(
    'ok', true,
    'command_id', v_command.id,
    'estado', v_command.estado,
    'attempt_count', v_command.attempt_count,
    'lease_token', v_command.lease_token,
    'lease_expires_at', v_command.lease_expires_at
  );
end;
$$;

create or replace function public.eos_finalize_action_command_v70(
  p_command_id uuid,
  p_lease_token uuid,
  p_attempt_count integer,
  p_estado text,
  p_resultado jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_error_message text default null
)
returns table(
  command_id uuid,
  estado text,
  idempotent boolean,
  resultado jsonb,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command public.eos_action_commands%rowtype;
  v_event_id bigint;
  v_estado text := lower(btrim(coalesce(p_estado, '')));
  v_resultado jsonb := coalesce(p_resultado, '{}'::jsonb);
  v_error_code text;
  v_error_message text;
begin
  if p_command_id is null or p_lease_token is null or p_attempt_count is null then
    raise exception 'EOS_ACTION_FINISH_ARGUMENTS_REQUIRED';
  end if;

  if v_estado not in ('completada', 'error', 'no_disponible', 'cancelada') then
    raise exception 'EOS_ACTION_INVALID_TERMINAL_STATE';
  end if;

  v_error_code := case
    when v_estado = 'error' then left(coalesce(nullif(btrim(p_error_code), ''), 'ACTION_EXECUTION_ERROR'), 160)
    when v_estado = 'no_disponible' then left(coalesce(nullif(btrim(p_error_code), ''), 'ACTION_NOT_AVAILABLE'), 160)
    else null
  end;

  v_error_message := case
    when v_estado = 'error' then left(coalesce(nullif(btrim(p_error_message), ''), 'La ejecución terminó con error.'), 500)
    when v_estado = 'no_disponible' then left(coalesce(nullif(btrim(p_error_message), ''), 'La acción todavía no está disponible.'), 500)
    else null
  end;

  select ac.* into v_command
  from public.eos_action_commands ac
  where ac.id = p_command_id
  for update;

  if not found then
    raise exception 'EOS_ACTION_COMMAND_NOT_FOUND';
  end if;

  if v_command.attempt_count <> p_attempt_count
     or v_command.lease_token is distinct from p_lease_token then
    raise exception 'EOS_ACTION_STALE_ATTEMPT';
  end if;

  if not exists (
    select 1
    from public.eos_autonomy_events_v12 e
    where e.command_id = v_command.id
      and e.usuario_id = v_command.usuario_id
      and e.event_type in ('auto_allowed', 'consumed')
  ) then
    raise exception 'EOS_ACTION_COMMAND_NOT_AUTHORIZED';
  end if;

  if not exists (
    select 1
    from public.eos_action_events e
    where e.command_id = v_command.id
      and e.usuario_id = v_command.usuario_id
      and e.idempotency_key = 'claim:' || p_attempt_count::text
  ) then
    raise exception 'EOS_ACTION_COMMAND_NOT_CLAIMED';
  end if;

  if v_command.estado in ('completada', 'error', 'no_disponible', 'cancelada') then
    if v_command.estado <> v_estado
      or coalesce(v_command.resultado, '{}'::jsonb) <> v_resultado
      or coalesce(v_command.error_code, '') <> coalesce(v_error_code, '')
      or coalesce(v_command.error_message, '') <> coalesce(v_error_message, '') then
      raise exception 'EOS_ACTION_TERMINAL_CONFLICT';
    end if;

    return query
    select v_command.id, v_command.estado, true,
           coalesce(v_command.resultado, '{}'::jsonb), v_command.completed_at;
    return;
  end if;

  if v_command.estado <> 'ejecutando' then
    raise exception 'EOS_ACTION_COMMAND_NOT_EXECUTABLE: %', v_command.estado;
  end if;

  if v_command.lease_expires_at is null or v_command.lease_expires_at <= now() then
    raise exception 'EOS_ACTION_LEASE_EXPIRED';
  end if;

  insert into public.eos_action_events (
    command_id,
    usuario_id,
    tipo,
    idempotency_key,
    detalle,
    error_code,
    error_message
  ) values (
    v_command.id,
    v_command.usuario_id,
    v_estado,
    'terminal:' || v_estado || ':' || p_attempt_count::text,
    v_resultado,
    v_error_code,
    v_error_message
  )
  on conflict (command_id, idempotency_key) do nothing
  returning id into v_event_id;

  if v_estado = 'error' then
    update public.eos_action_commands ac
    set resultado = v_resultado,
        updated_at = now()
    where ac.id = v_command.id;
  end if;

  select ac.* into v_command
  from public.eos_action_commands ac
  where ac.id = p_command_id;

  if v_command.estado <> v_estado
    or coalesce(v_command.resultado, '{}'::jsonb) <> v_resultado
    or coalesce(v_command.error_code, '') <> coalesce(v_error_code, '')
    or coalesce(v_command.error_message, '') <> coalesce(v_error_message, '') then
    raise exception 'EOS_ACTION_TERMINAL_EVENT_NOT_APPLIED';
  end if;

  return query
  select v_command.id, v_command.estado, v_event_id is null,
         coalesce(v_command.resultado, '{}'::jsonb), v_command.completed_at;
end;
$$;

revoke all on function public.eos_claim_action_command_v64(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.eos_renew_action_command_lease_v64(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.eos_finish_action_command_v64(uuid, integer, boolean, jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.eos_finish_action_command_v65(uuid, uuid, integer, boolean, jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.eos_finalize_action_command_v66(uuid, text, jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.eos_finalize_action_command_v68(uuid, integer, text, jsonb, text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.eos_claim_action_command_v65(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.eos_renew_action_command_lease_v65(uuid, uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.eos_finalize_action_command_v70(uuid, uuid, integer, text, jsonb, text, text)
  from public, anon, authenticated;

grant execute on function public.eos_claim_action_command_v65(uuid, integer) to service_role;
grant execute on function public.eos_renew_action_command_lease_v65(uuid, uuid, integer, integer) to service_role;
grant execute on function public.eos_finalize_action_command_v70(uuid, uuid, integer, text, jsonb, text, text) to service_role;

comment on function public.eos_claim_action_command_v65(uuid, integer) is
  'RC1 v70: service-only authorized claim with a unique fencing token and durable claim marker.';
comment on function public.eos_renew_action_command_lease_v65(uuid, uuid, integer, integer) is
  'RC1 v70: renews only a live authorized fenced lease; expired owners cannot resurrect themselves.';
comment on function public.eos_finalize_action_command_v70(uuid, uuid, integer, text, jsonb, text, text) is
  'RC1 v70: service-only terminal finalization fenced by lease_token + attempt, exact replay binding, authorization and a live lease.';

commit;
