-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

create or replace function public.eos_claim_action_command_v64(
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
begin
  if p_command_id is null then
    raise exception 'EOS_COMMAND_ID_REQUIRED';
  end if;

  select c.*
    into v_command
  from public.eos_action_commands c
  where c.id = p_command_id
  for update;

  if not found then
    raise exception 'EOS_COMMAND_NOT_FOUND';
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
    when v_command.estado = 'recibida' and v_command.started_at is null
      then v_command.attempt_count
    else v_command.attempt_count + 1
  end;

  if v_attempt > v_command.max_attempts then
    update public.eos_action_commands c
    set estado = 'error',
        lease_expires_at = null,
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

  update public.eos_action_commands c
  set estado = 'ejecutando',
      attempt_count = v_attempt,
      started_at = coalesce(c.started_at, now()),
      lease_expires_at = now() + make_interval(secs => v_lease_seconds),
      completed_at = null,
      error_code = null,
      error_message = null,
      updated_at = now()
  where c.id = v_command.id
  returning c.* into v_command;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'idempotent', false,
    'code', null,
    'command_id', v_command.id,
    'estado', v_command.estado,
    'attempt_count', v_command.attempt_count,
    'max_attempts', v_command.max_attempts,
    'lease_expires_at', v_command.lease_expires_at
  );
end;
$$;

create or replace function public.eos_renew_action_command_lease_v64(
  p_command_id uuid,
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
  if p_command_id is null or p_attempt_count is null then
    raise exception 'EOS_COMMAND_LEASE_ARGUMENTS_REQUIRED';
  end if;

  select c.*
    into v_command
  from public.eos_action_commands c
  where c.id = p_command_id
  for update;

  if not found then
    raise exception 'EOS_COMMAND_NOT_FOUND';
  end if;

  if v_command.attempt_count <> p_attempt_count then
    raise exception 'EOS_COMMAND_STALE_ATTEMPT';
  end if;

  if v_command.estado <> 'ejecutando' then
    raise exception 'EOS_COMMAND_NOT_EXECUTING';
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
    'lease_expires_at', v_command.lease_expires_at
  );
end;
$$;

create or replace function public.eos_finish_action_command_v64(
  p_command_id uuid,
  p_attempt_count integer,
  p_success boolean,
  p_result jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command public.eos_action_commands%rowtype;
  v_result jsonb := coalesce(p_result, '{}'::jsonb);
  v_error_code text := left(coalesce(nullif(btrim(p_error_code), ''), 'EOS_COMMAND_EFFECT_FAILED'), 160);
  v_error_message text := left(coalesce(nullif(btrim(p_error_message), ''), 'La ejecución de la orden falló.'), 2000);
begin
  if p_command_id is null or p_attempt_count is null or p_success is null then
    raise exception 'EOS_COMMAND_FINISH_ARGUMENTS_REQUIRED';
  end if;

  select c.*
    into v_command
  from public.eos_action_commands c
  where c.id = p_command_id
  for update;

  if not found then
    raise exception 'EOS_COMMAND_NOT_FOUND';
  end if;

  if v_command.attempt_count <> p_attempt_count then
    raise exception 'EOS_COMMAND_STALE_ATTEMPT';
  end if;

  if v_command.estado = 'completada' then
    if p_success is not true or v_command.resultado <> v_result then
      raise exception 'EOS_COMMAND_RESULT_MISMATCH';
    end if;

    return jsonb_build_object(
      'ok', true,
      'estado', v_command.estado,
      'idempotent', true,
      'command_id', v_command.id,
      'attempt_count', v_command.attempt_count,
      'resultado', v_command.resultado
    );
  end if;

  if v_command.estado = 'error' then
    if p_success is true
       or coalesce(v_command.error_code, '') <> v_error_code
       or coalesce(v_command.error_message, '') <> v_error_message
       or v_command.resultado <> v_result then
      raise exception 'EOS_COMMAND_RESULT_MISMATCH';
    end if;

    return jsonb_build_object(
      'ok', false,
      'estado', v_command.estado,
      'idempotent', true,
      'command_id', v_command.id,
      'attempt_count', v_command.attempt_count,
      'error_code', v_command.error_code,
      'error_message', v_command.error_message,
      'resultado', v_command.resultado
    );
  end if;

  if v_command.estado <> 'ejecutando' then
    raise exception 'EOS_COMMAND_NOT_EXECUTING';
  end if;

  if p_success then
    update public.eos_action_commands c
    set estado = 'completada',
        resultado = v_result,
        completed_at = now(),
        lease_expires_at = null,
        error_code = null,
        error_message = null,
        updated_at = now()
    where c.id = v_command.id
    returning c.* into v_command;

    return jsonb_build_object(
      'ok', true,
      'estado', v_command.estado,
      'idempotent', false,
      'command_id', v_command.id,
      'attempt_count', v_command.attempt_count,
      'resultado', v_command.resultado
    );
  end if;

  update public.eos_action_commands c
  set estado = 'error',
      resultado = v_result,
      lease_expires_at = null,
      completed_at = null,
      error_code = v_error_code,
      error_message = v_error_message,
      updated_at = now()
  where c.id = v_command.id
  returning c.* into v_command;

  return jsonb_build_object(
    'ok', false,
    'estado', v_command.estado,
    'idempotent', false,
    'command_id', v_command.id,
    'attempt_count', v_command.attempt_count,
    'error_code', v_command.error_code,
    'error_message', v_command.error_message,
    'resultado', v_command.resultado
  );
end;
$$;

revoke all on function public.eos_claim_action_command_v64(uuid, integer) from public, anon, authenticated;
revoke all on function public.eos_renew_action_command_lease_v64(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.eos_finish_action_command_v64(uuid, integer, boolean, jsonb, text, text) from public, anon, authenticated;

grant execute on function public.eos_claim_action_command_v64(uuid, integer) to service_role;
grant execute on function public.eos_renew_action_command_lease_v64(uuid, integer, integer) to service_role;
grant execute on function public.eos_finish_action_command_v64(uuid, integer, boolean, jsonb, text, text) to service_role;

comment on function public.eos_claim_action_command_v64(uuid, integer) is
  'RC1 v64: atomic lease/fencing claim for one EOS action command. Concurrent/replayed workers cannot both own the same active attempt.';
comment on function public.eos_renew_action_command_lease_v64(uuid, integer, integer) is
  'RC1 v64: renews a command lease only for the current fenced attempt.';
comment on function public.eos_finish_action_command_v64(uuid, integer, boolean, jsonb, text, text) is
  'RC1 v64: finishes one fenced command attempt and rejects stale or incompatible replays.';

commit;
