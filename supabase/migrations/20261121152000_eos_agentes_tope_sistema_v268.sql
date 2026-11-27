-- v268: los avisos automáticos que ya existían entran al mismo tope que los agentes.
--
-- Plan de agentes aprobado el 27/11/2026 (docs/agentes/), sección 2:
-- "todo lo automático que sale a un usuario pasa por el mismo registro y el
-- mismo tope. Si no, el tope es decorativo."
--
-- ============================================================
-- QUÉ ENTRA Y QUÉ NO
-- ============================================================
--
-- Entra lo que EOS manda por iniciativa propia, sin que la persona lo haya
-- pedido: el push de las tres franjas, el correo motivacional cada 3 días y
-- los correos de la primera semana.
--
-- No entra (y no pasa por acá): lo transaccional (pagos, confirmaciones,
-- contraseña), la respuesta a algo que la persona escribió ("EOS ya te
-- respondió"), el briefing diario (opt-in: lo pidió), sus recordatorios de
-- agenda (los cargó ella) y los avisos de riesgo de su plata (información
-- real de su cuenta, con su propio interruptor). Frenar eso por un tope
-- dejaría a alguien sin saber que no le alcanza para el 28.
--
-- ============================================================
-- CÓMO SE REPARTE EL TOPE
-- ============================================================
--
-- El tope semanal es uno (`ajustes.tope_semanal`, hoy 4) y cuenta todo:
-- agentes + sistema. Dentro de ese tope el sistema tiene su propio techo
-- (`ajustes.tope_sistema`, 2), para que un push de las 9:00 no se coma el
-- cupo que necesita Cobranza o Activación esa semana. Y lo motivacional va
-- espaciado: no más de uno cada 3 días por persona, así no salen los dos del
-- lunes y nada hasta el lunes siguiente.
--
-- El interruptor del sistema es la fila `sistema` de `agent_config`:
-- apagarla corta todo lo de arriba, sin deploy.
--
-- ============================================================
-- ROLLBACK
-- ============================================================
--
--   drop function public.eos_agentes_autorizar_sistema_v268(uuid, text, text, integer),
--     public.eos_agentes_entrega_sistema_v268(uuid, text, text),
--     public.eos_agentes_tope_sistema_v268(integer, text);
--   (el panel de la v267 se vuelve a crear desde la v267)
--   delete from agentes.agent_messages where agente = 'sistema';
--   delete from agentes.agent_config where agente = 'sistema';
--   alter table agentes.agent_messages drop constraint agent_messages_run_o_sistema;
--   alter table agentes.agent_messages alter column run_id set not null;
--   alter table agentes.ajustes drop column tope_sistema;
--   (y el código vuelve a mandar sin preguntar: revertir el PR)

alter table agentes.ajustes
  add column tope_sistema integer not null default 2 check (tope_sistema between 0 and 50);

insert into agentes.agent_config (agente, activo, limites)
values ('sistema', true, '{}')
on conflict (agente) do nothing;

alter table agentes.agent_messages alter column run_id drop not null;
alter table agentes.agent_messages
  add constraint agent_messages_run_o_sistema check (run_id is not null or agente = 'sistema');

-- La puerta del sistema. Misma cuenta y mismo candado que autorizar_envio.
-- Devuelve el id del mensaje autorizado o null (y deja anotado por qué).
create function public.eos_agentes_autorizar_sistema_v268(
  p_usuario_id uuid,
  p_canal text,
  p_plantilla text,
  p_espaciar_dias integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ajustes agentes.ajustes%rowtype;
  v_activo boolean;
  v_total integer;
  v_sistema integer;
  v_detalle text;
  v_id uuid;
begin
  if p_usuario_id is null then
    raise exception 'EOS_AGENTE_SIN_USUARIO';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agentes:tope:' || p_usuario_id::text, 0));

  select activo into v_activo from agentes.agent_config where agente = 'sistema';
  select * into v_ajustes from agentes.ajustes where id;

  if not coalesce(v_activo, false) then
    insert into agentes.agent_messages (agente, usuario_id, canal, plantilla, estado)
    values ('sistema', p_usuario_id, p_canal, p_plantilla, 'bloqueado_apagado');
    return null;
  end if;

  select count(*), count(*) filter (where m.agente = 'sistema')
  into v_total, v_sistema
  from agentes.agent_messages m
  where m.usuario_id = p_usuario_id
    and m.cuenta_tope
    and m.estado in ('autorizado', 'enviado', 'entregado')
    and m.creado_en > now() - interval '7 days';

  if v_total >= v_ajustes.tope_semanal then
    v_detalle := 'tope semanal';
  elsif v_sistema >= least(v_ajustes.tope_sistema, v_ajustes.tope_semanal) then
    v_detalle := 'tope del sistema';
  elsif coalesce(p_espaciar_dias, 0) > 0 and exists (
    select 1 from agentes.agent_messages m
    where m.usuario_id = p_usuario_id
      and m.agente = 'sistema'
      and m.estado in ('autorizado', 'enviado', 'entregado')
      and m.creado_en > now() - make_interval(days => p_espaciar_dias)
  ) then
    v_detalle := 'espaciado';
  end if;

  if v_detalle is not null then
    insert into agentes.agent_messages (agente, usuario_id, canal, plantilla, estado, detalle)
    values ('sistema', p_usuario_id, p_canal, p_plantilla, 'bloqueado_tope', v_detalle);
    return null;
  end if;

  insert into agentes.agent_messages (agente, usuario_id, canal, plantilla, estado)
  values ('sistema', p_usuario_id, p_canal, p_plantilla, 'autorizado')
  returning id into v_id;
  return v_id;
end;
$$;

create function public.eos_agentes_entrega_sistema_v268(p_mensaje_id uuid, p_estado text, p_detalle text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_estado not in ('enviado', 'entregado', 'fallado') then
    raise exception 'EOS_AGENTE_ESTADO_INVALIDO';
  end if;
  update agentes.agent_messages
  set estado = p_estado, detalle = left(p_detalle, 500), actualizado_en = now()
  where id = p_mensaje_id and agente = 'sistema' and estado in ('autorizado', 'enviado');
end;
$$;

revoke execute on function public.eos_agentes_autorizar_sistema_v268(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.eos_agentes_entrega_sistema_v268(uuid, text, text) from public, anon, authenticated;
grant execute on function public.eos_agentes_autorizar_sistema_v268(uuid, text, text, integer) to service_role;
grant execute on function public.eos_agentes_entrega_sistema_v268(uuid, text, text) to service_role;

-- El panel muestra el tope del sistema, y al sistema al final de la lista.
create or replace function public.eos_agentes_panel_v267()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tope_semanal', (select a.tope_semanal from agentes.ajustes a where a.id),
    'tope_sistema', (select a.tope_sistema from agentes.ajustes a where a.id),
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
      ) order by (c.agente = 'sistema'), c.agente)
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
revoke execute on function public.eos_agentes_panel_v267() from public, anon, authenticated;
grant execute on function public.eos_agentes_panel_v267() to service_role;

-- El techo del sistema dentro del tope, desde el panel o `npm run agentes`.
create function public.eos_agentes_tope_sistema_v268(p_tope integer, p_quien text)
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
  set tope_sistema = p_tope, actualizado_por = p_quien, actualizado_en = now()
  where id;
end;
$$;
revoke execute on function public.eos_agentes_tope_sistema_v268(integer, text) from public, anon, authenticated;
grant execute on function public.eos_agentes_tope_sistema_v268(integer, text) to service_role;
