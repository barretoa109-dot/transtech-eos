-- CORREGIR_VENTA: "eran 3, no 30".
--
-- ============================================================
-- EL ÚLTIMO HUECO DEL NEGOCIO, Y EL MÁS FRECUENTE
-- ============================================================
--
-- `eos_erp_editar_venta` existe desde el 4 de septiembre. La escribió el
-- pedido de una usuaria, textual: "Debe de poder editar todo lo que sean
-- compras y ventas en todos sus apartados". Anula la vieja y registra la nueva
-- en una sola transacción, heredando gratis las protecciones de anular —el
-- stock que vuelve, el ingreso que se borra, la negativa si hay factura
-- emitida—.
--
-- Y desde el chat no había forma de llegar. Quien dictaba una venta y se daba
-- cuenta de que EOS entendió 30 donde dijo 3 tenía dos caminos: anular y
-- volver a dictarla entera, o ir a la pantalla.
--
-- Es el error MÁS FRECUENTE de todos los que puede cometer este sistema,
-- porque no es un error del sistema: es un número hablado que se entendió mal.
-- Y hasta hoy era el que peor se arreglaba.
--
-- ============================================================
-- SE CORRIGE UN RENGLÓN, NO SE REDICTA LA VENTA
-- ============================================================
--
-- `eos_erp_editar_venta` pide la lista COMPLETA de ítems, porque la pantalla
-- se la puede dar: los tiene todos en un formulario.
--
-- Desde el chat nadie dice la venta entera para cambiar un número. Así que
-- acá se leen los ítems que la venta ya tiene, se toca el que corresponde, y
-- se manda la lista completa. La persona dice lo que cambia; el resto no se
-- toca y no hace falta que lo repita.
--
-- ============================================================
-- LO QUE SE NIEGA A ADIVINAR
-- ============================================================
--
--   · Una venta de VARIOS renglones sin decir cuál. "Eran 3, no 30" sobre una
--     venta de cuatro productos no dice nada de cuál de los cuatro. Se listan
--     y se pregunta.
--   · Un producto que no está en esa venta. Ahí el error no es el número: es
--     que se está hablando de otra venta.
--   · Cambiar nada. Sin cantidad ni precio nuevos no hay corrección.
--
-- ============================================================
-- LA IDEMPOTENCIA, QUE ACÁ ES OBLIGATORIA
-- ============================================================
--
-- Corregir CREA una venta nueva (anula la vieja y registra otra). Un reintento
-- sin marca resolvería "la más reciente" —que ahora es la corregida— y la
-- volvería a corregir, dejando tres ventas donde había una.
--
-- La marca es `action_command_id` sobre la venta NUEVA, igual que en
-- REGISTRAR_VENTA: un reintento encuentra su propia huella y devuelve lo
-- mismo sin tocar nada.

create or replace function public.eos_erp_corregir_venta_por_chat_v162(
  p_usuario_id uuid,
  p_command_id uuid,
  p_referencia text default null,
  p_producto text default null,
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

  v_detalle := public.eos_erp_resolver_venta(p_usuario_id, p_referencia, 7);
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
$function$;

revoke all on function public.eos_erp_corregir_venta_por_chat_v162(uuid, uuid, text, text, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_corregir_venta_por_chat_v162(uuid, uuid, text, text, numeric, numeric, text)
  to service_role;

comment on function public.eos_erp_corregir_venta_por_chat_v162(uuid, uuid, text, text, numeric, numeric, text) is
  'v162: corrige la cantidad o el precio de un renglón de una venta desde el chat, sin redictarla. Ver la cabecera de la v162.';

-- ============================================================
-- El catálogo de acciones, en las tres tablas
-- ============================================================

alter table public.eos_action_commands
  drop constraint if exists eos_action_commands_accion_check;

alter table public.eos_action_commands
  add constraint eos_action_commands_accion_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA',
    'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA', 'CORREGIR_VENTA'
  ]));

alter table public.eos_autonomy_rules_v12
  drop constraint if exists eos_autonomy_rules_action_check;

alter table public.eos_autonomy_rules_v12
  add constraint eos_autonomy_rules_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA',
    'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA', 'CORREGIR_VENTA'
  ]));

alter table public.eos_worker_gate_audit_v15
  drop constraint if exists eos_worker_gate_audit_action_check;

alter table public.eos_worker_gate_audit_v15
  add constraint eos_worker_gate_audit_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA',
    'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA', 'CORREGIR_VENTA'
  ]));
