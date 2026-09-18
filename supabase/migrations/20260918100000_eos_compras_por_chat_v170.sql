-- ANULAR_COMPRA y CORREGIR_COMPRA: deshacer y arreglar una compra desde el chat.
--
-- ============================================================
-- LA ASIMETRÍA QUE CIERRA
-- ============================================================
--
-- Desde la v161 y la v162 se puede anular o corregir una VENTA por chat. Con
-- la COMPRA no: las funciones existen desde el 27 de agosto
-- (`eos_erp_anular_compra`, v92; `eos_erp_editar_compra`, v116) y la pantalla
-- las usa, pero el chat no tenía verbo. Quien cargaba mal una compra tenía que
-- ir a Negocio > Compras a mano, mientras que con una venta equivocada le
-- alcanzaba con decirlo.
--
-- Mismo criterio que sus pares de venta, y por las mismas razones:
--
--   · cuál compra: la más reciente de los últimos siete días que coincida con
--     la referencia (un monto, un concepto o un proveedor); sin referencia, la
--     última; si dijo algo y no coincide con nada, se falla —no se cae a "la
--     última"—;
--   · la respuesta dice SIEMPRE qué anuló o qué corrigió;
--   · idempotencia con una marca durable (anulada_por_command_id para anular,
--     action_command_id sobre la compra nueva para corregir).
--
-- Dos diferencias con la venta, ambas a propósito:
--
--   · el renglón a corregir se identifica por el id del renglón y no por el
--     producto, porque una compra puede tener conceptos que no están en el
--     catálogo (combustible, un flete): su producto_id es nulo;
--   · no hay "factura emitida" que bloquee la anulación: la factura de una
--     compra es del proveedor, no de este sistema.
--
-- ============================================================
-- CÓMO SE ESCRIBIÓ
-- ============================================================
--
-- El ejecutor (`eos_execute_internal_effect_v64`) y la función de la bitácora
-- (`eos_auditoria_orden_del_chat_v163`) se parchean EN SU LUGAR desde la
-- definición que corre en producción, con el texto anclado y una excepción si
-- el ancla no está — no regenerados desde un archivo del repo, que ya no
-- coincide con lo desplegado (ver la memoria eos-base-adelantada). Los eventos
-- compra_anulada y compra_editada ya existían en el check de la bitácora, sin
-- ninguna acción que los usara.

-- ============================================================
-- 1) De qué comando salió cada anulación de compra
-- ============================================================

alter table public.eos_erp_compras
  add column if not exists anulada_por_command_id uuid
    references public.eos_action_commands (id) on delete set null;

create unique index if not exists eos_erp_compras_anulada_por_command_idx
  on public.eos_erp_compras (anulada_por_command_id)
  where anulada_por_command_id is not null;

-- ============================================================
-- 2) Cuál compra quiso decir
-- ============================================================

create or replace function public.eos_erp_resolver_compra(
  p_usuario_id uuid,
  p_referencia text default null,
  p_dias integer default 7
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_ref text := btrim(coalesce(p_referencia, ''));
  v_tokens text[];
  v_monto numeric;
  v_id uuid;
  v_cuantos int;
  v_desde date := (now() at time zone 'America/Asuncion')::date - greatest(coalesce(p_dias, 7), 0);
begin
  -- Un monto en la referencia vale más que las palabras: "anulá la de
  -- 370.000" es la forma más precisa de señalar una compra.
  v_monto := public.eos_leer_monto(v_ref);

  if v_monto is not null and v_monto > 0 then
    select count(*), (array_agg(c.id order by c.creado_en desc))[1]
      into v_cuantos, v_id
    from public.eos_erp_compras c
    where c.usuario_id = p_usuario_id
      and c.estado <> 'anulada'
      and c.fecha >= v_desde
      and c.total = v_monto;

    if v_cuantos >= 1 then
      return jsonb_build_object('compra_id', v_id, 'candidatos', v_cuantos, 'capa', 'monto');
    end if;
  end if;

  -- Por concepto o por proveedor, con las mismas palabras del resolver de
  -- productos: sin acentos, en singular y sin las de relleno.
  v_tokens := public.eos_tokens(v_ref, true);

  if cardinality(v_tokens) > 0 then
    select count(*), (array_agg(c.id order by c.creado_en desc))[1]
      into v_cuantos, v_id
    from public.eos_erp_compras c
    where c.usuario_id = p_usuario_id
      and c.estado <> 'anulada'
      and c.fecha >= v_desde
      and (
        exists (
          select 1
          from public.eos_erp_compra_items i
          where i.compra_id = c.id
            and v_tokens <@ public.eos_tokens(coalesce(i.descripcion, ''), true)
        )
        or exists (
          select 1
          from public.eos_crm_contactos k
          where k.id = c.contacto_id
            and v_tokens <@ public.eos_tokens(k.nombre, false)
        )
      );

    if v_cuantos >= 1 then
      -- Varias coinciden: la más reciente, y la respuesta dice cuál fue y
      -- cuántas había. Mismo criterio que ANULAR_VENTA.
      return jsonb_build_object('compra_id', v_id, 'candidatos', v_cuantos, 'capa', 'referencia');
    end if;

    -- Dijo algo y no coincide con nada: NO se cae a "la más reciente".
    return jsonb_build_object('compra_id', null, 'candidatos', 0, 'capa', 'referencia');
  end if;

  -- Sin referencia: la última.
  select count(*), (array_agg(c.id order by c.creado_en desc))[1]
    into v_cuantos, v_id
  from public.eos_erp_compras c
  where c.usuario_id = p_usuario_id
    and c.estado <> 'anulada'
    and c.fecha >= v_desde;

  if v_cuantos = 0 then
    return jsonb_build_object('compra_id', null, 'candidatos', 0, 'capa', 'ultima');
  end if;

  return jsonb_build_object('compra_id', v_id, 'candidatos', v_cuantos, 'capa', 'ultima');
end;
$function$;

revoke all on function public.eos_erp_resolver_compra(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.eos_erp_resolver_compra(uuid, text, integer) to service_role;

-- ============================================================
-- 3) Anular una compra desde el chat, contando qué se anuló
-- ============================================================

create or replace function public.eos_erp_anular_compra_por_chat_v170(
  p_usuario_id uuid,
  p_command_id uuid,
  p_referencia text default null,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ya uuid;
  v_detalle jsonb;
  v_compra_id uuid;
  v_compra public.eos_erp_compras%rowtype;
  v_rpc jsonb;
  v_items jsonb;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  -- Idempotencia: un reintento encuentra su propia huella.
  select c.id into v_ya
  from public.eos_erp_compras c
  where c.anulada_por_command_id = p_command_id
  limit 1;

  if v_ya is not null then
    select * into v_compra from public.eos_erp_compras where id = v_ya;

    return jsonb_build_object(
      'ok', true,
      'ya_estaba', true,
      'compra_id', v_ya,
      'fecha', v_compra.fecha,
      'total', v_compra.total,
      'moneda', v_compra.moneda
    );
  end if;

  v_detalle := public.eos_erp_resolver_compra(p_usuario_id, p_referencia, 7);
  v_compra_id := nullif(v_detalle ->> 'compra_id', '')::uuid;

  if v_compra_id is null then
    raise exception 'EOS_ACCION_COMPRA_NO_ENCONTRADA: %',
      coalesce(nullif(btrim(coalesce(p_referencia, '')), ''), 'la última');
  end if;

  select * into v_compra from public.eos_erp_compras where id = v_compra_id;

  -- Qué se anula, leído ANTES de anularlo: es lo único que permite ver en el
  -- momento que se anuló la que no era.
  select coalesce(
    jsonb_agg(jsonb_build_object('concepto', i.descripcion, 'cantidad', i.cantidad)
              order by i.descripcion),
    '[]'::jsonb
  )
  into v_items
  from public.eos_erp_compra_items i
  where i.compra_id = v_compra_id;

  v_rpc := public.eos_erp_anular_compra(
    p_usuario_id,
    v_compra_id,
    coalesce(v_motivo, 'Anulada desde el chat')
  );

  update public.eos_erp_compras
  set anulada_por_command_id = p_command_id
  where id = v_compra_id;

  return v_rpc || jsonb_build_object(
    'compra_id', v_compra_id,
    'fecha', v_compra.fecha,
    'total', v_compra.total,
    'moneda', v_compra.moneda,
    'items', v_items,
    'candidatos', v_detalle -> 'candidatos',
    'capa', v_detalle -> 'capa'
  );
end;
$function$;

revoke all on function public.eos_erp_anular_compra_por_chat_v170(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_anular_compra_por_chat_v170(uuid, uuid, text, text)
  to service_role;

-- ============================================================
-- 4) Corregir un renglón de una compra desde el chat
-- ============================================================

create or replace function public.eos_erp_corregir_compra_por_chat_v170(
  p_usuario_id uuid,
  p_command_id uuid,
  p_referencia text default null,
  p_concepto text default null,
  p_cantidad numeric default null,
  p_precio_unitario numeric default null,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ya uuid;
  v_detalle jsonb;
  v_compra_id uuid;
  v_compra public.eos_erp_compras%rowtype;
  v_nuevos jsonb := '[]'::jsonb;
  v_it record;
  v_objetivo uuid;
  v_cuantos int := 0;
  v_nombres text := '';
  v_antes jsonb;
  v_cant numeric;
  v_prec numeric;
  v_rpc jsonb;
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  if p_cantidad is null and p_precio_unitario is null then
    raise exception 'EOS_ACCION_CORRECCION_SIN_CAMBIO';
  end if;

  if p_cantidad is not null and p_cantidad <= 0 then
    raise exception 'EOS_ACCION_CORRECCION_MONTO_INVALIDO';
  end if;

  if p_precio_unitario is not null and p_precio_unitario < 0 then
    raise exception 'EOS_ACCION_CORRECCION_MONTO_INVALIDO';
  end if;

  -- Idempotencia: la compra NUEVA lleva la marca del comando. Corregir CREA
  -- una compra (anula la vieja y registra otra): sin marca, un reintento
  -- corregiría la ya corregida y quedarían tres donde había una.
  select c.id into v_ya
  from public.eos_erp_compras c
  where c.action_command_id = p_command_id
    and c.estado <> 'anulada'
  limit 1;

  if v_ya is not null then
    select * into v_compra from public.eos_erp_compras where id = v_ya;

    return jsonb_build_object(
      'ok', true, 'ya_estaba', true, 'compra_id', v_ya,
      'fecha', v_compra.fecha, 'total', v_compra.total, 'moneda', v_compra.moneda
    );
  end if;

  v_detalle := public.eos_erp_resolver_compra(p_usuario_id, p_referencia, 7);
  v_compra_id := nullif(v_detalle ->> 'compra_id', '')::uuid;

  if v_compra_id is null then
    raise exception 'EOS_ACCION_COMPRA_NO_ENCONTRADA: %',
      coalesce(nullif(btrim(coalesce(p_referencia, '')), ''), 'la última');
  end if;

  select * into v_compra from public.eos_erp_compras where id = v_compra_id;

  -- Cuál renglón. Con uno solo no hace falta decirlo; con varios, sí. Se
  -- identifica por el id del renglón y no por el producto: una compra puede
  -- tener conceptos que no están en el catálogo (producto_id nulo).
  select count(*) into v_cuantos
  from public.eos_erp_compra_items i
  where i.compra_id = v_compra_id;

  if v_cuantos = 0 then
    raise exception 'EOS_ACCION_COMPRA_SIN_ITEMS';
  end if;

  if v_cuantos = 1 then
    select i.id into v_objetivo
    from public.eos_erp_compra_items i
    where i.compra_id = v_compra_id;
  elsif nullif(btrim(coalesce(p_concepto, '')), '') is null then
    select string_agg(i.descripcion, ', ' order by i.descripcion)
      into v_nombres
    from public.eos_erp_compra_items i
    where i.compra_id = v_compra_id;

    raise exception 'EOS_ACCION_CORRECCION_COMPRA_CUAL_ITEM: %', v_nombres;
  else
    select i.id into v_objetivo
    from public.eos_erp_compra_items i
    where i.compra_id = v_compra_id
      and public.eos_tokens(p_concepto, true) <@ public.eos_tokens(coalesce(i.descripcion, ''), true)
    order by i.orden, i.id
    limit 1;

    if v_objetivo is null then
      raise exception 'EOS_ACCION_CORRECCION_COMPRA_ITEM_AJENO: %', p_concepto;
    end if;
  end if;

  -- La lista completa, con el renglón corregido. El resto queda como estaba.
  for v_it in
    select i.id, i.producto_id, i.descripcion, i.cantidad, i.precio_unitario, i.iva
    from public.eos_erp_compra_items i
    where i.compra_id = v_compra_id
    order by i.orden, i.id
  loop
    v_cant := v_it.cantidad;
    v_prec := v_it.precio_unitario;

    if v_it.id = v_objetivo then
      v_antes := jsonb_build_object(
        'concepto', v_it.descripcion,
        'cantidad', v_it.cantidad,
        'precio_unitario', v_it.precio_unitario
      );
      v_cant := coalesce(p_cantidad, v_it.cantidad);
      v_prec := coalesce(p_precio_unitario, v_it.precio_unitario);
    end if;

    v_nuevos := v_nuevos || jsonb_build_array(
      jsonb_build_object(
        'producto_id', v_it.producto_id,
        'descripcion', v_it.descripcion,
        'cantidad', v_cant,
        'precio_unitario', v_prec,
        'iva', v_it.iva
      )
    );
  end loop;

  v_rpc := public.eos_erp_editar_compra(
    p_usuario_id,
    v_compra_id,
    v_nuevos,
    v_compra.contacto_id,
    v_compra.fecha,
    v_compra.moneda,
    v_compra.condicion,
    -- Si estaba pagada, la corregida también: cambiar una cantidad no deshace
    -- que la plata salió.
    v_compra.estado = 'pagada',
    v_compra.numero_comprobante,
    v_compra.notas,
    coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Corregida desde el chat')
  );

  update public.eos_erp_compras
  set action_command_id = p_command_id
  where id = (v_rpc ->> 'compra_id')::uuid;

  return v_rpc || jsonb_build_object(
    'fecha', v_compra.fecha,
    'moneda', v_compra.moneda,
    'total_anterior', v_compra.total,
    'antes', v_antes,
    'despues', jsonb_build_object(
      'concepto', v_antes ->> 'concepto',
      'cantidad', coalesce(p_cantidad, (v_antes ->> 'cantidad')::numeric),
      'precio_unitario', coalesce(p_precio_unitario, (v_antes ->> 'precio_unitario')::numeric)
    ),
    'candidatos', v_detalle -> 'candidatos'
  );
end;
$function$;

revoke all on function public.eos_erp_corregir_compra_por_chat_v170(uuid, uuid, text, text, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_corregir_compra_por_chat_v170(uuid, uuid, text, text, numeric, numeric, text)
  to service_role;

-- ============================================================
-- 5) El catálogo de acciones, en las tres tablas
-- ============================================================

alter table public.eos_action_commands
  drop constraint if exists eos_action_commands_accion_check;

alter table public.eos_action_commands
  add constraint eos_action_commands_accion_check
  check (accion = any (array['RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD', 'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA', 'VER_DASHBOARD', 'VER_BRIEFING', 'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO', 'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO', 'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO', 'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA', 'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA', 'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO', 'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA', 'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA', 'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA', 'CORREGIR_VENTA', 'ANULAR_COMPRA', 'CORREGIR_COMPRA']));

alter table public.eos_autonomy_rules_v12
  drop constraint if exists eos_autonomy_rules_action_check;

alter table public.eos_autonomy_rules_v12
  add constraint eos_autonomy_rules_action_check
  check (accion = any (array['RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD', 'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA', 'VER_DASHBOARD', 'VER_BRIEFING', 'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO', 'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO', 'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO', 'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA', 'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA', 'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO', 'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA', 'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA', 'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA', 'CORREGIR_VENTA', 'ANULAR_COMPRA', 'CORREGIR_COMPRA']));

alter table public.eos_worker_gate_audit_v15
  drop constraint if exists eos_worker_gate_audit_action_check;

alter table public.eos_worker_gate_audit_v15
  add constraint eos_worker_gate_audit_action_check
  check (accion = any (array['RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD', 'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA', 'VER_DASHBOARD', 'VER_BRIEFING', 'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO', 'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO', 'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO', 'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA', 'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA', 'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO', 'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA', 'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA', 'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA', 'CORREGIR_VENTA', 'ANULAR_COMPRA', 'CORREGIR_COMPRA']));

-- ============================================================
-- 6) El ejecutor, con las dos ramas nuevas
-- ============================================================

CREATE OR REPLACE FUNCTION public.eos_execute_internal_effect_v64(p_command_id uuid)
 RETURNS TABLE(command_id uuid, accion text, effect_type text, effect_id uuid, idempotent boolean, estado text, resultado jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_texto text;
  v_item jsonb;
  v_items jsonb;
  v_contacto_id uuid;
  v_producto_id uuid;
  v_rpc jsonb;
  v_alta jsonb;
  v_precio numeric;
  v_creados jsonb := '[]'::jsonb;
  v_sin_costo jsonb := '[]'::jsonb;
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

  if v_command.accion not in (
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO', 'CREAR_PRODUCTO',
    'ACTUALIZAR_PRODUCTO', 'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA', 'CORREGIR_MOVIMIENTO',
    'DECLARAR_SALDO', 'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA', 'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA', 'CORREGIR_VENTA',
    'ANULAR_COMPRA', 'CORREGIR_COMPRA'
  ) then
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

  elsif v_command.accion = 'REGISTRAR_VENTA' then
    v_effect_type := 'venta';

    select v.id into v_effect_id
    from public.eos_erp_ventas v
    where v.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      if not public.eos_tiene_modulo(v_command.usuario_id, 'erp') then
        raise exception 'EOS_ACCION_SIN_MODULO_ERP';
      end if;

      -- El cliente es opcional: una venta de mostrador es a consumidor final.
      -- Pero si lo nombraron y no se encuentra, se falla en vez de cargarla sin
      -- cliente: "vendile a Rossana" y que quede anónima es un error silencioso.
      v_contacto_id := null;
      v_texto := nullif(btrim(coalesce(v_data ->> 'contacto', v_data ->> 'cliente', '')), '');

      if v_texto is not null then
        v_contacto_id := public.eos_crm_resolver_contacto(v_command.usuario_id, v_texto);

        if v_contacto_id is null then
          raise exception 'EOS_ACCION_CONTACTO_NO_RESUELTO: %', v_texto;
        end if;
      end if;

      v_items := '[]'::jsonb;

      for v_item in
        select * from jsonb_array_elements(
          case
            when jsonb_typeof(v_data -> 'items') = 'array' then v_data -> 'items'
            else '[]'::jsonb
          end
        )
      loop
        v_texto := nullif(btrim(coalesce(
          v_item ->> 'producto', v_item ->> 'nombre', v_item ->> 'descripcion', ''
        )), '');

        /*
         * El precio que dijo la persona sirve para dos cosas: para la venta y,
         * si el producto no existe todavía, para poder crearlo. Ver la v156.
         */
        /*
         * `eos_leer_monto` y no una expresión regular propia.
         *
         * Con '[^0-9.]' —que es lo que este archivo tenía en su primera
         * versión— "185.000" queda en "185.000" y Postgres lo lee como 185.
         * Ciento ochenta y cinco guaraníes. Lo atajó el linter de migraciones
         * antes de llegar a la base; ver la v150, que existe por exactamente
         * este error.
         */
        v_precio := public.eos_leer_monto(v_item ->> 'precio_unitario');

        v_alta := public.eos_erp_resolver_o_crear_producto(
          v_command.usuario_id,
          v_command.id,
          v_texto,
          v_precio
        );

        v_producto_id := nullif(v_alta ->> 'producto_id', '')::uuid;

        if v_producto_id is null then
          raise exception 'EOS_ACCION_PRODUCTO_NO_RESUELTO: %', coalesce(v_texto, '(sin nombre)');
        end if;

        if coalesce((v_alta ->> 'creado')::boolean, false) then
          v_creados := v_creados || jsonb_build_array(
            jsonb_build_object(
              'nombre', v_alta ->> 'nombre',
              'precio_venta', (v_alta ->> 'precio_venta')::numeric
            )
          );
        end if;

        /*
         * Sin costo la venta entra igual y el margen queda pendiente.
         *
         * Es lo contrario de lo que hacía antes: un dato que sólo hace falta
         * para CALCULAR el margen no puede impedir que la venta exista. Se
         * anota cuáles son para poder decirlo en la respuesta, que es lo que
         * convierte un silencio en un pendiente.
         */
        if coalesce((v_alta ->> 'costo_pendiente')::boolean, false) then
          v_sin_costo := v_sin_costo || jsonb_build_array(v_alta ->> 'nombre');
        end if;

        v_items := v_items || jsonb_build_array(
          jsonb_build_object(
            'producto_id', v_producto_id,
            'cantidad', greatest(coalesce((v_item ->> 'cantidad')::numeric, 1), 0.001)
          )
          || case
               when (v_item ->> 'precio_unitario') is not null
                 then jsonb_build_object('precio_unitario', (v_item ->> 'precio_unitario')::numeric)
               else '{}'::jsonb
             end
        );
      end loop;

      if jsonb_array_length(v_items) = 0 then
        raise exception 'EOS_ACCION_VENTA_SIN_ITEMS';
      end if;

      /*
       * Contado se da por cobrado, salvo que digan lo contrario.
       *
       * Quien dicta "vendile tres panes a Rossana" en el mostrador ya cobró. A
       * crédito nunca: ahí la plata no está, y anotarla mostraría disponible
       * algo que nadie puede gastar.
       */
      v_rpc := public.eos_erp_registrar_venta(
        v_command.usuario_id,
        v_items,
        v_contacto_id,
        null,
        'PYG',
        case when v_data ->> 'condicion' = 'credito' then 'credito' else 'contado' end,
        case
          when v_data ->> 'condicion' = 'credito' then false
          when (v_data ->> 'cobrada') is not null then (v_data ->> 'cobrada')::boolean
          else true
        end,
        'Cargada por EOS desde la conversación.'
      );

      v_effect_id := (v_rpc ->> 'venta_id')::uuid;

      update public.eos_erp_ventas
      set action_command_id = v_command.id
      where id = v_effect_id;

      -- Lo que el chat necesita para decir la verdad entera: cuánto fue, qué
      -- productos se crearon en el camino y de cuáles falta el costo.
      v_result := coalesce(v_result, '{}'::jsonb)
        || coalesce(v_rpc, '{}'::jsonb)
        || jsonb_build_object(
             'productos_creados', v_creados,
             'sin_costo', v_sin_costo
           );
    end if;

  elsif v_command.accion = 'AJUSTAR_STOCK' then
    v_effect_type := 'ajuste_stock';

    select m.id into v_effect_id
    from public.eos_erp_movimientos_stock m
    where m.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      if not public.eos_tiene_modulo(v_command.usuario_id, 'erp') then
        raise exception 'EOS_ACCION_SIN_MODULO_ERP';
      end if;

      v_texto := nullif(btrim(coalesce(v_data ->> 'producto', v_data ->> 'nombre', '')), '');
      v_producto_id := public.eos_erp_resolver_producto(v_command.usuario_id, v_texto);

      if v_producto_id is null then
        raise exception 'EOS_ACCION_PRODUCTO_NO_RESUELTO: %', coalesce(v_texto, '(sin nombre)');
      end if;

      v_rpc := public.eos_erp_ajustar_stock(
        v_command.usuario_id,
        v_producto_id,
        case when (v_data ->> 'stock_contado') is not null
          then (v_data ->> 'stock_contado')::numeric else null end,
        case when (v_data ->> 'delta') is not null
          then (v_data ->> 'delta')::numeric else null end,
        coalesce(nullif(btrim(v_data ->> 'motivo'), ''), 'Ajuste pedido por conversación'),
        v_command.id
      );

      v_effect_id := nullif(v_rpc ->> 'movimiento_id', '')::uuid;

      /*
       * Contar y que dé lo mismo no mueve nada, y sin movimiento no hay efecto
       * que devolver. Se apunta al producto para que el comando cierre bien: el
       * pedido se cumplió, sólo que no había nada que corregir.
       */
      if v_effect_id is null then
        v_effect_id := v_producto_id;
        v_idempotent := true;
      end if;
    end if;

  elsif v_command.accion = 'CREAR_CONTACTO' then
    v_effect_type := 'contacto';

    select c.id into v_effect_id
    from public.eos_crm_contactos c
    where c.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      if not (
        public.eos_tiene_modulo(v_command.usuario_id, 'crm')
        or public.eos_tiene_modulo(v_command.usuario_id, 'erp')
      ) then
        raise exception 'EOS_ACCION_SIN_MODULO_CRM';
      end if;

      v_texto := nullif(btrim(coalesce(v_data ->> 'nombre', v_data ->> 'contacto', '')), '');

      if v_texto is null then
        raise exception 'EOS_ACCION_CONTACTO_SIN_NOMBRE';
      end if;

      -- Si ya existe con ese nombre, no se duplica: se devuelve el que hay.
      v_contacto_id := public.eos_crm_resolver_contacto(v_command.usuario_id, v_texto);

      if v_contacto_id is not null then
        v_effect_id := v_contacto_id;
        v_idempotent := true;
      else
        insert into public.eos_crm_contactos (
          usuario_id, tipo, nombre, ruc, ruc_dv, telefono, email,
          es_cliente, es_proveedor, action_command_id
        ) values (
          v_command.usuario_id,
          case when v_data ->> 'tipo' = 'empresa' then 'empresa' else 'persona' end,
          left(v_texto, 160),
          nullif(regexp_replace(coalesce(v_data ->> 'ruc', ''), '[^0-9]', '', 'g'), ''),
          -- El dígito lo calcula la base: pedírselo al modelo es invitarlo a
          -- inventar uno, y un RUC mal cerrado sólo se descubre cuando SIFEN
          -- rechaza una factura ya entregada.
          case
            when nullif(regexp_replace(coalesce(v_data ->> 'ruc', ''), '[^0-9]', '', 'g'), '') is not null
              then public.eos_ruc_digito_verificador(
                regexp_replace(v_data ->> 'ruc', '[^0-9]', '', 'g')
              )
            else null
          end,
          left(nullif(btrim(coalesce(v_data ->> 'telefono', '')), ''), 40),
          left(lower(nullif(btrim(coalesce(v_data ->> 'email', '')), '')), 180),
          coalesce((v_data ->> 'es_cliente')::boolean, true),
          coalesce((v_data ->> 'es_proveedor')::boolean, false),
          v_command.id
        )
        returning id into v_effect_id;
      end if;
    end if;

  elsif v_command.accion = 'CREAR_PRODUCTO' then
    v_effect_type := 'producto';

    -- Idempotencia por comando: si el ejecutor se reintenta, la tanda ya está.
    select p.id into v_effect_id
    from public.eos_erp_productos p
    where p.action_command_id = v_command.id
    order by p.creado_en
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      -- La lista, o un producto suelto envuelto en una lista de uno. El
      -- modelo manda `productos` cuando son varios y a veces los campos
      -- sueltos cuando es uno: aceptar las dos formas evita perder el
      -- pedido por cómo quedó escrito.
      v_items := case
        when jsonb_typeof(v_data -> 'productos') = 'array' then v_data -> 'productos'
        when jsonb_typeof(v_data -> 'items') = 'array' then v_data -> 'items'
        else jsonb_build_array(v_data)
      end;

      v_rpc := public.eos_erp_crear_productos_v131(
        v_command.usuario_id,
        v_command.id,
        v_items
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'ACTUALIZAR_PRODUCTO' then
    v_effect_type := 'producto';

    -- Idempotencia por otra vía que las demás.
    --
    -- Crear deja una fila nueva con `action_command_id`, y de ahí se agarra
    -- el reintento. Actualizar no deja nada nuevo: la fila ya existía. Si el
    -- ejecutor se reintentara sin este corte volvería a aplicar el update,
    -- que en sí es inocuo —los mismos valores— pero devolvería `cambios`
    -- vacíos, y la respuesta pasaría de "le puse el costo" a "no había nada
    -- que cambiar" para el mismo pedido. La marca es el resultado que dejó
    -- el intento anterior de ESTE comando.
    if v_command.estado = 'completada' and v_command.resultado ? 'actualizados' then
      v_effect_id := (v_command.resultado ->> 'effect_id')::uuid;
      v_idempotent := true;
    else
      v_items := case
        when jsonb_typeof(v_data -> 'productos') = 'array' then v_data -> 'productos'
        when jsonb_typeof(v_data -> 'items') = 'array' then v_data -> 'items'
        else jsonb_build_array(v_data)
      end;

      v_rpc := public.eos_erp_actualizar_productos_v133(
        v_command.usuario_id,
        v_command.id,
        v_items
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_COMPRA' then
    v_effect_type := 'compra';

    -- Idempotencia por la compra que dejó este mismo comando. Sin esto, un
    -- reintento del ejecutor duplica la compra entera: el total, el
    -- movimiento financiero y el stock que sumó.
    select c.id into v_effect_id
    from public.eos_erp_compras c
    where c.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_erp_registrar_compra_chat_v134(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_GASTO_FIJO' then
    v_effect_type := 'gasto_fijo';

    select f.id into v_effect_id
    from public.eos_finanzas_fijos f
    where f.action_command_id = v_command.id
    order by f.created_at
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_registrar_fijo_v134(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_MOVIMIENTO_PERSONAL' then
    v_effect_type := 'movimiento_personal';

    select m.id into v_effect_id
    from public.eos_movimientos_financieros m
    where m.action_command_id = v_command.id
    order by m.created_at
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_registrar_personal_v136(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_TRANSFERENCIA' then
    v_effect_type := 'transferencia';

    select t.id into v_effect_id
    from public.eos_finanzas_transferencias t
    where t.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_registrar_transferencia_v138(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_DEUDA' then
    v_effect_type := 'deuda';

    -- Idempotencia: si el comando ya creó una deuda, es ésta.
    select d.id into v_effect_id
    from public.eos_finanzas_deudas d
    where d.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null and v_command.estado = 'completada' then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_registrar_deuda_v139(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_PAGO_DEUDA' then
    v_effect_type := 'pago_deuda';

    -- La marca es el movimiento que dejó: un reintento descontaría el saldo
    -- dos veces, que en una deuda es de los errores más caros posibles.
    select m.id into v_effect_id
    from public.eos_movimientos_financieros m
    where m.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_pagar_deuda_v139(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'CORREGIR_MOVIMIENTO' then
    v_effect_type := 'correccion_movimiento';

    /*
     * La única acción que no crea una fila: corrige una que ya existía.
     *
     * Por eso la marca de idempotencia no es "existe una fila con este
     * command_id" sino "la fila que voy a tocar YA lleva mi huella". La
     * corrección la deja en `metadata.command_id`, así que un reintento la
     * encuentra y no vuelve a aplicar el cambio.
     *
     * Sin esto, un reintento sobre un monto ya corregido no rompería nada
     * —el update es el mismo— pero sí pisaría `monto_anterior` con el valor
     * ya corregido, y se perdería el único rastro de qué había antes.
     */
    select m.id into v_effect_id
    from public.eos_movimientos_financieros m
    where m.usuario_id = v_command.usuario_id
      and (m.metadata ->> 'command_id') = v_command.id::text
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_corregir_movimiento_v148(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'DECLARAR_SALDO' then
    v_effect_type := 'saldo_cuenta';

    /*
     * Igual que CORREGIR_MOVIMIENTO: casi nunca crea una fila, escribe sobre
     * una cuenta que ya estaba. Así que la marca no es "existe algo con este
     * command_id" sino "la cuenta lleva mi huella".
     *
     * Un reintento sin esto no rompería el saldo —escribir 3.000.000 dos
     * veces da 3.000.000— pero volvería a informar el saldo anterior como si
     * fuera nuevo, y la persona leería dos veces que pasó de un número al
     * otro cuando la segunda vez ya venía del nuevo.
     */
    select c.id into v_effect_id
    from public.eos_finanzas_cuentas c
    where c.usuario_id = v_command.usuario_id
      and c.declarado_por_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_declarar_saldo_v149(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion in ('REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA') then
    v_effect_type := case
      when v_command.accion = 'REGISTRAR_COBRO' then 'cobro' else 'pago_compra'
    end;

    /*
     * Las dos ramas son la misma con el signo cambiado, y por eso comparten
     * el cuerpo: cobrarle a un cliente y pagarle a un proveedor recorren la
     * misma cartera. Escribirlas separadas sería garantizar que dentro de un
     * mes una tenga un arreglo que la otra no.
     */
    select coalesce(m.venta_id, m.compra_id) into v_effect_id
    from public.eos_erp_cuenta_movimientos_v107 m
    where m.usuario_id = v_command.usuario_id
      and m.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_erp_cobranza_por_chat_v151(
        v_command.usuario_id,
        v_command.id,
        v_data,
        v_command.accion = 'REGISTRAR_COBRO'
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_TARJETA' then
    v_effect_type := 'tarjeta';

    /*
     * Como DECLARAR_SALDO: casi nunca crea, corrige una tarjeta que ya
     * estaba. La marca es `action_command_id` sobre la tarjeta.
     */
    select t.id into v_effect_id
    from public.eos_finanzas_tarjetas t
    where t.usuario_id = v_command.usuario_id
      and t.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_registrar_tarjeta_v153(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_COMPRA_TARJETA' then
    v_effect_type := 'compra_tarjeta';

    /*
     * Ésta SÍ crea una fila, y el reintento es caro: una compra en cuotas
     * duplicada mete seis vencimientos de más en el calendario y hace creer
     * que el mes no cierra.
     */
    select c.id into v_effect_id
    from public.eos_finanzas_tarjeta_compras c
    where c.usuario_id = v_command.usuario_id
      and c.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_compra_tarjeta_v153(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_OPORTUNIDAD' then
    v_effect_type := 'oportunidad';

    /*
     * Crea o avanza, así que la marca vale para las dos cosas: si la fila
     * lleva este command_id, este comando ya pasó por acá. Sin eso, un
     * reintento sobre una oportunidad que se acaba de crear crearía la
     * segunda, y el embudo contaría dos veces la misma plata.
     */
    select o.id into v_effect_id
    from public.eos_crm_oportunidades o
    where o.usuario_id = v_command.usuario_id
      and o.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_crm_oportunidad_por_chat_v154(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'ANULAR_VENTA' then
    v_effect_type := 'anulacion_venta';

    /*
     * La idempotencia vive adentro de la función, no acá.
     *
     * Las demás acciones marcan la fila que CREARON; ésta no crea ninguna,
     * anula una que ya existía. La marca es `anulada_por_command_id`, y
     * `eos_erp_anular_venta_por_chat_v161` la mira antes de resolver nada:
     * sin eso, un reintento resolvería "la más reciente" de nuevo y, como la
     * primera ya está anulada, anularía una venta buena.
     */
    v_rpc := public.eos_erp_anular_venta_por_chat_v161(
      v_command.usuario_id,
      v_command.id,
      nullif(btrim(coalesce(v_data ->> 'referencia', v_data ->> 'venta', '')), ''),
      nullif(btrim(coalesce(v_data ->> 'motivo', '')), '')
    );

    v_effect_id := (v_rpc ->> 'venta_id')::uuid;
    v_idempotent := coalesce((v_rpc ->> 'ya_estaba')::boolean, false);

    v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;


  elsif v_command.accion = 'CORREGIR_VENTA' then
    v_effect_type := 'correccion_venta';

    /*
     * La idempotencia vive adentro de la función, no acá.
     *
     * Corregir CREA una venta nueva —anula la vieja y registra otra— así que
     * un reintento sin marca resolvería la más reciente, que ahora es la
     * corregida, y la corregiría de nuevo: tres ventas donde había una. La
     * marca es action_command_id sobre la venta nueva, y la pone la función.
     */
    v_rpc := public.eos_erp_corregir_venta_por_chat_v162(
      v_command.usuario_id,
      v_command.id,
      nullif(btrim(coalesce(v_data ->> 'referencia', v_data ->> 'venta', '')), ''),
      nullif(btrim(coalesce(v_data ->> 'producto', '')), ''),
      public.eos_leer_monto(v_data ->> 'cantidad'),
      public.eos_leer_monto(v_data ->> 'precio_unitario'),
      nullif(btrim(coalesce(v_data ->> 'motivo', '')), '')
    );

    v_effect_id := (v_rpc ->> 'venta_id')::uuid;
    v_idempotent := coalesce((v_rpc ->> 'ya_estaba')::boolean, false);

    v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;

  elsif v_command.accion = 'ANULAR_COMPRA' then
    v_effect_type := 'anulacion_compra';

    /*
     * La idempotencia vive adentro de la función (anulada_por_command_id),
     * igual que en ANULAR_VENTA: un reintento resolvería "la más reciente" de
     * nuevo y, como la primera ya está anulada, anularía una compra buena.
     */
    v_rpc := public.eos_erp_anular_compra_por_chat_v170(
      v_command.usuario_id,
      v_command.id,
      nullif(btrim(coalesce(v_data ->> 'referencia', v_data ->> 'compra', '')), ''),
      nullif(btrim(coalesce(v_data ->> 'motivo', '')), '')
    );

    v_effect_id := (v_rpc ->> 'compra_id')::uuid;
    v_idempotent := coalesce((v_rpc ->> 'ya_estaba')::boolean, false);

    v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;

  elsif v_command.accion = 'CORREGIR_COMPRA' then
    v_effect_type := 'correccion_compra';

    /*
     * Corregir CREA una compra nueva (anula la vieja y registra otra): la
     * marca es action_command_id sobre la nueva, y la pone la función.
     */
    v_rpc := public.eos_erp_corregir_compra_por_chat_v170(
      v_command.usuario_id,
      v_command.id,
      nullif(btrim(coalesce(v_data ->> 'referencia', v_data ->> 'compra', '')), ''),
      nullif(btrim(coalesce(v_data ->> 'concepto', v_data ->> 'producto', '')), ''),
      public.eos_leer_monto(v_data ->> 'cantidad'),
      public.eos_leer_monto(v_data ->> 'precio_unitario'),
      nullif(btrim(coalesce(v_data ->> 'motivo', '')), '')
    );

    v_effect_id := (v_rpc ->> 'compra_id')::uuid;
    v_idempotent := coalesce((v_rpc ->> 'ya_estaba')::boolean, false);

    v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;

  end if;

  if v_effect_id is null then
    raise exception 'EOS_INTERNAL_EFFECT_ID_MISSING';
  end if;

  -- `v_result` PRIMERO, y no solo el objeto de abajo.
  --
  -- Antes esta línea pisaba lo que hubiera puesto la rama: CREAR_PRODUCTO
  -- deja ahí `creados` y `ya_existian`, y se perdían. Sin esos dos datos, el
  -- worker no puede distinguir "cargué cuatro" de "los cuatro ya estaban" y
  -- dice lo mismo en los dos casos — que es cómo EOS termina afirmando que
  -- hizo algo que no hizo.
  v_result := coalesce(v_command.resultado, '{}'::jsonb) || coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'effect_type', v_effect_type,
    'effect_id', v_effect_id,
    'idempotent', v_idempotent,
    'executor_version', 'v170'
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
$function$;

-- ============================================================
-- 7) La bitácora, con las dos filas nuevas
-- ============================================================

CREATE OR REPLACE FUNCTION public.eos_auditoria_orden_del_chat_v163()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_evento text;
  v_hizo text;
  v_hacer text;
  v_resumen text;
  v_origen text;
begin
  -- Lo que no toca datos no se asienta: contestar o mostrar un tablero.
  if new.accion in ('RESPONDER', 'VER_DASHBOARD', 'VER_BRIEFING') then
    return new;
  end if;

  /*
   * Un renglón por acción: su evento, qué hizo y qué intentó hacer.
   *
   * `lib/auditoria/ordenes-del-chat.test.ts` lee esta lista y falla si una
   * acción que el worker ejecuta no tiene renglón, si una del ERP no usa su
   * evento, o si una frase no está conjugada como las demás.
   */
  select m.evento, m.hizo, m.hacer
  into v_evento, v_hizo, v_hacer
  from (values
    ('REGISTRAR_VENTA', 'venta_registrada', 'registró una venta', 'registrar una venta'),
    ('ANULAR_VENTA', 'venta_anulada', 'anuló una venta', 'anular una venta'),
    ('CORREGIR_VENTA', 'venta_editada', 'corrigió una venta', 'corregir una venta'),
    ('REGISTRAR_COBRO', 'venta_cobrada', 'registró un cobro', 'registrar un cobro'),
    ('REGISTRAR_COMPRA', 'compra_registrada', 'registró una compra', 'registrar una compra'),
    ('ANULAR_COMPRA', 'compra_anulada', 'anuló una compra', 'anular una compra'),
    ('CORREGIR_COMPRA', 'compra_editada', 'corrigió una compra', 'corregir una compra'),
    ('REGISTRAR_PAGO_COMPRA', 'compra_pagada', 'registró un pago a un proveedor', 'registrar un pago a un proveedor'),
    ('AJUSTAR_STOCK', 'stock_ajustado', 'ajustó el stock de un producto', 'ajustar el stock de un producto'),
    ('CREAR_PRODUCTO', 'producto_modificado', 'cargó productos al catálogo', 'cargar productos al catálogo'),
    ('ACTUALIZAR_PRODUCTO', 'producto_modificado', 'actualizó productos del catálogo', 'actualizar productos del catálogo'),
    ('CREAR_CONTACTO', 'accion_ejecutada', 'agendó un contacto', 'agendar un contacto'),
    ('REGISTRAR_OPORTUNIDAD', 'accion_ejecutada', 'anotó una oportunidad', 'anotar una oportunidad'),
    ('REGISTRAR_MOVIMIENTO_PERSONAL', 'accion_ejecutada', 'anotó movimientos de la plata personal', 'anotar movimientos de la plata personal'),
    ('CORREGIR_MOVIMIENTO', 'accion_ejecutada', 'corrigió un movimiento', 'corregir un movimiento'),
    ('REGISTRAR_TRANSFERENCIA', 'accion_ejecutada', 'anotó una transferencia entre cuentas propias', 'anotar una transferencia entre cuentas propias'),
    ('DECLARAR_SALDO', 'accion_ejecutada', 'actualizó el saldo de una cuenta', 'actualizar el saldo de una cuenta'),
    ('REGISTRAR_DEUDA', 'accion_ejecutada', 'anotó una deuda', 'anotar una deuda'),
    ('REGISTRAR_PAGO_DEUDA', 'accion_ejecutada', 'anotó el pago de una cuota', 'anotar el pago de una cuota'),
    ('REGISTRAR_GASTO_FIJO', 'accion_ejecutada', 'anotó gastos fijos', 'anotar gastos fijos'),
    ('REGISTRAR_TARJETA', 'accion_ejecutada', 'anotó una tarjeta', 'anotar una tarjeta'),
    ('REGISTRAR_COMPRA_TARJETA', 'accion_ejecutada', 'anotó una compra con tarjeta', 'anotar una compra con tarjeta'),
    ('CREAR_TAREA', 'accion_ejecutada', 'creó una tarea', 'crear una tarea'),
    ('CREAR_OBJETIVO', 'accion_ejecutada', 'creó un objetivo', 'crear un objetivo'),
    ('GUARDAR_MEMORIA', 'accion_ejecutada', 'guardó un dato en la memoria', 'guardar un dato en la memoria'),
    ('GENERAR_EXCEL', 'accion_ejecutada', 'generó una planilla', 'generar una planilla'),
    ('GENERAR_PDF', 'accion_ejecutada', 'generó un PDF', 'generar un PDF'),
    ('GENERAR_WORD', 'accion_ejecutada', 'generó un documento', 'generar un documento')
  ) as m(accion, evento, hizo, hacer)
  where m.accion = new.accion;

  -- Una acción nueva sin renglón se asienta igual, con su nombre de máquina.
  -- Queda fea, pero queda: una lista que se quedó atrás no puede ser la razón
  -- de que algo no conste.
  v_evento := coalesce(v_evento, 'accion_ejecutada');
  v_hizo := coalesce(v_hizo, 'ejecutó la acción ' || new.accion);
  v_hacer := coalesce(v_hacer, 'ejecutar la acción ' || new.accion);

  -- Las órdenes que dejaron las pruebas no se hacen pasar por conversaciones:
  -- ni en el origen ni en el resumen. La primera versión decía "Desde el chat"
  -- también para ellas, y se vio probándola antes de aplicarla.
  v_origen := case
    when new.origen = 'prueba' or new.origen like 'qa-%' then 'sistema'
    else 'chat'
  end;

  v_resumen := (case when v_origen = 'chat' then 'Desde el chat' else 'En una prueba del sistema' end)
    || case new.estado
      when 'completada' then ', EOS ' || v_hizo || '.'
      when 'no_disponible' then ', EOS no pudo ' || v_hacer || ': la acción no estaba disponible.'
      else ', EOS intentó ' || v_hacer || ' y no pudo.'
    end;

  begin
    insert into public.eos_auditoria_v60 (
      usuario_id, evento, origen, resumen, detalle, referencia, empresa_id
    ) values (
      new.usuario_id,
      v_evento,
      v_origen,
      v_resumen,
      jsonb_strip_nulls(jsonb_build_object(
        'accion', new.accion,
        'resultado', case when new.estado = 'completada' then 'ok' else new.estado end,
        'orden', new.id::text,
        'request_id', new.request_id::text,
        'mensaje_id', new.mensaje_id::text,
        'intentos', new.attempt_count,
        'error_code', new.error_code,
        'efecto', new.resultado ->> 'effect_type',
        'origen_orden', new.origen
      )),
      coalesce(
        case when new.estado = 'completada' then nullif(new.resultado ->> 'effect_id', '') end,
        new.id::text
      ),
      -- Metadata de consulta, fuera del hash (v123). Solo en lo que es del ERP.
      case when v_evento <> 'accion_ejecutada' then public.eos_empresa_de_v109(new.usuario_id) end
    );
  exception when others then
    raise warning 'AUDITORIA: no se pudo asentar la orden % (%): %', new.id, new.accion, sqlerrm;
  end;

  return new;
end;
$function$;
