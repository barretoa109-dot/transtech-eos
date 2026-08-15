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
  v_claim_key text;
  v_claim_recorded boolean := false;
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

  v_claim_key := 'claim:' || v_command.attempt_count::text;

  select exists (
    select 1
    from public.eos_action_events e
    where e.command_id = v_command.id
      and e.idempotency_key = v_claim_key
  ) into v_claim_recorded;

  -- Fase 4 crea automáticamente el evento start:1 y mueve una orden nueva a
  -- ejecutando antes de que un Worker la reclame. Ese lease inicial no equivale
  -- a propiedad de ejecución. El primer claim durable se identifica con
  -- claim:<attempt_count>.
  if v_command.estado = 'ejecutando'
     and v_command.lease_expires_at is not null
     and v_command.lease_expires_at > now()
     and v_claim_recorded then
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

  if v_command.estado = 'ejecutando'
     and v_command.lease_expires_at is not null
     and v_command.lease_expires_at > now()
     and not v_claim_recorded then
    update public.eos_action_commands c
    set lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        updated_at = now()
    where c.id = v_command.id
    returning c.* into v_command;

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
        'attempt', v_command.attempt_count,
        'source', 'worker_claim_v67'
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

  v_claim_key := 'claim:' || v_command.attempt_count::text;

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
      'attempt', v_command.attempt_count,
      'source', 'worker_claim_v67'
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
    'lease_expires_at', v_command.lease_expires_at
  );
end;
$$;

revoke all on function public.eos_claim_action_command_v64(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.eos_claim_action_command_v64(uuid, integer)
  to service_role;

comment on function public.eos_claim_action_command_v64(uuid, integer) is
  'RC1 v67 compatibility fix: distinguishes the Fase 4 automatic start lease from a durable Worker claim using claim:<attempt> fencing events.';

commit;
