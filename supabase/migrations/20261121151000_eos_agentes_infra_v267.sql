-- v267: la infraestructura común del equipo de agentes.
--
-- Plan aprobado el 27/11/2026: docs/agentes/plan-equipo-agentes-2026-11-27.md.
--
-- ============================================================
-- QUÉ GARANTIZA, Y DÓNDE
-- ============================================================
--
-- 1) Ningún agente escribe en planes, módulos, pagos ni movimientos.
--    Cada agente entra a la base con SU rol (`agente_<nombre>`), sin la
--    service role. Esos roles no tienen un solo permiso sobre tablas de
--    `public`, y solo pueden ejecutar las funciones de este archivo. La
--    sección 6 cierra lo único que les quedaba abierto por defecto: las
--    funciones SECURITY DEFINER viejas que todavía tenían EXECUTE para PUBLIC.
--
-- 2) Apagado no manda nada. El interruptor (`agent_config.activo`) se mira al
--    empezar la corrida Y en `autorizar_envio`, que es la única puerta para
--    mandar un mensaje. Una corrida que ya estaba andando cuando se apagó el
--    agente tampoco manda.
--
-- 3) Nadie supera el tope semanal. `autorizar_envio` cuenta los mensajes de la
--    persona en los últimos siete días, de TODOS los agentes, con un candado
--    por persona para que dos agentes a la vez no pasen los dos.
--
-- 4) Ningún prompt sin aprobar llega a producción. El código manda la versión
--    de sus archivos (un hash); si no es la que aprobó el dueño, la corrida no
--    arranca y se escala. Solo el dueño (service role, desde /admin/agentes o
--    `npm run agentes`) escribe `agent_config`.
--
-- 5) Todo queda anotado: cada corrida en `agent_runs` con su costo y cada
--    mensaje en `agent_messages` con su estado de entrega.
--
-- Los roles nacen SIN login. La contraseña de cada uno no va en este repo
-- (es público): la carga el dueño con `npm run agentes -- clave <agente>`.
--
-- ============================================================
-- ROLLBACK
-- ============================================================
--
--   drop schema agentes cascade;
--   drop function public.eos_agentes_panel_v267(), public.eos_agentes_cambiar_v267(text, boolean, text),
--     public.eos_agentes_aprobar_v267(text, text, text), public.eos_agentes_tope_v267(integer, text),
--     public.eos_agentes_resolver_v267(uuid, text, text), public.eos_agentes_emitir_v267(text, text, uuid, text, jsonb),
--     public.eos_agentes_por_avisar_v267(boolean), public.eos_agentes_avisados_v267(uuid[], boolean);
--   drop role agente_reportes, agente_cobranza, agente_activacion, agente_soporte,
--     agente_retencion, agente_contenido, agentes_base;
--   La sección 6 no se deshace: devolverle EXECUTE a PUBLIC sobre funciones
--   SECURITY DEFINER es justo lo que no se quiere.

-- ============================================================
-- 1) Roles
-- ============================================================

do $$
declare
  v_rol text;
begin
  if not exists (select 1 from pg_roles where rolname = 'agentes_base') then
    create role agentes_base nologin noinherit;
  end if;

  foreach v_rol in array array[
    'agente_reportes', 'agente_cobranza', 'agente_activacion',
    'agente_soporte', 'agente_retencion', 'agente_contenido'
  ] loop
    if not exists (select 1 from pg_roles where rolname = v_rol) then
      execute format('create role %I nologin inherit nobypassrls nocreatedb nocreaterole', v_rol);
    end if;
    execute format('grant agentes_base to %I', v_rol);
  end loop;
end;
$$;

-- ============================================================
-- 2) Tablas
-- ============================================================

create schema if not exists agentes;
revoke all on schema agentes from public;
grant usage on schema agentes to agentes_base, service_role;

create table agentes.ajustes (
  id boolean primary key default true check (id),
  tope_semanal integer not null default 4 check (tope_semanal between 0 and 50),
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);
insert into agentes.ajustes (id) values (true);

create table agentes.agent_config (
  agente text primary key check (agente ~ '^[a-z]+$'),
  activo boolean not null default false,
  -- Topes propios: { "mensajes_por_corrida": 200, "gasto_usd_mes": 5 }.
  limites jsonb not null default '{}'::jsonb,
  -- Los tipos de evento que este agente toma de la cola.
  eventos text[] not null default '{}',
  version_reglas text,
  version_prompt text,
  -- La versión que aprobó el dueño. Mientras sea null, el agente no arranca.
  version_aprobada text,
  aprobado_por text,
  aprobado_en timestamptz,
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);

insert into agentes.agent_config (agente, limites, eventos) values
  ('reportes',   '{"mensajes_por_corrida": 5}',   '{}'),
  ('cobranza',   '{"mensajes_por_corrida": 200}', '{vencimiento_sin_pago,cobro_rechazado,pago_acreditado}'),
  ('activacion', '{"mensajes_por_corrida": 200}', '{alta,primer_registro,primera_alerta,fin_prueba}'),
  ('soporte',    '{"mensajes_por_corrida": 100, "gasto_usd_mes": 10}', '{mensaje_soporte}'),
  ('retencion',  '{"mensajes_por_corrida": 200, "gasto_usd_mes": 5}',  '{pedido_baja}'),
  ('contenido',  '{"mensajes_por_corrida": 5, "gasto_usd_mes": 10}',   '{}');

create table agentes.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agente text not null references agentes.agent_config (agente),
  disparador text not null check (disparador in ('cron', 'evento', 'manual')),
  evento_id uuid,
  usuario_id uuid,
  -- Resumido: contadores e ids, nunca movimientos ni textos de la persona.
  entrada_resumen jsonb not null default '{}'::jsonb,
  salida jsonb,
  version text,
  modelo text,
  tokens_entrada integer not null default 0,
  tokens_salida integer not null default 0,
  tokens_cache integer not null default 0,
  costo_usd numeric(12, 6) not null default 0,
  duracion_ms integer,
  error text,
  creado_en timestamptz not null default now(),
  terminado_en timestamptz
);
create index agent_runs_agente_fecha on agentes.agent_runs (agente, creado_en desc);

create table agentes.agent_messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agentes.agent_runs (id),
  agente text not null references agentes.agent_config (agente),
  usuario_id uuid not null,
  canal text not null check (canal in ('email', 'whatsapp', 'push', 'app')),
  -- La plantilla o el prompt, con su versión: "cobranza/dia3@a1b2c3".
  plantilla text not null,
  estado text not null check (estado in (
    'autorizado', 'enviado', 'entregado', 'fallado', 'bloqueado_tope', 'bloqueado_apagado'
  )),
  -- Solo Soporte puede contestar fuera del tope, y solo a quien preguntó.
  cuenta_tope boolean not null default true,
  proveedor_id text,
  detalle text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index agent_messages_usuario_fecha on agentes.agent_messages (usuario_id, creado_en desc);

create table agentes.escalations (
  id uuid primary key default gen_random_uuid(),
  agente text not null references agentes.agent_config (agente),
  run_id uuid references agentes.agent_runs (id),
  usuario_id uuid,
  motivo text not null check (length(motivo) between 3 and 300),
  prioridad text not null check (prioridad in ('urgente', 'normal')),
  contexto jsonb not null default '{}'::jsonb,
  estado text not null default 'abierto' check (estado in ('abierto', 'resuelto')),
  respuesta text,
  resuelto_por text,
  resuelto_en timestamptz,
  -- Cuándo le llegó al dueño: al momento (urgente) o en el resumen diario.
  avisado_en timestamptz,
  creado_en timestamptz not null default now()
);
create index escalations_abiertas on agentes.escalations (estado, prioridad, creado_en);
-- Un mismo caso abierto no se escala dos veces.
create unique index escalations_una_abierta
  on agentes.escalations (agente, coalesce(usuario_id, '00000000-0000-0000-0000-000000000000'::uuid), motivo)
  where estado = 'abierto';

-- La cola de eventos: una fila por agente interesado.
create table agentes.eventos (
  id uuid primary key default gen_random_uuid(),
  agente text not null references agentes.agent_config (agente),
  tipo text not null check (tipo ~ '^[a-z_]+$'),
  usuario_id uuid,
  -- Lo que hace único al evento: "pago:123", "vencimiento:2026-12-01".
  clave text not null,
  datos jsonb not null default '{}'::jsonb,
  tomado_en timestamptz,
  procesado_en timestamptz,
  intentos integer not null default 0,
  error text,
  creado_en timestamptz not null default now(),
  unique (agente, tipo, clave)
);
create index eventos_pendientes on agentes.eventos (agente, creado_en) where procesado_en is null;

-- Nadie lee estas tablas directo salvo el dueño (service role). Los agentes,
-- por las funciones de abajo.
revoke all on all tables in schema agentes from public;
grant select on all tables in schema agentes to service_role;

-- ============================================================
-- 3) Quién está llamando
-- ============================================================
--
-- Dentro de una función SECURITY DEFINER, `current_user` es el dueño de la
-- función; `session_user` sigue siendo el rol con el que se entró. Cada
-- agente entra con el suyo, así que ningún agente puede hablar por otro.

create function agentes.agente_de_sesion()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when session_user::text ~ '^agente_[a-z]+$' then substr(session_user::text, 8)
    else null
  end
$$;

create function agentes.exigir_agente()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agente text := agentes.agente_de_sesion();
begin
  if v_agente is null or not exists (select 1 from agentes.agent_config c where c.agente = v_agente) then
    raise exception 'EOS_AGENTE_DESCONOCIDO' using errcode = '42501';
  end if;
  return v_agente;
end;
$$;

-- ============================================================
-- 4) Lo que puede hacer un agente
-- ============================================================

-- Empieza una corrida. Si el agente está apagado devuelve {activo:false} y no
-- anota nada. Si la versión del código no es la aprobada, anota la corrida
-- con el error, escala una vez, y devuelve {activo:false}.
create function agentes.empezar_run(
  p_disparador text,
  p_version text,
  p_usuario_id uuid default null,
  p_evento_id uuid default null,
  p_entrada jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agente text := agentes.exigir_agente();
  v_config agentes.agent_config%rowtype;
  v_run uuid;
begin
  select * into v_config from agentes.agent_config where agente = v_agente;

  if not v_config.activo then
    return jsonb_build_object('activo', false, 'motivo', 'apagado');
  end if;

  insert into agentes.agent_runs (agente, disparador, evento_id, usuario_id, entrada_resumen, version)
  values (v_agente, p_disparador, p_evento_id, p_usuario_id, coalesce(p_entrada, '{}'::jsonb), p_version)
  returning id into v_run;

  if v_config.version_aprobada is null or p_version is distinct from v_config.version_aprobada then
    update agentes.agent_runs
    set error = 'version_sin_aprobar', terminado_en = now(), duracion_ms = 0
    where id = v_run;

    insert into agentes.escalations (agente, run_id, motivo, prioridad, contexto)
    values (v_agente, v_run, 'Versión de reglas o prompt sin aprobar', 'urgente',
            jsonb_build_object('version_codigo', p_version, 'version_aprobada', v_config.version_aprobada))
    on conflict do nothing;

    return jsonb_build_object('activo', false, 'motivo', 'version_sin_aprobar', 'run_id', v_run);
  end if;

  return jsonb_build_object('activo', true, 'run_id', v_run, 'limites', v_config.limites);
end;
$$;

-- La única puerta para mandarle algo a una persona. Devuelve el id del
-- mensaje autorizado, o null si no se puede mandar (y por qué queda anotado).
create function agentes.autorizar_envio(
  p_run_id uuid,
  p_usuario_id uuid,
  p_canal text,
  p_plantilla text,
  p_cuenta_tope boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agente text := agentes.exigir_agente();
  v_run agentes.agent_runs%rowtype;
  v_config agentes.agent_config%rowtype;
  v_tope integer;
  v_en_semana integer;
  v_en_corrida integer;
  v_cuenta boolean := coalesce(p_cuenta_tope, true);
  v_id uuid;
begin
  select * into v_run from agentes.agent_runs where id = p_run_id;
  if not found or v_run.agente <> v_agente then
    raise exception 'EOS_AGENTE_RUN_AJENO' using errcode = '42501';
  end if;
  if v_run.terminado_en is not null then
    raise exception 'EOS_AGENTE_RUN_TERMINADO';
  end if;
  if p_usuario_id is null then
    raise exception 'EOS_AGENTE_SIN_USUARIO';
  end if;

  -- Fuera del tope solo contesta Soporte, a una pregunta de la persona.
  if v_agente <> 'soporte' then
    v_cuenta := true;
  end if;

  -- Un candado por persona: dos agentes a la vez no se reparten el mismo cupo.
  perform pg_advisory_xact_lock(hashtextextended('agentes:tope:' || p_usuario_id::text, 0));

  select * into v_config from agentes.agent_config where agente = v_agente;

  if not v_config.activo or v_run.version is distinct from v_config.version_aprobada then
    insert into agentes.agent_messages (run_id, agente, usuario_id, canal, plantilla, estado, cuenta_tope)
    values (p_run_id, v_agente, p_usuario_id, p_canal, p_plantilla, 'bloqueado_apagado', v_cuenta);
    return null;
  end if;

  select count(*) into v_en_corrida
  from agentes.agent_messages m
  where m.run_id = p_run_id and m.estado in ('autorizado', 'enviado', 'entregado');

  if v_en_corrida >= coalesce((v_config.limites ->> 'mensajes_por_corrida')::integer, 200) then
    insert into agentes.agent_messages (run_id, agente, usuario_id, canal, plantilla, estado, cuenta_tope, detalle)
    values (p_run_id, v_agente, p_usuario_id, p_canal, p_plantilla, 'bloqueado_tope', v_cuenta, 'tope de la corrida');
    return null;
  end if;

  if v_cuenta then
    select tope_semanal into v_tope from agentes.ajustes where id;

    select count(*) into v_en_semana
    from agentes.agent_messages m
    where m.usuario_id = p_usuario_id
      and m.cuenta_tope
      and m.estado in ('autorizado', 'enviado', 'entregado')
      and m.creado_en > now() - interval '7 days';

    if v_en_semana >= v_tope then
      insert into agentes.agent_messages (run_id, agente, usuario_id, canal, plantilla, estado, cuenta_tope, detalle)
      values (p_run_id, v_agente, p_usuario_id, p_canal, p_plantilla, 'bloqueado_tope', true, 'tope semanal');
      return null;
    end if;
  end if;

  insert into agentes.agent_messages (run_id, agente, usuario_id, canal, plantilla, estado, cuenta_tope)
  values (p_run_id, v_agente, p_usuario_id, p_canal, p_plantilla, 'autorizado', v_cuenta)
  returning id into v_id;

  return v_id;
end;
$$;

-- Lo que pasó con un mensaje autorizado. Un mensaje fallado deja de contar
-- para el tope: la persona no lo recibió.
create function agentes.marcar_entrega(
  p_mensaje_id uuid,
  p_estado text,
  p_proveedor_id text default null,
  p_detalle text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agente text := agentes.exigir_agente();
begin
  if p_estado not in ('enviado', 'entregado', 'fallado') then
    raise exception 'EOS_AGENTE_ESTADO_INVALIDO';
  end if;

  update agentes.agent_messages
  set estado = p_estado,
      proveedor_id = coalesce(p_proveedor_id, proveedor_id),
      detalle = left(p_detalle, 500),
      actualizado_en = now()
  where id = p_mensaje_id
    and agente = v_agente
    and estado in ('autorizado', 'enviado');

  if not found then
    raise exception 'EOS_AGENTE_MENSAJE_AJENO' using errcode = '42501';
  end if;
end;
$$;

-- Le pasa un caso al dueño. El mismo caso abierto no se duplica: devuelve el
-- que ya estaba.
create function agentes.escalar(
  p_run_id uuid,
  p_usuario_id uuid,
  p_motivo text,
  p_prioridad text,
  p_contexto jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agente text := agentes.exigir_agente();
  v_id uuid;
begin
  if p_run_id is not null and not exists (
    select 1 from agentes.agent_runs r where r.id = p_run_id and r.agente = v_agente
  ) then
    raise exception 'EOS_AGENTE_RUN_AJENO' using errcode = '42501';
  end if;

  insert into agentes.escalations (agente, run_id, usuario_id, motivo, prioridad, contexto)
  values (v_agente, p_run_id, p_usuario_id, p_motivo, p_prioridad, coalesce(p_contexto, '{}'::jsonb))
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select e.id into v_id
    from agentes.escalations e
    where e.agente = v_agente
      and e.estado = 'abierto'
      and e.motivo = p_motivo
      and e.usuario_id is not distinct from p_usuario_id
    limit 1;
  end if;

  return v_id;
end;
$$;

create function agentes.terminar_run(
  p_run_id uuid,
  p_salida jsonb default null,
  p_modelo text default null,
  p_tokens_entrada integer default 0,
  p_tokens_salida integer default 0,
  p_tokens_cache integer default 0,
  p_costo_usd numeric default 0,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agente text := agentes.exigir_agente();
begin
  update agentes.agent_runs
  set salida = p_salida,
      modelo = p_modelo,
      tokens_entrada = coalesce(p_tokens_entrada, 0),
      tokens_salida = coalesce(p_tokens_salida, 0),
      tokens_cache = coalesce(p_tokens_cache, 0),
      costo_usd = greatest(coalesce(p_costo_usd, 0), 0),
      error = left(p_error, 2000),
      terminado_en = now(),
      duracion_ms = (extract(epoch from (now() - creado_en)) * 1000)::integer
  where id = p_run_id and agente = v_agente and terminado_en is null;

  if not found then
    raise exception 'EOS_AGENTE_RUN_AJENO' using errcode = '42501';
  end if;
end;
$$;

-- Gasto del mes del agente que llama, para que corte antes de pasarse.
create function agentes.gasto_del_mes()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.costo_usd), 0)
  from agentes.agent_runs r
  where r.agente = agentes.exigir_agente()
    and r.creado_en >= date_trunc('month', now())
$$;

-- Toma hasta p_limite eventos pendientes de este agente. Un evento tomado y
-- no cerrado en 15 minutos (la corrida se cayó) vuelve a estar disponible.
create function agentes.tomar_eventos(p_limite integer default 50)
returns setof agentes.eventos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agente text := agentes.exigir_agente();
begin
  return query
  update agentes.eventos e
  set tomado_en = now(), intentos = e.intentos + 1
  where e.id in (
    select x.id
    from agentes.eventos x
    where x.agente = v_agente
      and x.procesado_en is null
      and x.intentos < 5
      and (x.tomado_en is null or x.tomado_en < now() - interval '15 minutes')
    order by x.creado_en
    limit greatest(1, least(coalesce(p_limite, 50), 500))
    for update skip locked
  )
  returning e.*;
end;
$$;

create function agentes.cerrar_evento(p_evento_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agente text := agentes.exigir_agente();
begin
  update agentes.eventos
  set procesado_en = case when p_error is null then now() else null end,
      tomado_en = case when p_error is null then tomado_en else null end,
      error = left(p_error, 1000)
  where id = p_evento_id and agente = v_agente;

  if not found then
    raise exception 'EOS_AGENTE_EVENTO_AJENO' using errcode = '42501';
  end if;
end;
$$;

-- Permisos: los agentes solo ejecutan estas; nadie más (salvo el dueño de la
-- base) las ejecuta.
revoke all on all functions in schema agentes from public;
grant execute on function
  agentes.empezar_run(text, text, uuid, uuid, jsonb),
  agentes.autorizar_envio(uuid, uuid, text, text, boolean),
  agentes.marcar_entrega(uuid, text, text, text),
  agentes.escalar(uuid, uuid, text, text, jsonb),
  agentes.terminar_run(uuid, jsonb, text, integer, integer, integer, numeric, text),
  agentes.gasto_del_mes(),
  agentes.tomar_eventos(integer),
  agentes.cerrar_evento(uuid, text)
to agentes_base;

-- ============================================================
-- 5) Lo que hace el dueño (service role: /admin/agentes y `npm run agentes`)
-- ============================================================

create function public.eos_agentes_panel_v267()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tope_semanal', (select a.tope_semanal from agentes.ajustes a where a.id),
    'agentes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'agente', c.agente,
        'activo', c.activo,
        'version_aprobada', c.version_aprobada,
        'aprobado_por', c.aprobado_por,
        'aprobado_en', c.aprobado_en,
        'limites', c.limites,
        'corridas_7d', (select count(*) from agentes.agent_runs r
                        where r.agente = c.agente and r.creado_en > now() - interval '7 days'),
        'errores_7d', (select count(*) from agentes.agent_runs r
                       where r.agente = c.agente and r.error is not null and r.creado_en > now() - interval '7 days'),
        'mensajes_7d', (select count(*) from agentes.agent_messages m
                        where m.agente = c.agente and m.estado in ('enviado', 'entregado')
                          and m.creado_en > now() - interval '7 days'),
        'bloqueados_tope_7d', (select count(*) from agentes.agent_messages m
                               where m.agente = c.agente and m.estado = 'bloqueado_tope'
                                 and m.creado_en > now() - interval '7 days'),
        'costo_mes_usd', (select coalesce(sum(r.costo_usd), 0) from agentes.agent_runs r
                          where r.agente = c.agente and r.creado_en >= date_trunc('month', now()))
      ) order by c.agente)
      from agentes.agent_config c
    ), '[]'::jsonb),
    'escalamientos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'agente', e.agente, 'usuario_id', e.usuario_id, 'motivo', e.motivo,
        'prioridad', e.prioridad, 'contexto', e.contexto, 'creado_en', e.creado_en,
        'avisado_en', e.avisado_en
      ) order by (e.prioridad = 'urgente') desc, e.creado_en)
      from agentes.escalations e
      where e.estado = 'abierto'
    ), '[]'::jsonb)
  )
$$;

create function public.eos_agentes_cambiar_v267(p_agente text, p_activo boolean, p_quien text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(btrim(p_quien), '') = '' then
    raise exception 'EOS_AGENTES_FALTA_QUIEN';
  end if;
  update agentes.agent_config
  set activo = p_activo, actualizado_por = p_quien, actualizado_en = now()
  where agente = p_agente;
  if not found then
    raise exception 'EOS_AGENTE_DESCONOCIDO';
  end if;
end;
$$;

create function public.eos_agentes_aprobar_v267(p_agente text, p_version text, p_quien text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(btrim(p_quien), '') = '' then
    raise exception 'EOS_AGENTES_FALTA_QUIEN';
  end if;
  if p_version is null or p_version !~ '^[a-f0-9]{12,64}$' then
    raise exception 'EOS_AGENTES_VERSION_INVALIDA';
  end if;
  update agentes.agent_config
  set version_aprobada = p_version, aprobado_por = p_quien, aprobado_en = now(),
      actualizado_por = p_quien, actualizado_en = now()
  where agente = p_agente;
  if not found then
    raise exception 'EOS_AGENTE_DESCONOCIDO';
  end if;
end;
$$;

create function public.eos_agentes_tope_v267(p_tope integer, p_quien text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(btrim(p_quien), '') = '' then
    raise exception 'EOS_AGENTES_FALTA_QUIEN';
  end if;
  update agentes.ajustes
  set tope_semanal = p_tope, actualizado_por = p_quien, actualizado_en = now()
  where id;
end;
$$;

create function public.eos_agentes_resolver_v267(p_escalamiento uuid, p_respuesta text, p_quien text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(btrim(p_quien), '') = '' then
    raise exception 'EOS_AGENTES_FALTA_QUIEN';
  end if;
  update agentes.escalations
  set estado = 'resuelto', respuesta = left(p_respuesta, 4000), resuelto_por = p_quien, resuelto_en = now()
  where id = p_escalamiento and estado = 'abierto';
  if not found then
    raise exception 'EOS_AGENTES_ESCALAMIENTO_NO_ABIERTO';
  end if;
end;
$$;

-- Pone un evento en la cola de cada agente que lo escucha. La llaman las
-- rutas de la app (service role) y los triggers de las próximas migraciones.
-- Devuelve cuántas filas nuevas quedaron (0 si ya estaba).
create function public.eos_agentes_emitir_v267(
  p_tipo text,
  p_clave text,
  p_usuario_id uuid default null,
  p_origen text default null,
  p_datos jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  insert into agentes.eventos (agente, tipo, usuario_id, clave, datos)
  select c.agente, p_tipo, p_usuario_id, p_clave,
         coalesce(p_datos, '{}'::jsonb) || jsonb_build_object('origen', p_origen)
  from agentes.agent_config c
  where p_tipo = any (c.eventos)
  on conflict (agente, tipo, clave) do nothing;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- Lo que falta avisarle al dueño: urgentes (al momento) o normales (resumen).
create function public.eos_agentes_por_avisar_v267(p_urgentes boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'agente', e.agente, 'usuario_id', e.usuario_id, 'motivo', e.motivo,
    'prioridad', e.prioridad, 'contexto', e.contexto, 'creado_en', e.creado_en
  ) order by e.creado_en), '[]'::jsonb)
  from agentes.escalations e
  where e.estado = 'abierto'
    and e.avisado_en is null
    and (e.prioridad = 'urgente') = coalesce(p_urgentes, false)
$$;

create function public.eos_agentes_avisados_v267(p_ids uuid[], p_urgentes boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  update agentes.escalations
  set avisado_en = now()
  where id = any (p_ids) and avisado_en is null
    and (prioridad = 'urgente') = coalesce(p_urgentes, false);
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- Una por función: `npm run grants` busca el revoke de cada firma.
revoke execute on function public.eos_agentes_panel_v267() from public, anon, authenticated;
revoke execute on function public.eos_agentes_cambiar_v267(text, boolean, text) from public, anon, authenticated;
revoke execute on function public.eos_agentes_aprobar_v267(text, text, text) from public, anon, authenticated;
revoke execute on function public.eos_agentes_tope_v267(integer, text) from public, anon, authenticated;
revoke execute on function public.eos_agentes_resolver_v267(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.eos_agentes_emitir_v267(text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.eos_agentes_por_avisar_v267(boolean) from public, anon, authenticated;
revoke execute on function public.eos_agentes_avisados_v267(uuid[], boolean) from public, anon, authenticated;

grant execute on function
  public.eos_agentes_panel_v267(),
  public.eos_agentes_cambiar_v267(text, boolean, text),
  public.eos_agentes_aprobar_v267(text, text, text),
  public.eos_agentes_tope_v267(integer, text),
  public.eos_agentes_resolver_v267(uuid, text, text),
  public.eos_agentes_emitir_v267(text, text, uuid, text, jsonb),
  public.eos_agentes_por_avisar_v267(boolean),
  public.eos_agentes_avisados_v267(uuid[], boolean)
to service_role;

-- ============================================================
-- 6) Cerrar lo que PUBLIC todavía podía ejecutar
-- ============================================================
--
-- Postgres le da EXECUTE a PUBLIC sobre toda función nueva. Desde la v169 las
-- migraciones lo revocan una por una (`npm run grants`), pero las funciones
-- SECURITY DEFINER más viejas pueden conservarlo. Para anon, authenticated y
-- service_role eso no cambia nada (tienen su grant propio). Para un rol de
-- agente es la diferencia entre "no puede escribir en pagos" y "puede, si
-- llama a la función correcta": una SECURITY DEFINER escribe con los
-- permisos de su dueño.
--
-- Así que a cada una de esas funciones se le quita PUBLIC, y antes se le da
-- EXECUTE explícito a cada rol que no sea de agente y que hoy lo tenga. Nadie
-- que hoy la llama deja de poder llamarla.
--
-- Medido en producción el 27/11/2026: hoy no queda ninguna (las cerraron la
-- v169/v171). Este bloque queda como red por si alguna se reabre antes de
-- aplicar; `supabase/pruebas/agentes_permisos_e2e.sql` lo vuelve a mirar.

do $$
declare
  v_fn record;
  v_rol record;
begin
  for v_fn in
    select p.oid, p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      )
  loop
    for v_rol in
      select r.rolname
      from pg_roles r
      where r.rolname !~ '^agente'
        and r.rolname !~ '^pg_'
        and not r.rolsuper
        and has_function_privilege(r.oid, v_fn.oid, 'EXECUTE')
    loop
      execute format('grant execute on function %s to %I', v_fn.firma, v_rol.rolname);
    end loop;
    execute format('revoke execute on function %s from public', v_fn.firma);
  end loop;
end;
$$;

-- ============================================================
-- 7) El aviso al dueño
-- ============================================================
--
-- Un escalamiento urgente dispara al momento la ruta que le avisa por push y
-- correo. Los normales los junta el resumen de las 18:00 de Asunción (21:00
-- UTC). Las dos cosas usan `eos_llamar_cron_v262`; donde no existe (la base
-- de prueba), no se hace nada.

create function agentes.avisar_urgente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.prioridad = 'urgente' and to_regprocedure('public.eos_llamar_cron_v262(text)') is not null then
    begin
      execute 'select public.eos_llamar_cron_v262($1)'
      using '/api/cron/agentes-escalamientos?urgentes=1';
    exception when others then
      -- El aviso no puede tirar abajo el escalamiento: queda sin avisar y lo
      -- levanta el resumen diario.
      null;
    end;
  end if;
  return new;
end;
$$;
revoke all on function agentes.avisar_urgente() from public;

create trigger escalations_avisar_urgente
after insert on agentes.escalations
for each row execute function agentes.avisar_urgente();

do $$
declare
  v_existente bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into v_existente from cron.job where jobname = 'eos-agentes-resumen-v267' limit 1;
    if v_existente is not null then
      perform cron.unschedule(v_existente);
    end if;
    perform cron.schedule(
      'eos-agentes-resumen-v267',
      '0 21 * * *',
      'select public.eos_llamar_cron_v262(''/api/cron/agentes-escalamientos'');'
    );
  end if;
end;
$$;

comment on schema agentes is
  'v267: el equipo de agentes. Cada agente entra con su rol agente_<nombre> y solo ejecuta las funciones de este schema. Ver docs/agentes/.';
