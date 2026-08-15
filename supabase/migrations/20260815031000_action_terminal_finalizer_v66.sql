begin;

create or replace function public.eos_finalize_action_command_v66(
  p_command_id uuid,
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
begin
  if p_command_id is null then
    raise exception 'command_id es obligatorio.';
  end if;

  if v_estado not in ('completada', 'error', 'no_disponible', 'cancelada') then
    raise exception 'EOS_ACTION_INVALID_TERMINAL_STATE';
  end if;

  if v_estado = 'error' and nullif(btrim(coalesce(p_error_message, '')), '') is null then
    raise exception 'EOS_ACTION_ERROR_MESSAGE_REQUIRED';
  end if;

  select *
  into v_command
  from public.eos_action_commands
  where id = p_command_id
  for update;

  if v_command.id is null then
    raise exception 'EOS_ACTION_COMMAND_NOT_FOUND';
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

  if v_command.estado in ('completada', 'error', 'no_disponible', 'cancelada') then
    if v_command.estado <> v_estado then
      raise exception 'EOS_ACTION_TERMINAL_CONFLICT';
    end if;

    return query
    select
      v_command.id,
      v_command.estado,
      true,
      coalesce(v_command.resultado, '{}'::jsonb),
      v_command.completed_at;
    return;
  end if;

  if v_command.estado not in ('recibida', 'ejecutando') then
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
    'terminal:' || v_estado || ':1',
    v_resultado,
    case
      when v_estado in ('error', 'no_disponible')
        then coalesce(nullif(btrim(p_error_code), ''),
          case when v_estado = 'error' then 'ACTION_EXECUTION_ERROR' else 'ACTION_NOT_AVAILABLE' end)
      else null
    end,
    case
      when v_estado = 'error'
        then left(btrim(p_error_message), 500)
      when v_estado = 'no_disponible'
        then left(coalesce(nullif(btrim(p_error_message), ''), 'La acción todavía no está disponible.'), 500)
      else null
    end
  )
  on conflict (command_id, idempotency_key) do nothing
  returning id into v_event_id;

  select *
  into v_command
  from public.eos_action_commands
  where id = p_command_id;

  if v_command.estado <> v_estado then
    raise exception 'EOS_ACTION_TERMINAL_EVENT_NOT_APPLIED';
  end if;

  return query
  select
    v_command.id,
    v_command.estado,
    v_event_id is null,
    coalesce(v_command.resultado, '{}'::jsonb),
    v_command.completed_at;
end;
$$;

revoke all on function public.eos_finalize_action_command_v66(uuid, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_finalize_action_command_v66(uuid, text, jsonb, text, text)
  to service_role;

comment on function public.eos_finalize_action_command_v66(uuid, text, jsonb, text, text) is
  'RC1 v66: cierre terminal atómico e idempotente de commands autorizados mediante eos_action_events; rechaza estados terminales incompatibles.';

-- Upgrade the v64 executor so its terminal state is also recorded through the
-- immutable Fase 4 event ledger instead of updating the command directly.
create or replace function public.eos_execute_internal_effect_v64(
  p_command_id uuid
)
returns table(
  command_id uuid,
  accion text,
  effect_type text,
  effect_id uuid,
  idempotent boolean,
  estado text,
  resultado jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command public.eos_action_commands%rowtype;
  v_data jsonb := '{}'::jsonb;
  v_message text;
  v_effect_type text;
  v_effect_id uuid;
  v_idempotent boolean := false;
  v_priority integer := 3;
  v_goal_payload jsonb := '{}'::jsonb;
  v_goal_command public.eos_goal_commands%rowtype;
  v_result jsonb := '{}'::jsonb;
begin
  if p_command_id is null then
    raise exception 'command_id es obligatorio.';
  end if;

  select *
  into v_command
  from public.eos_action_commands
  where id = p_command_id
  for update;

  if v_command.id is null then
    raise exception 'EOS_INTERNAL_EFFECT_COMMAND_NOT_FOUND';
  end if;

  if v_command.accion not in ('CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA') then
    raise exception 'EOS_INTERNAL_EFFECT_UNSUPPORTED_ACTION';
  end if;

  if v_command.estado not in ('recibida', 'ejecutando', 'completada') then
    raise exception 'EOS_INTERNAL_EFFECT_COMMAND_NOT_EXECUTABLE: %', v_command.estado;
  end if;

  if not exists (
    select 1
    from public.eos_autonomy_events_v12 e
    where e.command_id = v_command.id
      and e.usuario_id = v_command.usuario_id
      and e.event_type in ('auto_allowed', 'consumed')
  ) then
    raise exception 'EOS_INTERNAL_EFFECT_NOT_AUTHORIZED';
  end if;

  v_data := case
    when jsonb_typeof(v_command.payload -> 'datos') = 'object'
      then v_command.payload -> 'datos'
    else coalesce(v_command.payload, '{}'::jsonb)
  end;

  v_message := nullif(btrim(coalesce(v_command.payload ->> 'mensaje', '')), '');

  if v_command.estado <> 'completada' then
    update public.eos_action_commands
    set estado = 'ejecutando',
        started_at = coalesce(started_at, now()),
        lease_expires_at = now() + interval '5 minutes',
        updated_at = now()
    where id = v_command.id;
  end if;

  if v_command.accion = 'CREAR_TAREA' then
    v_effect_type := 'task';

    select t.id
    into v_effect_id
    from public.eos_tasks t
    where t.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      if coalesce(v_data ->> 'prioridad', '') ~ '^[1-5]$' then
        v_priority := (v_data ->> 'prioridad')::integer;
      else
        v_priority := 3;
      end if;

      insert into public.eos_tasks (
        usuario_id,
        titulo,
        descripcion,
        estado,
        prioridad,
        fecha_limite,
        action_command_id
      ) values (
        v_command.usuario_id,
        left(coalesce(nullif(btrim(v_data ->> 'titulo'), ''), nullif(left(v_message, 180), ''), 'Nueva tarea EOS'), 180),
        coalesce(nullif(btrim(v_data ->> 'descripcion'), ''), v_message),
        'pendiente',
        v_priority,
        case
          when coalesce(v_data ->> 'fecha_limite', '') ~ '^\d{4}-\d{2}-\d{2}'
            then (v_data ->> 'fecha_limite')::timestamptz
          else null
        end,
        v_command.id
      )
      on conflict (action_command_id) where action_command_id is not null
      do nothing
      returning id into v_effect_id;

      if v_effect_id is null then
        select t.id into v_effect_id
        from public.eos_tasks t
        where t.action_command_id = v_command.id
        limit 1;
        v_idempotent := true;
      end if;
    end if;

  elsif v_command.accion = 'GUARDAR_MEMORIA' then
    v_effect_type := 'memory';

    select m.id into v_effect_id
    from public.eos_memory m
    where m.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      insert into public.eos_memory (
        usuario_id,
        conversacion_id,
        mensaje_id,
        titulo,
        categoria,
        contenido,
        importancia,
        origen,
        estado,
        metadata,
        action_command_id
      ) values (
        v_command.usuario_id,
        v_command.conversacion_id,
        v_command.mensaje_id,
        left(coalesce(nullif(btrim(v_data ->> 'titulo'), ''), 'Dato importante'), 180),
        left(coalesce(nullif(btrim(v_data ->> 'categoria'), ''), 'general'), 80),
        coalesce(nullif(btrim(v_data ->> 'contenido'), ''), nullif(btrim(v_data ->> 'texto'), ''), nullif(btrim(v_data ->> 'descripcion'), ''), v_message),
        case
          when coalesce(v_data ->> 'importancia', '') ~ '^\d+$'
            then greatest(1, least(10, (v_data ->> 'importancia')::integer))
          else 5
        end,
        'eos-worker-gated',
        'activo',
        jsonb_build_object('fuente', 'worker_gate', 'request_id', v_command.request_id, 'action_command_id', v_command.id),
        v_command.id
      )
      on conflict (action_command_id) where action_command_id is not null
      do nothing
      returning id into v_effect_id;

      if v_effect_id is null then
        select m.id into v_effect_id
        from public.eos_memory m
        where m.action_command_id = v_command.id
        limit 1;
        v_idempotent := true;
      end if;
    end if;

  elsif v_command.accion = 'CREAR_OBJETIVO' then
    v_effect_type := 'goal';

    select gc.* into v_goal_command
    from public.eos_goal_commands gc
    where gc.action_command_id = v_command.id
    limit 1;

    if v_goal_command.id is not null then
      v_idempotent := true;
    else
      v_goal_payload := v_data || jsonb_build_object(
        'titulo', coalesce(nullif(btrim(v_data ->> 'titulo'), ''), nullif(left(v_message, 180), ''), 'Nuevo objetivo EOS'),
        'descripcion', coalesce(nullif(btrim(v_data ->> 'descripcion'), ''), v_message)
      );

      insert into public.eos_goal_commands (
        usuario_id,
        request_id,
        accion,
        payload,
        conversacion_id,
        mensaje_id,
        action_command_id
      ) values (
        v_command.usuario_id,
        v_command.request_id,
        'CREAR_OBJETIVO',
        v_goal_payload,
        v_command.conversacion_id,
        v_command.mensaje_id,
        v_command.id
      )
      on conflict (action_command_id) where action_command_id is not null
      do nothing;

      select gc.* into v_goal_command
      from public.eos_goal_commands gc
      where gc.action_command_id = v_command.id
      limit 1;
    end if;

    if v_goal_command.id is null then
      raise exception 'EOS_INTERNAL_EFFECT_GOAL_COMMAND_MISSING';
    end if;

    if v_goal_command.estado = 'error' then
      raise exception 'EOS_INTERNAL_EFFECT_GOAL_FAILED: %', coalesce(v_goal_command.error, 'unknown');
    end if;

    v_effect_id := v_goal_command.objetivo_id;
    if v_effect_id is null then
      raise exception 'EOS_INTERNAL_EFFECT_GOAL_ID_MISSING';
    end if;
  end if;

  if v_effect_id is null then
    raise exception 'EOS_INTERNAL_EFFECT_ID_MISSING';
  end if;

  v_result := coalesce(v_command.resultado, '{}'::jsonb) || jsonb_build_object(
    'effect_type', v_effect_type,
    'effect_id', v_effect_id,
    'idempotent', v_idempotent,
    'executor_version', 'v66'
  );

  perform *
  from public.eos_finalize_action_command_v66(
    v_command.id,
    'completada',
    v_result,
    null,
    null
  );

  return query
  select
    v_command.id,
    v_command.accion,
    v_effect_type,
    v_effect_id,
    v_idempotent,
    'completada'::text,
    v_result;
end;
$$;

revoke all on function public.eos_execute_internal_effect_v64(uuid)
  from public, anon, authenticated;
grant execute on function public.eos_execute_internal_effect_v64(uuid)
  to service_role;

comment on function public.eos_execute_internal_effect_v64(uuid) is
  'RC1 v66 upgrade: efecto interno idempotente ligado a action_command_id y cierre terminal auditado mediante eos_action_events.';

commit;
