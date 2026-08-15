begin;

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
        left(
          coalesce(
            nullif(btrim(v_data ->> 'titulo'), ''),
            nullif(left(v_message, 180), ''),
            'Nueva tarea EOS'
          ),
          180
        ),
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
        select t.id
        into v_effect_id
        from public.eos_tasks t
        where t.action_command_id = v_command.id
        limit 1;

        v_idempotent := true;
      end if;
    end if;

  elsif v_command.accion = 'GUARDAR_MEMORIA' then
    v_effect_type := 'memory';

    select m.id
    into v_effect_id
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
        left(
          coalesce(
            nullif(btrim(v_data ->> 'titulo'), ''),
            'Dato importante'
          ),
          180
        ),
        left(coalesce(nullif(btrim(v_data ->> 'categoria'), ''), 'general'), 80),
        coalesce(
          nullif(btrim(v_data ->> 'contenido'), ''),
          nullif(btrim(v_data ->> 'texto'), ''),
          nullif(btrim(v_data ->> 'descripcion'), ''),
          v_message
        ),
        case
          when coalesce(v_data ->> 'importancia', '') ~ '^\d+$'
            then greatest(1, least(10, (v_data ->> 'importancia')::integer))
          else 5
        end,
        'eos-worker-gated',
        'activo',
        jsonb_build_object(
          'fuente', 'worker_gate',
          'request_id', v_command.request_id,
          'action_command_id', v_command.id
        ),
        v_command.id
      )
      on conflict (action_command_id) where action_command_id is not null
      do nothing
      returning id into v_effect_id;

      if v_effect_id is null then
        select m.id
        into v_effect_id
        from public.eos_memory m
        where m.action_command_id = v_command.id
        limit 1;

        v_idempotent := true;
      end if;
    end if;

  elsif v_command.accion = 'CREAR_OBJETIVO' then
    v_effect_type := 'goal';

    select gc.*
    into v_goal_command
    from public.eos_goal_commands gc
    where gc.action_command_id = v_command.id
    limit 1;

    if v_goal_command.id is not null then
      v_idempotent := true;
    else
      v_goal_payload := v_data || jsonb_build_object(
        'titulo', coalesce(
          nullif(btrim(v_data ->> 'titulo'), ''),
          nullif(left(v_message, 180), ''),
          'Nuevo objetivo EOS'
        ),
        'descripcion', coalesce(
          nullif(btrim(v_data ->> 'descripcion'), ''),
          v_message
        )
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

      select gc.*
      into v_goal_command
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
    'executor_version', 'v64'
  );

  update public.eos_action_commands
  set estado = 'completada',
      resultado = v_result,
      completed_at = coalesce(completed_at, now()),
      lease_expires_at = null,
      error_code = null,
      error_message = null,
      updated_at = now()
  where id = v_command.id;

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
  'RC1 v64: ejecuta de forma atómica e idempotente efectos internos autorizados (tarea, memoria, objetivo) usando únicamente el payload canónico ligado a action_command_id.';

commit;
