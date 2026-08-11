begin;

create table if not exists public.eos_goal_commands (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  request_id uuid not null,
  accion text not null check (
    accion in (
      'CREAR_OBJETIVO',
      'ACTUALIZAR_PROGRESO',
      'REGISTRAR_EVIDENCIA',
      'COMPLETAR_HITO',
      'PAUSAR_OBJETIVO',
      'REANUDAR_OBJETIVO'
    )
  ),
  objetivo_id uuid references public.eos_goals(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  resultado jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'procesado', 'error')),
  error text,
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  mensaje_id uuid references public.mensajes(id) on delete set null,
  created_at timestamptz not null default now(),
  procesado_at timestamptz
);

create unique index if not exists eos_goal_commands_request_action_unique_idx
  on public.eos_goal_commands (usuario_id, request_id, accion);

create index if not exists eos_goal_commands_usuario_created_idx
  on public.eos_goal_commands (usuario_id, created_at desc);

create index if not exists eos_goal_commands_objetivo_idx
  on public.eos_goal_commands (objetivo_id)
  where objetivo_id is not null;

create index if not exists eos_goal_commands_conversacion_idx
  on public.eos_goal_commands (conversacion_id)
  where conversacion_id is not null;

create index if not exists eos_goal_commands_mensaje_idx
  on public.eos_goal_commands (mensaje_id)
  where mensaje_id is not null;

create or replace function public.eos_process_goal_command()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  datos jsonb := coalesce(new.payload, '{}'::jsonb);
  objetivo uuid := new.objetivo_id;
  objetivo_actual public.eos_goals%rowtype;
  hito jsonb;
  hito_clave text;
  hito_titulo text;
  progreso_nuevo integer;
  valor_nuevo numeric(18, 4);
  estado_nuevo text;
  tipo_nuevo text;
  prioridad_nueva smallint;
begin
  if new.estado <> 'pendiente' then
    return new;
  end if;

  if new.accion = 'CREAR_OBJETIVO' then
    tipo_nuevo := coalesce(nullif(datos ->> 'tipo_medicion', ''), 'porcentaje');
    if tipo_nuevo not in ('porcentaje', 'numerico', 'monetario', 'hitos') then
      tipo_nuevo := 'porcentaje';
    end if;

    prioridad_nueva := greatest(
      1,
      least(5, coalesce(nullif(datos ->> 'prioridad', '')::smallint, 3))
    );

    insert into public.eos_goals (
      usuario_id,
      titulo,
      descripcion,
      tipo_medicion,
      valor_inicial,
      valor_actual,
      valor_objetivo,
      unidad,
      prioridad,
      criterio_exito,
      proximo_paso,
      fecha_inicio,
      fecha_limite,
      request_id,
      conversacion_id,
      mensaje_id,
      progreso,
      progreso_confianza,
      estado,
      metadata
    ) values (
      new.usuario_id,
      left(coalesce(nullif(btrim(datos ->> 'titulo'), ''), 'Nuevo objetivo EOS'), 180),
      nullif(btrim(datos ->> 'descripcion'), ''),
      tipo_nuevo,
      nullif(datos ->> 'valor_inicial', '')::numeric,
      nullif(datos ->> 'valor_actual', '')::numeric,
      nullif(datos ->> 'valor_objetivo', '')::numeric,
      nullif(btrim(datos ->> 'unidad'), ''),
      prioridad_nueva,
      nullif(btrim(datos ->> 'criterio_exito'), ''),
      nullif(btrim(datos ->> 'proximo_paso'), ''),
      coalesce(nullif(datos ->> 'fecha_inicio', '')::date, current_date),
      nullif(datos ->> 'fecha_limite', '')::date,
      new.request_id,
      new.conversacion_id,
      new.mensaje_id,
      greatest(0, least(100, coalesce(nullif(datos ->> 'progreso', '')::integer, 0))),
      greatest(
        0,
        least(1, coalesce(nullif(datos ->> 'confianza', '')::numeric, 1))
      ),
      'activo',
      coalesce(datos -> 'metadata', '{}'::jsonb) || jsonb_build_object(
        'fuente', 'eos_automatico',
        'evidencia', coalesce(
          nullif(datos ->> 'evidencia', ''),
          'Objetivo creado desde una conversación con EOS.'
        ),
        'request_id', new.request_id
      )
    )
    returning id into objetivo;

    for hito in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(datos -> 'hitos') = 'array' then datos -> 'hitos'
          else '[]'::jsonb
        end
      )
    loop
      hito_titulo := nullif(btrim(hito ->> 'titulo'), '');
      if hito_titulo is null then
        continue;
      end if;

      hito_clave := nullif(btrim(hito ->> 'clave'), '');

      insert into public.eos_goal_milestones (
        objetivo_id,
        usuario_id,
        clave,
        titulo,
        descripcion,
        estado,
        peso,
        orden,
        fecha_limite,
        conversacion_id,
        mensaje_id,
        metadata
      ) values (
        objetivo,
        new.usuario_id,
        hito_clave,
        left(hito_titulo, 180),
        nullif(btrim(hito ->> 'descripcion'), ''),
        'pendiente',
        greatest(0.0001, coalesce(nullif(hito ->> 'peso', '')::numeric, 1)),
        coalesce(nullif(hito ->> 'orden', '')::smallint, 0),
        nullif(hito ->> 'fecha_limite', '')::date,
        new.conversacion_id,
        new.mensaje_id,
        jsonb_build_object('fuente', 'eos_automatico')
      )
      on conflict (objetivo_id, clave) where clave is not null
      do update set
        titulo = excluded.titulo,
        descripcion = excluded.descripcion,
        peso = excluded.peso,
        orden = excluded.orden,
        fecha_limite = excluded.fecha_limite,
        updated_at = now();
    end loop;
  else
    if objetivo is null then
      select g.id
      into objetivo
      from public.eos_goals as g
      where g.usuario_id = new.usuario_id
        and lower(g.titulo) = lower(nullif(btrim(datos ->> 'objetivo_titulo'), ''))
        and g.estado in ('activo', 'pausado')
      order by g.updated_at desc
      limit 1;
    end if;

    select g.*
    into objetivo_actual
    from public.eos_goals as g
    where g.id = objetivo
      and g.usuario_id = new.usuario_id
    for update;

    if objetivo_actual.id is null then
      raise exception 'No se encontró un objetivo propio para actualizar.';
    end if;

    progreso_nuevo := objetivo_actual.progreso;
    valor_nuevo := objetivo_actual.valor_actual;
    estado_nuevo := objetivo_actual.estado;
    tipo_nuevo := objetivo_actual.tipo_medicion;

    if nullif(datos ->> 'progreso', '') is not null then
      progreso_nuevo := greatest(
        0,
        least(100, round((datos ->> 'progreso')::numeric)::integer)
      );
    end if;

    if nullif(datos ->> 'valor_actual', '') is not null then
      if lower(coalesce(datos ->> 'modo_valor', 'absoluto')) = 'incremento' then
        valor_nuevo := coalesce(objetivo_actual.valor_actual, 0)
          + (datos ->> 'valor_actual')::numeric;
      else
        valor_nuevo := (datos ->> 'valor_actual')::numeric;
      end if;
    end if;

    if nullif(datos ->> 'tipo_medicion', '') in (
      'porcentaje', 'numerico', 'monetario', 'hitos'
    ) then
      tipo_nuevo := datos ->> 'tipo_medicion';
    end if;

    if new.accion = 'PAUSAR_OBJETIVO' then
      estado_nuevo := 'pausado';
    elsif new.accion = 'REANUDAR_OBJETIVO' then
      estado_nuevo := 'activo';
    elsif nullif(datos ->> 'estado', '') in (
      'borrador', 'activo', 'pausado', 'completado', 'cancelado'
    ) then
      estado_nuevo := datos ->> 'estado';
    end if;

    update public.eos_goals
    set progreso = progreso_nuevo,
        valor_actual = valor_nuevo,
        valor_objetivo = coalesce(
          nullif(datos ->> 'valor_objetivo', '')::numeric,
          objetivo_actual.valor_objetivo
        ),
        valor_inicial = coalesce(
          nullif(datos ->> 'valor_inicial', '')::numeric,
          objetivo_actual.valor_inicial
        ),
        unidad = coalesce(nullif(btrim(datos ->> 'unidad'), ''), objetivo_actual.unidad),
        tipo_medicion = tipo_nuevo,
        estado = estado_nuevo,
        proximo_paso = coalesce(
          nullif(btrim(datos ->> 'proximo_paso'), ''),
          objetivo_actual.proximo_paso
        ),
        criterio_exito = coalesce(
          nullif(btrim(datos ->> 'criterio_exito'), ''),
          objetivo_actual.criterio_exito
        ),
        fecha_limite = coalesce(
          nullif(datos ->> 'fecha_limite', '')::date,
          objetivo_actual.fecha_limite
        ),
        request_id = new.request_id,
        conversacion_id = coalesce(new.conversacion_id, objetivo_actual.conversacion_id),
        mensaje_id = coalesce(new.mensaje_id, objetivo_actual.mensaje_id),
        progreso_confianza = greatest(
          0,
          least(1, coalesce(
            nullif(datos ->> 'confianza', '')::numeric,
            objetivo_actual.progreso_confianza
          ))
        ),
        metadata = coalesce(objetivo_actual.metadata, '{}'::jsonb)
          || coalesce(datos -> 'metadata', '{}'::jsonb)
          || jsonb_build_object(
            'fuente', 'eos_automatico',
            'evidencia', coalesce(
              nullif(datos ->> 'evidencia', ''),
              'EOS registró una actualización del objetivo.'
            ),
            'request_id', new.request_id,
            'accion', new.accion
          )
    where id = objetivo;

    if new.accion = 'COMPLETAR_HITO' then
      hito_clave := nullif(btrim(datos ->> 'hito_clave'), '');
      hito_titulo := nullif(btrim(datos ->> 'hito_titulo'), '');

      update public.eos_goal_milestones
      set estado = 'completado',
          conversacion_id = coalesce(new.conversacion_id, conversacion_id),
          mensaje_id = coalesce(new.mensaje_id, mensaje_id),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'fuente', 'eos_automatico',
            'evidencia', coalesce(
              nullif(datos ->> 'evidencia', ''),
              'Hito completado desde una conversación con EOS.'
            )
          )
      where objetivo_id = objetivo
        and usuario_id = new.usuario_id
        and (
          (hito_clave is not null and clave = hito_clave)
          or (hito_clave is null and hito_titulo is not null and lower(titulo) = lower(hito_titulo))
        );

      if not found and hito_titulo is not null then
        insert into public.eos_goal_milestones (
          objetivo_id,
          usuario_id,
          clave,
          titulo,
          estado,
          conversacion_id,
          mensaje_id,
          metadata
        ) values (
          objetivo,
          new.usuario_id,
          hito_clave,
          left(hito_titulo, 180),
          'completado',
          new.conversacion_id,
          new.mensaje_id,
          jsonb_build_object(
            'fuente', 'eos_automatico',
            'evidencia', coalesce(
              nullif(datos ->> 'evidencia', ''),
              'Hito completado desde una conversación con EOS.'
            )
          )
        );
      end if;
    end if;
  end if;

  update public.eos_goal_commands
  set objetivo_id = objetivo,
      estado = 'procesado',
      resultado = jsonb_build_object(
        'objetivo_id', objetivo,
        'accion', new.accion
      ),
      procesado_at = now(),
      error = null
  where id = new.id;

  return new;
exception
  when others then
    update public.eos_goal_commands
    set estado = 'error',
        error = left(sqlerrm, 500),
        procesado_at = now()
    where id = new.id;

    return new;
end;
$$;

drop trigger if exists eos_goal_command_process_after_insert
on public.eos_goal_commands;
create trigger eos_goal_command_process_after_insert
after insert on public.eos_goal_commands
for each row execute function public.eos_process_goal_command();

revoke all on function public.eos_process_goal_command() from public, anon, authenticated;
grant execute on function public.eos_process_goal_command() to service_role;

alter table public.eos_goal_commands enable row level security;

revoke all on table public.eos_goal_commands from anon, authenticated;
grant all on table public.eos_goal_commands to service_role;

comment on table public.eos_goal_commands is
  'Buzón idempotente de comandos de objetivos procesados por EOS en segundo plano.';

commit;
