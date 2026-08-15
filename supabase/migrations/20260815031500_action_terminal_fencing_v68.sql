begin;

create or replace function public.eos_finalize_action_command_v68(
  p_command_id uuid,
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
  v_claim_key text;
begin
  if p_command_id is null or p_attempt_count is null then
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

  select * into v_command
  from public.eos_action_commands ac
  where ac.id = p_command_id
  for update;

  if v_command.id is null then
    raise exception 'EOS_ACTION_COMMAND_NOT_FOUND';
  end if;

  if v_command.attempt_count <> p_attempt_count then
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

  v_claim_key := 'claim:' || p_attempt_count::text;
  if not exists (
    select 1
    from public.eos_action_events e
    where e.command_id = v_command.id
      and e.usuario_id = v_command.usuario_id
      and e.idempotency_key = v_claim_key
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

  select * into v_command
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

revoke all on function public.eos_finalize_action_command_v68(uuid, integer, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_finalize_action_command_v68(uuid, integer, text, jsonb, text, text)
  to service_role;

comment on function public.eos_finalize_action_command_v68(uuid, integer, text, jsonb, text, text) is
  'RC1 v68: terminal action result is fenced to the claimed attempt; stale workers and incompatible terminal replays are rejected.';

commit;
