-- Arreglo urgente (13/10/2026, caso real de Sofia): corregir o anular una
-- venta, una compra o un movimiento personal por chat solo buscaba en los
-- ULTIMOS SIETE DIAS. Un gasto de publicidad cargado el 02/10 quedo
-- imposible de corregir por chat el 13/10 (11 dias despues): "No encontre
-- ninguna compra tuya de los ultimos siete dias que coincida con
-- 'publicidad'", dos veces seguidas, aunque la compra SI estaba.
--
-- No era el modelo ni el historial de la conversacion -- eran cinco
-- funciones con el mismo limite hardcodeado, confirmado leyendo
-- eos_action_commands de la cuenta real (dos CORREGIR_COMPRA en estado
-- "error" el 13/10, contra la REGISTRAR_COMPRA del 02/10 que las origino).
--
-- Se amplia de 7 a 30 dias en las cinco: CORREGIR_COMPRA, ANULAR_COMPRA,
-- CORREGIR_VENTA, ANULAR_VENTA (negocio) y CORREGIR_MOVIMIENTO (personal).
-- 30 dias cubre un ciclo mensual de negocio (el caso real era justo eso,
-- "publicidad, duracion de un mes") sin tocar la logica de especificidad
-- que ya evita corregir la fila equivocada: el resolver sigue exigiendo
-- coincidencia por monto o por palabras, y nunca cae a "la mas reciente"
-- cuando lo que se dijo no matchea con nada.
--
-- Las cinco funciones se reescriben completas desde su definicion viva en
-- produccion (pg_get_functiondef, lectura de solo lectura), diff
-- verificado linea por linea: el unico cambio real en cada una es el 7 por
-- el 30.

CREATE OR REPLACE FUNCTION public.eos_erp_corregir_compra_por_chat_v170(p_usuario_id uuid, p_command_id uuid, p_referencia text DEFAULT NULL::text, p_concepto text DEFAULT NULL::text, p_cantidad numeric DEFAULT NULL::numeric, p_precio_unitario numeric DEFAULT NULL::numeric, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  v_detalle := public.eos_erp_resolver_compra(p_usuario_id, p_referencia, 30);
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
$function$
;

revoke all on function public.eos_erp_corregir_compra_por_chat_v170(uuid, uuid, text, text, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_corregir_compra_por_chat_v170(uuid, uuid, text, text, numeric, numeric, text)
  to service_role;

CREATE OR REPLACE FUNCTION public.eos_erp_anular_compra_por_chat_v170(p_usuario_id uuid, p_command_id uuid, p_referencia text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  v_detalle := public.eos_erp_resolver_compra(p_usuario_id, p_referencia, 30);
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
$function$
;

revoke all on function public.eos_erp_anular_compra_por_chat_v170(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_anular_compra_por_chat_v170(uuid, uuid, text, text)
  to service_role;

CREATE OR REPLACE FUNCTION public.eos_erp_corregir_venta_por_chat_v162(p_usuario_id uuid, p_command_id uuid, p_referencia text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_cantidad numeric DEFAULT NULL::numeric, p_precio_unitario numeric DEFAULT NULL::numeric, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ya uuid;
  v_detalle jsonb;
  v_venta_id uuid;
  v_venta public.eos_erp_ventas%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_nuevos jsonb := '[]'::jsonb;
  v_item jsonb;
  v_objetivo uuid;
  v_cuantos int := 0;
  v_tocados int := 0;
  v_nombres text := '';
  v_antes jsonb;
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

  -- Idempotencia: la venta nueva lleva la marca del comando. Ver la cabecera.
  select v.id into v_ya
  from public.eos_erp_ventas v
  where v.action_command_id = p_command_id
    and v.estado <> 'anulada'
  limit 1;

  if v_ya is not null then
    select * into v_venta from public.eos_erp_ventas where id = v_ya;

    return jsonb_build_object(
      'ok', true, 'ya_estaba', true, 'venta_id', v_ya,
      'fecha', v_venta.fecha, 'total', v_venta.total, 'moneda', v_venta.moneda
    );
  end if;

  v_detalle := public.eos_erp_resolver_venta(p_usuario_id, p_referencia, 30);
  v_venta_id := nullif(v_detalle ->> 'venta_id', '')::uuid;

  if v_venta_id is null then
    raise exception 'EOS_ACCION_VENTA_NO_ENCONTRADA: %',
      coalesce(nullif(btrim(coalesce(p_referencia, '')), ''), 'la última');
  end if;

  select * into v_venta from public.eos_erp_ventas where id = v_venta_id;

  -- Cuál renglón. Con uno solo no hace falta decirlo; con varios, sí.
  select count(*) into v_cuantos
  from public.eos_erp_venta_items i
  where i.venta_id = v_venta_id;

  if v_cuantos = 0 then
    raise exception 'EOS_ACCION_VENTA_SIN_ITEMS';
  end if;

  if v_cuantos = 1 then
    select i.producto_id into v_objetivo
    from public.eos_erp_venta_items i
    where i.venta_id = v_venta_id;
  elsif nullif(btrim(coalesce(p_producto, '')), '') is null then
    -- Varios renglones y no dijo cuál: se listan, porque la lista ES la
    -- pregunta. "¿Cuál de los productos?" sin los nombres no ayuda a nadie.
    select string_agg(i.descripcion, ', ' order by i.descripcion)
      into v_nombres
    from public.eos_erp_venta_items i
    where i.venta_id = v_venta_id;

    raise exception 'EOS_ACCION_CORRECCION_CUAL_ITEM: %', v_nombres;
  else
    select i.producto_id into v_objetivo
    from public.eos_erp_venta_items i
    where i.venta_id = v_venta_id
      and public.eos_tokens(p_producto, true) <@ public.eos_tokens(coalesce(i.descripcion, ''), true)
    limit 1;

    if v_objetivo is null then
      -- El producto no está en esta venta. El error no es el número: se está
      -- hablando de otra venta.
      raise exception 'EOS_ACCION_CORRECCION_ITEM_AJENO: %', p_producto;
    end if;
  end if;

  -- La lista completa, con el renglón corregido. El resto queda como estaba:
  -- nadie redicta una venta entera para cambiar un número.
  for v_item in
    select jsonb_build_object(
             'producto_id', i.producto_id,
             'cantidad', i.cantidad,
             'precio_unitario', i.precio_unitario,
             'descripcion', i.descripcion
           )
    from public.eos_erp_venta_items i
    where i.venta_id = v_venta_id
    order by i.descripcion
  loop
    if (v_item ->> 'producto_id')::uuid is not distinct from v_objetivo and v_tocados = 0 then
      v_antes := jsonb_build_object(
        'producto', v_item ->> 'descripcion',
        'cantidad', (v_item ->> 'cantidad')::numeric,
        'precio_unitario', (v_item ->> 'precio_unitario')::numeric
      );

      v_item := v_item
        || jsonb_build_object('cantidad', coalesce(p_cantidad, (v_item ->> 'cantidad')::numeric))
        || jsonb_build_object(
             'precio_unitario',
             coalesce(p_precio_unitario, (v_item ->> 'precio_unitario')::numeric)
           );

      v_tocados := 1;
    end if;

    v_nuevos := v_nuevos || jsonb_build_array(
      jsonb_build_object(
        'producto_id', (v_item ->> 'producto_id')::uuid,
        'cantidad', (v_item ->> 'cantidad')::numeric,
        'precio_unitario', (v_item ->> 'precio_unitario')::numeric
      )
    );
  end loop;

  if v_tocados = 0 then
    raise exception 'EOS_ACCION_CORRECCION_ITEM_AJENO: %', coalesce(p_producto, '(sin nombre)');
  end if;

  v_rpc := public.eos_erp_editar_venta(
    p_usuario_id,
    v_venta_id,
    v_nuevos,
    v_venta.contacto_id,
    v_venta.fecha,
    v_venta.moneda,
    v_venta.condicion,
    -- Si estaba cobrada, la corregida también: cambiar una cantidad no
    -- deshace que la plata entró.
    v_venta.movimiento_id is not null,
    v_venta.notas,
    coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Corregida desde el chat')
  );

  -- La marca de idempotencia va en la venta NUEVA. Ver la cabecera.
  update public.eos_erp_ventas
  set action_command_id = p_command_id
  where id = (v_rpc ->> 'venta_id')::uuid;

  return v_rpc || jsonb_build_object(
    'fecha', v_venta.fecha,
    'moneda', v_venta.moneda,
    'total_anterior', v_venta.total,
    'antes', v_antes,
    'despues', jsonb_build_object(
      'producto', v_antes ->> 'producto',
      'cantidad', coalesce(p_cantidad, (v_antes ->> 'cantidad')::numeric),
      'precio_unitario', coalesce(p_precio_unitario, (v_antes ->> 'precio_unitario')::numeric)
    ),
    'candidatos', v_detalle -> 'candidatos'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.eos_erp_anular_venta_por_chat_v161(p_usuario_id uuid, p_command_id uuid, p_referencia text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ya uuid;
  v_detalle jsonb;
  v_venta_id uuid;
  v_venta public.eos_erp_ventas%rowtype;
  v_rpc jsonb;
  v_items jsonb;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  -- Idempotencia: un reintento encuentra su propia huella. Ver la cabecera.
  select v.id into v_ya
  from public.eos_erp_ventas v
  where v.anulada_por_command_id = p_command_id
  limit 1;

  if v_ya is not null then
    select * into v_venta from public.eos_erp_ventas where id = v_ya;

    return jsonb_build_object(
      'ok', true,
      'ya_estaba', true,
      'venta_id', v_ya,
      'fecha', v_venta.fecha,
      'total', v_venta.total,
      'moneda', v_venta.moneda
    );
  end if;

  v_detalle := public.eos_erp_resolver_venta(p_usuario_id, p_referencia, 30);
  v_venta_id := nullif(v_detalle ->> 'venta_id', '')::uuid;

  if v_venta_id is null then
    raise exception 'EOS_ACCION_VENTA_NO_ENCONTRADA: %',
      coalesce(nullif(btrim(coalesce(p_referencia, '')), ''), 'la última');
  end if;

  select * into v_venta from public.eos_erp_ventas where id = v_venta_id;

  /*
   * Qué se anuló, leído ANTES de anularlo.
   *
   * Es lo único que permite ver en el momento que se anuló la que no era.
   */
  select coalesce(
    jsonb_agg(jsonb_build_object('producto', i.descripcion, 'cantidad', i.cantidad)
              order by i.descripcion),
    '[]'::jsonb
  )
  into v_items
  from public.eos_erp_venta_items i
  where i.venta_id = v_venta_id;

  v_rpc := public.eos_erp_anular_venta(
    p_usuario_id,
    v_venta_id,
    coalesce(v_motivo, 'Anulada desde el chat')
  );

  update public.eos_erp_ventas
  set anulada_por_command_id = p_command_id
  where id = v_venta_id;

  return v_rpc || jsonb_build_object(
    'venta_id', v_venta_id,
    'fecha', v_venta.fecha,
    'total', v_venta.total,
    'moneda', v_venta.moneda,
    'items', v_items,
    'candidatos', v_detalle -> 'candidatos',
    'capa', v_detalle -> 'capa'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.eos_finanzas_corregir_movimiento_v148(p_usuario_id uuid, p_command_id uuid, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buscado text;
  v_monto numeric;
  v_fecha date;
  v_descripcion_nueva text;
  v_antes public.eos_movimientos_financieros%rowtype;
  v_coincidencias integer := 0;
  v_desde date;
begin
  v_buscado := nullif(btrim(coalesce(
    p_datos ->> 'descripcion', p_datos ->> 'concepto', p_datos ->> 'que', ''
  )), '');

  if v_buscado is null then
    raise exception 'EOS_ACCION_CORRECCION_SIN_REFERENCIA';
  end if;

  v_monto := public.eos_leer_monto(coalesce(
    p_datos ->> 'monto', p_datos ->> 'monto_nuevo', p_datos ->> 'importe', ''
  ));

  v_fecha := case
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'fecha')::date
    else null
  end;

  v_descripcion_nueva := nullif(btrim(coalesce(p_datos ->> 'descripcion_nueva', '')), '');

  -- Sin nada que cambiar no hay corrección. Ejecutarla igual devolvería "listo"
  -- sobre una fila que quedó idéntica, que es la peor confirmación posible.
  if v_monto is null and v_fecha is null and v_descripcion_nueva is null then
    raise exception 'EOS_ACCION_CORRECCION_SIN_CAMBIO';
  end if;

  if v_monto is not null and v_monto <= 0 then
    raise exception 'EOS_ACCION_CORRECCION_MONTO_INVALIDO';
  end if;

  v_desde := ((now() at time zone 'America/Asuncion')::date) - 30;

  /*
   * El más reciente de los que coinciden, y solo de la persona.
   *
   * Un movimiento con ambito 'negocio' lo escribió el ERP dentro de una venta
   * o una compra: corregirlo acá lo dejaría distinto del documento que lo
   * generó.
   */
  select count(*) into v_coincidencias
  from public.eos_movimientos_financieros
  where usuario_id = p_usuario_id
    and ambito = 'personal'
    and fecha >= v_desde
    and lower(coalesce(descripcion, '')) like '%' || lower(v_buscado) || '%';

  if v_coincidencias = 0 then
    raise exception 'EOS_ACCION_MOVIMIENTO_NO_ENCONTRADO: %', v_buscado;
  end if;

  select * into v_antes
  from public.eos_movimientos_financieros
  where usuario_id = p_usuario_id
    and ambito = 'personal'
    and fecha >= v_desde
    and lower(coalesce(descripcion, '')) like '%' || lower(v_buscado) || '%'
  order by fecha desc, created_at desc
  limit 1;

  update public.eos_movimientos_financieros
  set monto = coalesce(v_monto, monto),
      fecha = coalesce(v_fecha, fecha),
      descripcion = coalesce(v_descripcion_nueva, descripcion),
      /*
       * Queda anotado que se corrigió, y desde dónde.
       *
       * `metadata` es el único lugar donde sobrevive el valor anterior: la
       * tabla no tiene historial. Sin esto, una corrección es indistinguible
       * de un dato que siempre fue así, y la persona que mañana revise el mes
       * no puede saber si EOS entendió mal o si gastó eso.
       */
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'corregido_el', (now() at time zone 'America/Asuncion')::date,
        'corregido_por', 'chat',
        'command_id', p_command_id,
        'monto_anterior', v_antes.monto,
        'fecha_anterior', v_antes.fecha,
        'descripcion_anterior', v_antes.descripcion
      ),
      updated_at = now()
  where id = v_antes.id;

  return jsonb_build_object(
    'id', v_antes.id,
    'tipo', v_antes.tipo,
    'moneda', v_antes.moneda,
    'antes', jsonb_build_object(
      'monto', v_antes.monto,
      'fecha', v_antes.fecha,
      'descripcion', v_antes.descripcion
    ),
    'despues', jsonb_build_object(
      'monto', coalesce(v_monto, v_antes.monto),
      'fecha', coalesce(v_fecha, v_antes.fecha),
      'descripcion', coalesce(v_descripcion_nueva, v_antes.descripcion)
    ),
    -- Cuántos coincidían. La confirmación lo dice cuando es más de uno, para
    -- que la persona sepa que se eligió el más reciente y pueda desmentirlo.
    'coincidencias', v_coincidencias
  );
end;
$function$
;
