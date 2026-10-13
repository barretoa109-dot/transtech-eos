-- Caja real en ventas, compras y cuenta corriente (PR D de la secuencia).
--
-- Mismo criterio que el chat personal (v241): "caja" opcional, resuelta con
-- eos_resolver_caja_v240 contra eos_empresa_cajas_v120 de la empresa del
-- usuario (eos_empresa_de_v109). Sin "caja" dicha, el movimiento queda sin
-- caja asignada -- no se inventa ninguna.
--
-- Las seis funciones se reescriben completas a partir de su definicion viva
-- en produccion (pg_get_functiondef, lectura de solo lectura). Diff
-- verificado linea por linea: el unico cambio real en cada una es el
-- agregado de caja_id/p_caja.

CREATE OR REPLACE FUNCTION public.eos_erp_registrar_venta(p_usuario_id uuid, p_items jsonb, p_contacto_id uuid DEFAULT NULL::uuid, p_fecha date DEFAULT NULL::date, p_moneda text DEFAULT 'PYG'::text, p_condicion text DEFAULT 'contado'::text, p_cobrada boolean DEFAULT false, p_notas text DEFAULT NULL::text, p_vence_el date DEFAULT NULL::date, p_caja text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venta_id uuid;
  v_item jsonb;
  v_producto public.eos_erp_productos%rowtype;
  v_descripcion text;
  v_cantidad numeric(16,3);
  v_saldo numeric(16,3);
  v_precio numeric(16,2);
  v_iva smallint;
  v_total numeric(16,2);
  v_iva_monto numeric(16,2);
  v_subtotal numeric(16,2) := 0;
  v_iva_total numeric(16,2) := 0;
  v_total_venta numeric(16,2) := 0;
  v_orden smallint := 0;
  v_movimiento_id uuid;
  v_fecha date := coalesce(p_fecha, public.eos_hoy_py());
  v_estado text;
  v_empresa_id uuid;
  v_caja_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EOS_VENTA_SIN_ITEMS';
  end if;

  if jsonb_array_length(p_items) > 200 then
    raise exception 'EOS_VENTA_DEMASIADOS_ITEMS';
  end if;

  v_estado := case when p_cobrada then 'cobrada' else 'emitida' end;

  insert into public.eos_erp_ventas (
    usuario_id, contacto_id, fecha, moneda, condicion, estado, notas, vence_el
  ) values (
    p_usuario_id, p_contacto_id, v_fecha, coalesce(p_moneda, 'PYG'),
    case when p_condicion = 'credito' then 'credito' else 'contado' end,
    v_estado, p_notas,
    -- Al contado nunca vence, sin importar qué se haya mandado.
    case when p_condicion = 'credito' then p_vence_el else null end
  )
  returning id into v_venta_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto := null;

    if (v_item ->> 'producto_id') is not null then
      select * into v_producto
      from public.eos_erp_productos
      where id = (v_item ->> 'producto_id')::uuid
        and public.eos_empresa_alcanza_v112(p_usuario_id, usuario_id)
      for update;

      if not found then
        raise exception 'EOS_VENTA_PRODUCTO_AJENO';
      end if;
    end if;

    -- Lo que el ítem no diga, lo dice el producto. Una venta rápida desde el
    -- chat manda solo el id y la cantidad.
    v_descripcion := coalesce(
      nullif(btrim(coalesce(v_item ->> 'descripcion', '')), ''),
      v_producto.nombre,
      'Ítem'
    );
    v_cantidad := coalesce((v_item ->> 'cantidad')::numeric, 1);
    v_precio := coalesce((v_item ->> 'precio_unitario')::numeric, v_producto.precio_venta, 0);
    v_iva := coalesce((v_item ->> 'iva')::smallint, v_producto.iva, 10);

    if v_cantidad <= 0 then
      raise exception 'EOS_VENTA_CANTIDAD_INVALIDA';
    end if;

    if v_iva not in (0, 5, 10) then
      v_iva := 10;
    end if;

    -- El precio ya trae el IVA adentro, como se dicen los precios acá. El
    -- impuesto se SACA, no se suma: sumarlo factura un 10% de más. Ver
    -- `lib/erp/impuestos.ts`, que hace exactamente esta misma cuenta del lado
    -- del navegador para mostrar el total mientras se carga la venta.
    v_total := round(v_cantidad * v_precio);
    v_iva_monto := case
      when v_iva = 10 then round(v_total / 11)
      when v_iva = 5 then round(v_total / 21)
      else 0
    end;

    insert into public.eos_erp_venta_items (
      venta_id, producto_id, descripcion, cantidad, precio_unitario, iva, total, orden
    ) values (
      v_venta_id, v_producto.id, v_descripcion, v_cantidad, v_precio, v_iva, v_total, v_orden
    );

    v_subtotal := v_subtotal + (v_total - v_iva_monto);
    v_iva_total := v_iva_total + v_iva_monto;
    v_total_venta := v_total_venta + v_total;
    v_orden := v_orden + 1;

    -- El stock se descuenta solo para lo que lleva stock. Y se permite quedar
    -- en negativo a propósito: bloquear la venta porque el sistema dice que no
    -- hay stock, cuando el producto está ahí en el mostrador, es la forma más
    -- rápida de que alguien deje de usar el módulo. Queda registrado y visible.
    if v_producto.id is not null and v_producto.controla_stock then
      update public.eos_erp_productos
      set stock_actual = stock_actual - v_cantidad,
          actualizado_en = now()
      where id = v_producto.id
      returning stock_actual into v_saldo;

      insert into public.eos_erp_movimientos_stock (
        usuario_id, producto_id, tipo, cantidad, saldo_resultante,
        motivo, referencia_tipo, referencia_id, fecha
      ) values (
        p_usuario_id, v_producto.id, 'salida', v_cantidad, v_saldo,
        'Venta', 'venta', v_venta_id, v_fecha
      );
    end if;
  end loop;

  update public.eos_erp_ventas
  set subtotal = v_subtotal,
      iva_total = v_iva_total,
      total = v_total_venta,
      actualizado_en = now()
  where id = v_venta_id;

  -- ============================================================
  -- El puente con Finanzas
  -- ============================================================
  --
  -- Si la venta se cobró, la plata entró. Sin esto, el usuario ve sus ventas en
  -- una pantalla y su disponible real en otra, y el disponible real vuelve a
  -- estar mal — que es exactamente el problema que EOS existe para no causar.
  --
  -- A crédito NO se registra: la plata todavía no está, y anotarla como ingreso
  -- haría que el panel muestre plata que nadie puede gastar.
  if p_cobrada then
    -- Caja: opcional, igual criterio que en el chat personal. Sin `caja`
    -- dicha, el ingreso queda sin caja asignada.
    v_empresa_id := public.eos_empresa_de_v109(p_usuario_id);
    v_caja_id := case
      when p_caja is not null then public.eos_resolver_caja_v240(v_empresa_id, p_caja, coalesce(p_moneda, 'PYG'))
      else null
    end;

    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, metadata, caja_id
    ) values (
      p_usuario_id, 'ingreso', v_total_venta, coalesce(p_moneda, 'PYG'),
      'Venta' || coalesce(' — ' || (
        select c.nombre from public.eos_crm_contactos c where c.id = p_contacto_id
      ), ''),
      'ventas', v_fecha, 'erp',
      jsonb_build_object('venta_id', v_venta_id), v_caja_id
    )
    returning id into v_movimiento_id;

    update public.eos_erp_ventas
    set movimiento_id = v_movimiento_id
    where id = v_venta_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'venta_id', v_venta_id,
    'subtotal', v_subtotal,
    'iva_total', v_iva_total,
    'total', v_total_venta,
    'estado', v_estado,
    'movimiento_id', v_movimiento_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.eos_erp_registrar_compra(p_usuario_id uuid, p_items jsonb, p_contacto_id uuid DEFAULT NULL::uuid, p_fecha date DEFAULT NULL::date, p_moneda text DEFAULT 'PYG'::text, p_condicion text DEFAULT 'contado'::text, p_pagada boolean DEFAULT false, p_numero_comprobante text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_vence_el date DEFAULT NULL::date, p_caja text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_compra_id uuid;
  v_item jsonb;
  v_producto public.eos_erp_productos%rowtype;
  v_descripcion text;
  v_cantidad numeric(16,3);
  v_saldo numeric(16,3);
  v_precio numeric(16,2);
  v_iva smallint;
  v_total numeric(16,2);
  v_iva_monto numeric(16,2);
  v_subtotal numeric(16,2) := 0;
  v_iva_total numeric(16,2) := 0;
  v_total_compra numeric(16,2) := 0;
  v_orden smallint := 0;
  v_movimiento_id uuid;
  v_fecha date := coalesce(p_fecha, public.eos_hoy_py());
  v_empresa_id uuid;
  v_caja_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EOS_COMPRA_SIN_ITEMS';
  end if;

  if jsonb_array_length(p_items) > 200 then
    raise exception 'EOS_COMPRA_DEMASIADOS_ITEMS';
  end if;

  insert into public.eos_erp_compras (
    usuario_id, contacto_id, fecha, moneda, numero_comprobante, condicion, estado, notas, vence_el
  ) values (
    p_usuario_id, p_contacto_id, v_fecha, coalesce(p_moneda, 'PYG'), p_numero_comprobante,
    case when p_condicion = 'credito' then 'credito' else 'contado' end,
    case when p_pagada then 'pagada' else 'registrada' end,
    p_notas,
    -- Al contado un vencimiento no tiene sentido: no se guarda.
    case when p_condicion = 'credito' then p_vence_el else null end
  )
  returning id into v_compra_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto := null;

    if (v_item ->> 'producto_id') is not null then
      select * into v_producto
      from public.eos_erp_productos
      where id = (v_item ->> 'producto_id')::uuid
        and public.eos_empresa_alcanza_v112(p_usuario_id, usuario_id)
      for update;

      if not found then
        raise exception 'EOS_COMPRA_PRODUCTO_AJENO';
      end if;
    end if;

    v_descripcion := coalesce(
      nullif(btrim(coalesce(v_item ->> 'descripcion', '')), ''),
      v_producto.nombre,
      'Ítem'
    );
    v_cantidad := coalesce((v_item ->> 'cantidad')::numeric, 1);
    v_precio := coalesce((v_item ->> 'precio_unitario')::numeric, v_producto.costo, 0);
    v_iva := coalesce((v_item ->> 'iva')::smallint, v_producto.iva, 10);

    if v_cantidad <= 0 then
      raise exception 'EOS_COMPRA_CANTIDAD_INVALIDA';
    end if;

    if v_iva not in (0, 5, 10) then
      v_iva := 10;
    end if;

    -- Misma regla que en la venta: el precio ya trae el IVA adentro y el
    -- impuesto se SACA. En una compra además importa para el crédito fiscal.
    v_total := round(v_cantidad * v_precio);
    v_iva_monto := case
      when v_iva = 10 then round(v_total / 11)
      when v_iva = 5 then round(v_total / 21)
      else 0
    end;

    insert into public.eos_erp_compra_items (
      compra_id, producto_id, descripcion, cantidad, precio_unitario, iva, total, orden
    ) values (
      v_compra_id, v_producto.id, v_descripcion, v_cantidad, v_precio, v_iva, v_total, v_orden
    );

    v_subtotal := v_subtotal + (v_total - v_iva_monto);
    v_iva_total := v_iva_total + v_iva_monto;
    v_total_compra := v_total_compra + v_total;
    v_orden := v_orden + 1;

    if v_producto.id is not null then
      -- El costo se actualiza siempre; el stock solo si el producto lo lleva.
      update public.eos_erp_productos
      set costo = v_precio,
          stock_actual = case
            when controla_stock then stock_actual + v_cantidad
            else stock_actual
          end,
          actualizado_en = now()
      where id = v_producto.id
      returning stock_actual into v_saldo;

      if v_producto.controla_stock then
        insert into public.eos_erp_movimientos_stock (
          usuario_id, producto_id, tipo, cantidad, saldo_resultante,
          motivo, referencia_tipo, referencia_id, fecha
        ) values (
          p_usuario_id, v_producto.id, 'entrada', v_cantidad, v_saldo,
          'Compra', 'compra', v_compra_id, v_fecha
        );
      end if;
    end if;
  end loop;

  update public.eos_erp_compras
  set subtotal = v_subtotal,
      iva_total = v_iva_total,
      total = v_total_compra,
      actualizado_en = now()
  where id = v_compra_id;

  -- La plata solo sale si ya salió. A crédito se registra la deuda con el
  -- proveedor, no el gasto: descontarlo hoy mostraría menos disponible del que
  -- hay, y el usuario dejaría de gastar plata que sí tiene.
  if p_pagada then
    v_empresa_id := public.eos_empresa_de_v109(p_usuario_id);
    v_caja_id := case
      when p_caja is not null then public.eos_resolver_caja_v240(v_empresa_id, p_caja, coalesce(p_moneda, 'PYG'))
      else null
    end;

    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, metadata, caja_id
    ) values (
      p_usuario_id, 'gasto', v_total_compra, coalesce(p_moneda, 'PYG'),
      'Compra' || coalesce(' — ' || (
        select c.nombre from public.eos_crm_contactos c where c.id = p_contacto_id
      ), ''),
      'compras', v_fecha, 'erp',
      jsonb_build_object('compra_id', v_compra_id), v_caja_id
    )
    returning id into v_movimiento_id;

    update public.eos_erp_compras
    set movimiento_id = v_movimiento_id
    where id = v_compra_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'compra_id', v_compra_id,
    'subtotal', v_subtotal,
    'iva_total', v_iva_total,
    'total', v_total_compra,
    'movimiento_id', v_movimiento_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.eos_erp_registrar_compra_chat_v134(p_usuario_id uuid, p_command_id uuid, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item jsonb;
  v_lista jsonb;
  v_items jsonb := '[]'::jsonb;
  v_concepto text;
  v_cantidad numeric;
  v_unitario numeric;
  v_total numeric;
  v_iva integer;
  v_producto uuid;
  v_lleva_stock boolean;
  v_contacto uuid;
  v_proveedor text;
  v_detalle jsonb := '[]'::jsonb;
  v_sin_catalogo jsonb := '[]'::jsonb;
  v_cuantos integer := 0;
  v_rpc jsonb;
  v_compra_id uuid;
  v_condicion text;
  v_fecha date;
  v_caja text;
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  v_lista := case
    when jsonb_typeof(p_datos -> 'items') = 'array' then p_datos -> 'items'
    when jsonb_typeof(p_datos -> 'conceptos') = 'array' then p_datos -> 'conceptos'
    when jsonb_typeof(p_datos -> 'gastos') = 'array' then p_datos -> 'gastos'
    else null
  end;

  if v_lista is null or jsonb_array_length(v_lista) = 0 then
    raise exception 'EOS_ACCION_COMPRA_SIN_ITEMS';
  end if;

  for v_item in select * from jsonb_array_elements(v_lista)
  loop
    v_cuantos := v_cuantos + 1;

    if v_cuantos > 20 then
      raise exception 'EOS_ACCION_COMPRA_DEMASIADOS';
    end if;

    v_concepto := nullif(btrim(coalesce(
      v_item ->> 'concepto',
      v_item ->> 'descripcion',
      v_item ->> 'producto',
      v_item ->> 'nombre',
      ''
    )), '');

    if v_concepto is null then
      raise exception 'EOS_ACCION_COMPRA_SIN_CONCEPTO';
    end if;

    v_cantidad := public.eos_leer_monto(coalesce(v_item ->> 'cantidad', ''));
    if v_cantidad is null or v_cantidad <= 0 then v_cantidad := 1; end if;

    v_unitario := public.eos_leer_monto(coalesce(
      v_item ->> 'precio_unitario', v_item ->> 'costo_unitario', v_item ->> 'costo', ''
    ));

    v_total := public.eos_leer_monto(coalesce(
      v_item ->> 'total', v_item ->> 'monto', v_item ->> 'monto_total', ''
    ));

    if v_unitario is null and v_total is not null then
      v_unitario := v_total / v_cantidad;
    end if;

    if v_unitario is null or v_unitario <= 0 then
      raise exception 'EOS_ACCION_COMPRA_SIN_MONTO: %', v_concepto;
    end if;

    v_iva := nullif(regexp_replace(coalesce(v_item ->> 'iva', ''), '[^0-9]', '', 'g'), '')::integer;
    if v_iva is null or v_iva not in (0, 5, 10) then v_iva := 10; end if;

    v_producto := public.eos_erp_resolver_producto(p_usuario_id, v_concepto);
    v_lleva_stock := false;

    if v_producto is null then
      v_sin_catalogo := v_sin_catalogo || to_jsonb(v_concepto);
    else
      -- Existir en el catálogo y llevar inventario son dos cosas distintas, y
      -- la confirmación necesita la segunda. Ver la cabecera.
      select p.controla_stock into v_lleva_stock
      from public.eos_erp_productos p
      where p.id = v_producto;

      v_lleva_stock := coalesce(v_lleva_stock, false);
    end if;

    v_items := v_items || jsonb_build_object(
      'producto_id', v_producto,
      'descripcion', left(v_concepto, 200),
      'cantidad', v_cantidad,
      'precio_unitario', v_unitario,
      'iva', v_iva
    );

    v_detalle := v_detalle || jsonb_build_object(
      'concepto', v_concepto,
      'cantidad', v_cantidad,
      'total', round(v_cantidad * v_unitario),
      'en_catalogo', v_producto is not null,
      'mueve_stock', v_lleva_stock
    );
  end loop;

  v_proveedor := nullif(btrim(coalesce(p_datos ->> 'proveedor', p_datos ->> 'contacto', '')), '');
  if v_proveedor is not null then
    v_contacto := public.eos_crm_resolver_contacto(p_usuario_id, v_proveedor);
  end if;

  v_condicion := case when lower(coalesce(p_datos ->> 'condicion', '')) = 'credito' then 'credito' else 'contado' end;
  v_caja := nullif(btrim(coalesce(p_datos ->> 'caja', '')), '');

  v_fecha := case
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'fecha')::date
    else null
  end;

  v_rpc := public.eos_erp_registrar_compra(
    p_usuario_id,
    v_items,
    v_contacto,
    v_fecha,
    'PYG',
    v_condicion,
    v_condicion = 'contado',
    null,
    nullif(btrim(coalesce(p_datos ->> 'notas', '')), ''),
    -- Cuándo hay que pagar, si la persona lo dijo (v182). Al contado no aplica.
    public.eos_vencimiento_desde_datos_v182(p_datos, v_condicion),
    v_caja
  );

  v_compra_id := coalesce(
    (v_rpc ->> 'compra_id')::uuid,
    (v_rpc ->> 'id')::uuid,
    (v_rpc -> 'compra' ->> 'id')::uuid
  );

  if v_compra_id is null then
    raise exception 'EOS_ACCION_COMPRA_SIN_ID';
  end if;

  update public.eos_erp_compras
  set action_command_id = p_command_id
  where id = v_compra_id and usuario_id = p_usuario_id;

  return jsonb_build_object(
    'primero', v_compra_id,
    'compra', v_detalle,
    'total_compra', (v_rpc ->> 'total')::numeric,
    'condicion', v_condicion,
    'vence_el', (select c.vence_el from public.eos_erp_compras c where c.id = v_compra_id),
    'sin_catalogo', v_sin_catalogo,
    'proveedor', case when v_proveedor is null then null else jsonb_build_object(
      'nombre', v_proveedor,
      'agendado', v_contacto is not null
    ) end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.eos_erp_registrar_cobranza_v107(p_usuario_id uuid, p_venta_id uuid DEFAULT NULL::uuid, p_compra_id uuid DEFAULT NULL::uuid, p_monto numeric DEFAULT NULL::numeric, p_fecha date DEFAULT NULL::date, p_nota text DEFAULT NULL::text, p_caja_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_total numeric;
  v_moneda text;
  v_estado text;
  v_contacto uuid;
  v_saldo numeric;
  v_movimiento_id uuid;
  v_cobranza_id uuid;
  v_fecha date;
  v_es_venta boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if not (
    (p_venta_id is not null and p_compra_id is null)
    or (p_venta_id is null and p_compra_id is not null)
  ) then
    raise exception 'EOS_COBRANZA_DOCUMENTO_INVALIDO';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'EOS_COBRANZA_MONTO_INVALIDO';
  end if;

  -- NaN e Infinity pasan el `> 0` y arruinan toda suma posterior. Mismo
  -- control que ya hace el ajuste de stock.
  if p_monto = 'NaN'::numeric or p_monto = 'Infinity'::numeric then
    raise exception 'EOS_COBRANZA_MONTO_INVALIDO';
  end if;

  v_es_venta := p_venta_id is not null;
  v_fecha := coalesce(p_fecha, public.eos_hoy_py());

  -- Se bloquea la cabecera: dos cobros simultáneos del mismo documento
  -- podrían pasar los dos el control de saldo y dejar el documento sobrecobrado.
  if v_es_venta then
    select total, moneda, estado, contacto_id
      into v_total, v_moneda, v_estado, v_contacto
    from public.eos_erp_ventas
    where id = p_venta_id and public.eos_empresa_alcanza_v112(p_usuario_id, usuario_id)
    for update;
  else
    select total, moneda, estado, contacto_id
      into v_total, v_moneda, v_estado, v_contacto
    from public.eos_erp_compras
    where id = p_compra_id and public.eos_empresa_alcanza_v112(p_usuario_id, usuario_id)
    for update;
  end if;

  if not found then
    raise exception 'EOS_DOCUMENTO_NO_EXISTE';
  end if;

  if v_estado = 'anulada' then
    raise exception 'EOS_DOCUMENTO_ANULADO';
  end if;

  v_saldo := public.eos_erp_saldo_documento_v107(p_venta_id, p_compra_id);

  if v_saldo <= 0 then
    raise exception 'EOS_DOCUMENTO_SIN_SALDO';
  end if;

  -- Cobrar de más no es un redondeo: es plata que no corresponde a este
  -- documento y que después nadie va a saber de dónde salió.
  if p_monto > v_saldo then
    raise exception 'EOS_COBRANZA_EXCEDE_SALDO';
  end if;

  insert into public.eos_movimientos_financieros (
    usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, metadata, caja_id
  ) values (
    p_usuario_id,
    case when v_es_venta then 'ingreso' else 'gasto' end,
    p_monto,
    v_moneda,
    case when v_es_venta then 'Cobro de venta' else 'Pago de compra' end
      || coalesce(' — ' || (
        select c.nombre from public.eos_crm_contactos c where c.id = v_contacto
      ), '')
      || case when p_monto < v_saldo then ' (parcial)' else '' end,
    case when v_es_venta then 'ventas' else 'compras' end,
    v_fecha,
    'erp',
    jsonb_build_object('venta_id', p_venta_id, 'compra_id', p_compra_id, 'parcial', p_monto < v_saldo),
    p_caja_id
  )
  returning id into v_movimiento_id;

  insert into public.eos_erp_cuenta_movimientos_v107 (
    usuario_id, venta_id, compra_id, monto, moneda, fecha, movimiento_id, nota
  ) values (
    p_usuario_id, p_venta_id, p_compra_id, p_monto, v_moneda, v_fecha, v_movimiento_id, p_nota
  )
  returning id into v_cobranza_id;

  -- Con el saldo en cero el documento queda saldado. `movimiento_id` de la
  -- cabecera se deja NULL a propósito: no hay un movimiento único que
  -- represente el cobro, y apuntarlo al último sería mentir sobre el resto.
  if v_saldo - p_monto = 0 then
    if v_es_venta then
      update public.eos_erp_ventas set estado = 'cobrada', actualizado_en = now() where id = p_venta_id;
    else
      update public.eos_erp_compras set estado = 'pagada', actualizado_en = now() where id = p_compra_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'cobranza_id', v_cobranza_id,
    'movimiento_id', v_movimiento_id,
    'monto', p_monto,
    'saldo_anterior', v_saldo,
    'saldo_actual', v_saldo - p_monto,
    'saldado', v_saldo - p_monto = 0
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.eos_erp_cobranza_por_chat_v151(p_usuario_id uuid, p_command_id uuid, p_datos jsonb, p_es_venta boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_nombre text;
  v_contacto_id uuid;
  v_monto numeric;
  v_fecha date;
  v_moneda text;
  v_todo boolean;
  v_pendientes jsonb := '[]'::jsonb;
  v_doc record;
  v_total_pendiente numeric := 0;
  v_monedas text[];
  v_cuantos integer := 0;
  v_aplicado numeric := 0;
  v_este numeric;
  v_tocados jsonb := '[]'::jsonb;
  v_primero uuid;
  v_lista text;
  v_caja_nombre text;
  v_caja_id uuid;
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  v_nombre := nullif(btrim(coalesce(
    p_datos ->> 'contacto', p_datos ->> 'cliente', p_datos ->> 'proveedor',
    p_datos ->> 'nombre', ''
  )), '');

  if v_nombre is null then
    raise exception 'EOS_ACCION_COBRO_SIN_CONTACTO';
  end if;

  v_contacto_id := public.eos_crm_resolver_contacto(p_usuario_id, v_nombre);

  if v_contacto_id is null then
    raise exception 'EOS_ACCION_CONTACTO_NO_RESUELTO: %', v_nombre;
  end if;

  v_monto := public.eos_leer_monto(coalesce(
    p_datos ->> 'monto', p_datos ->> 'importe', p_datos ->> 'total', ''
  ));

  if v_monto is not null and v_monto <= 0 then
    raise exception 'EOS_ACCION_COBRO_MONTO_INVALIDO';
  end if;

  v_fecha := case
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'fecha')::date
    else public.eos_hoy_py()
  end;

  v_moneda := upper(nullif(btrim(coalesce(p_datos ->> 'moneda', '')), ''));
  if v_moneda is not null and length(v_moneda) <> 3 then v_moneda := null; end if;

  v_todo := coalesce((p_datos ->> 'todo')::boolean, false);

  -- ---------------------------------------------------------------
  -- Lo que está pendiente, de la más vieja a la más nueva
  -- ---------------------------------------------------------------
  if p_es_venta then
    select coalesce(jsonb_agg(x order by x ->> 'fecha', x ->> 'id'), '[]'::jsonb)
    into v_pendientes
    from (
      select jsonb_build_object(
        'id', v.id, 'fecha', v.fecha, 'total', v.total, 'moneda', v.moneda,
        'saldo', public.eos_erp_saldo_documento_v107(v.id, null)
      ) as x
      from public.eos_erp_ventas v
      where v.usuario_id = p_usuario_id
        and v.contacto_id = v_contacto_id
        and v.estado <> 'anulada'
        and public.eos_erp_saldo_documento_v107(v.id, null) > 0
    ) t;
  else
    select coalesce(jsonb_agg(x order by x ->> 'fecha', x ->> 'id'), '[]'::jsonb)
    into v_pendientes
    from (
      select jsonb_build_object(
        'id', c.id, 'fecha', c.fecha, 'total', c.total, 'moneda', c.moneda,
        'saldo', public.eos_erp_saldo_documento_v107(null, c.id)
      ) as x
      from public.eos_erp_compras c
      where c.usuario_id = p_usuario_id
        and c.contacto_id = v_contacto_id
        and c.estado <> 'anulada'
        and public.eos_erp_saldo_documento_v107(null, c.id) > 0
    ) t;
  end if;

  if jsonb_array_length(v_pendientes) = 0 then
    raise exception 'EOS_ACCION_COBRO_SIN_PENDIENTES: %', v_nombre;
  end if;

  /*
   * Nunca se suman monedas.
   *
   * Un cliente puede deber en guaraníes y en dólares. Sumar los dos saldos da
   * un número que no significa nada, y acá ese número decidiría cuánto se
   * cobra. Si no dijeron la moneda y hay más de una, se pregunta.
   */
  select array_agg(distinct d ->> 'moneda') into v_monedas
  from jsonb_array_elements(v_pendientes) d;

  if v_moneda is null then
    if array_length(v_monedas, 1) > 1 then
      raise exception 'EOS_ACCION_COBRO_VARIAS_MONEDAS: %', array_to_string(v_monedas, ', ');
    end if;
    v_moneda := v_monedas[1];
  end if;

  select coalesce(jsonb_agg(d order by d ->> 'fecha', d ->> 'id'), '[]'::jsonb)
  into v_pendientes
  from jsonb_array_elements(v_pendientes) d
  where d ->> 'moneda' = v_moneda;

  if jsonb_array_length(v_pendientes) = 0 then
    raise exception 'EOS_ACCION_COBRO_SIN_PENDIENTES: %', v_nombre;
  end if;

  -- Caja: opcional, resuelta una sola vez para todo el cobro (puede tocar
  -- varios documentos en el loop de abajo).
  v_caja_nombre := nullif(btrim(coalesce(p_datos ->> 'caja', '')), '');
  if v_caja_nombre is not null then
    v_caja_id := public.eos_resolver_caja_v240(public.eos_empresa_de_v109(p_usuario_id), v_caja_nombre, v_moneda);
  end if;

  v_cuantos := jsonb_array_length(v_pendientes);

  select sum((d ->> 'saldo')::numeric) into v_total_pendiente
  from jsonb_array_elements(v_pendientes) d;

  -- ---------------------------------------------------------------
  -- Cuánto se aplica
  -- ---------------------------------------------------------------
  if v_monto is null then
    if v_todo or v_cuantos = 1 then
      v_monto := v_total_pendiente;
    else
      /*
       * Con varias pendientes y sin monto NO se elige.
       *
       * "Me pagó la factura" de alguien que tiene tres es una frase
       * incompleta, y completarla por él deja escrito un ingreso que sí
       * ocurrió contra el documento que no era. Se devuelven las tres con su
       * fecha y su importe: contesta con una y listo.
       */
      select string_agg((d ->> 'fecha') || ':' || (d ->> 'saldo'), ';' order by d ->> 'fecha')
      into v_lista
      from jsonb_array_elements(v_pendientes) d;

      raise exception 'EOS_ACCION_COBRO_VARIOS_PENDIENTES: %|%', v_moneda, v_lista;
    end if;
  end if;

  /*
   * De más, nunca.
   *
   * Un monto mayor a lo que se debe es casi siempre un cero de más al
   * escribir. Dejarlo pasar produce un saldo a favor que no se parece a un
   * error: se parece a un anticipo, y nadie lo revisa.
   */
  if v_monto > v_total_pendiente then
    raise exception 'EOS_ACCION_COBRO_EXCEDE: %|%', v_moneda, v_total_pendiente;
  end if;

  -- ---------------------------------------------------------------
  -- La más vieja primero
  -- ---------------------------------------------------------------
  for v_doc in
    select
      (d ->> 'id')::uuid as id,
      (d ->> 'fecha')::date as fecha,
      (d ->> 'saldo')::numeric as saldo
    from jsonb_array_elements(v_pendientes) d
    order by d ->> 'fecha', d ->> 'id'
  loop
    exit when v_aplicado >= v_monto;

    v_este := least(v_doc.saldo, v_monto - v_aplicado);
    if v_este <= 0 then continue; end if;

    perform public.eos_erp_registrar_cobranza_v107(
      p_usuario_id,
      case when p_es_venta then v_doc.id else null end,
      case when p_es_venta then null else v_doc.id end,
      v_este,
      v_fecha,
      'Registrado por EOS desde la conversación.',
      v_caja_id
    );

    -- La marca de idempotencia, sobre el movimiento que se acaba de crear.
    update public.eos_erp_cuenta_movimientos_v107 m
    set action_command_id = p_command_id
    where m.usuario_id = p_usuario_id
      and m.action_command_id is null
      and ((p_es_venta and m.venta_id = v_doc.id) or (not p_es_venta and m.compra_id = v_doc.id))
      and m.monto = v_este
      and m.fecha = v_fecha;

    v_aplicado := v_aplicado + v_este;

    if v_primero is null then v_primero := v_doc.id; end if;

    v_tocados := v_tocados || jsonb_build_array(jsonb_build_object(
      'id', v_doc.id,
      'fecha', v_doc.fecha,
      'aplicado', v_este,
      'saldaba', v_este >= v_doc.saldo
    ));
  end loop;

  return jsonb_build_object(
    'id', v_primero,
    'es_venta', p_es_venta,
    'contacto', v_nombre,
    'moneda', v_moneda,
    'aplicado', v_aplicado,
    'documentos', v_tocados,
    'cerrados', (
      select count(*) from jsonb_array_elements(v_tocados) d where (d ->> 'saldaba')::boolean
    ),
    -- Lo que queda debiendo DESPUÉS de este cobro. Es el dato que la persona
    -- necesita en la misma frase: si cobró parcial, cuánto falta.
    'resta', v_total_pendiente - v_aplicado,
    'pendientes_antes', v_cuantos
  );
end;
$function$
;

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
  v_titulo text;
  v_contenido text;
  v_clave text;
  v_importancia integer;
  v_memoria_previa uuid;
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
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA', 'REGISTRAR_OPORTUNIDAD', 'CREAR_DECISION', 'ANULAR_VENTA', 'CORREGIR_VENTA',
    'ANULAR_COMPRA', 'CORREGIR_COMPRA', 'ENVIAR_WHATSAPP_CLIENTE'
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

    -- Un reintento del mismo comando no crea nada nuevo ni cuenta otra
    -- observación: o la memoria nació de este comando, o ya lo anotó en
    -- `metadata.comandos` cuando lo volvió a observar.
    select m.id into v_effect_id
    from public.eos_memory m
    where m.usuario_id = v_command.usuario_id
      and (
        m.action_command_id = v_command.id
        or jsonb_exists(m.metadata -> 'comandos', v_command.id::text)
      )
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_titulo := left(coalesce(nullif(btrim(v_data ->> 'titulo'), ''), 'Dato importante'), 180);
      v_contenido := coalesce(nullif(btrim(v_data ->> 'contenido'), ''), nullif(btrim(v_data ->> 'texto'), ''), nullif(btrim(v_data ->> 'descripcion'), ''), v_message);
      v_importancia := case
        when coalesce(v_data ->> 'importancia', '') ~ '^\d+$'
          then greatest(1, least(10, (v_data ->> 'importancia')::integer))
        else 5
      end;
      v_clave := lower(regexp_replace(btrim(v_titulo), '\s+', ' ', 'g'));

      -- Dos comandos simultáneos con el mismo título no se pisan: el segundo
      -- espera y ya encuentra la memoria que creó el primero.
      perform pg_advisory_xact_lock(
        hashtextextended('eos-memoria:' || v_command.usuario_id::text || ':' || v_clave, 0)
      );

      -- Solo memorias ACTIVAS: una que la persona archivó no se revive.
      select m.id into v_memoria_previa
      from public.eos_memory m
      where m.usuario_id = v_command.usuario_id
        and m.estado = 'activo'
        and lower(regexp_replace(btrim(m.titulo), '\s+', ' ', 'g')) = v_clave
      order by m.created_at
      limit 1;

      if v_memoria_previa is not null then
        -- Ya la sabía: se REOBSERVA en vez de duplicarla. Gana el dato más
        -- nuevo, y el anterior queda en metadata para poder ver qué cambió.
        update public.eos_memory m
        set contenido = case
              when v_contenido is not null and v_contenido is distinct from m.contenido then v_contenido
              else m.contenido
            end,
            importancia = greatest(m.importancia, v_importancia),
            observaciones = m.observaciones + 1,
            ultima_observacion_at = now(),
            updated_at = now(),
            metadata = m.metadata
              || case
                   when v_contenido is not null and v_contenido is distinct from m.contenido
                     then jsonb_build_object('contenido_anterior', m.contenido)
                   else '{}'::jsonb
                 end
              || jsonb_build_object(
                   'comandos',
                   case
                     when jsonb_array_length(coalesce(m.metadata -> 'comandos', '[]'::jsonb)) < 100
                       then coalesce(m.metadata -> 'comandos', '[]'::jsonb) || to_jsonb(v_command.id::text)
                     else m.metadata -> 'comandos'
                   end
                 )
        where m.id = v_memoria_previa
        returning m.id into v_effect_id;

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
          v_titulo,
          left(coalesce(nullif(btrim(v_data ->> 'categoria'), ''), 'general'), 80),
          v_contenido,
          v_importancia,
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
        'Cargada por EOS desde la conversación.',
        -- Cuándo cobra, si la persona lo dijo (v182). Al contado no aplica.
        public.eos_vencimiento_desde_datos_v182(
          v_data,
          case when v_data ->> 'condicion' = 'credito' then 'credito' else 'contado' end
        ),
        nullif(btrim(coalesce(v_data ->> 'caja', '')), '')
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
             'sin_costo', v_sin_costo,
             -- Para que la respuesta diga cuándo vence (v182).
             'condicion', case when v_data ->> 'condicion' = 'credito' then 'credito' else 'contado' end,
             'vence_el', (select v.vence_el from public.eos_erp_ventas v where v.id = v_effect_id)
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

  elsif v_command.accion = 'CREAR_DECISION' then
    v_effect_type := 'decision';

    /*
     * Misma idempotencia que REGISTRAR_OPORTUNIDAD: se busca por
     * action_command_id ANTES de llamar a la función, no adentro. Una
     * decisión no se "avanza" como una oportunidad, así que un reintento
     * tiene que devolver la misma fila siempre, nunca una fila distinta.
     */
    select d.id into v_effect_id
    from public.eos_decisions d
    where d.usuario_id = v_command.usuario_id
      and d.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_crm_crear_decision_v236(
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

  elsif v_command.accion = 'ENVIAR_WHATSAPP_CLIENTE' then
    v_effect_type := 'whatsapp_cliente';

    /*
     * ACÁ SOLO SE VALIDA; EL ENVÍO LO HACE EL SERVIDOR.
     *
     * Mandarle un mensaje a un cliente es hablar con un tercero por el canal de la
     * empresa: hay que llamar a Meta con el token de Vault, aplicar la política de
     * la ventana de 24 horas, la baja del cliente y el tope diario, y registrar el
     * mensaje con su motivo si no salió. Todo eso vive en el código que también usa
     * la pantalla (`lib/whatsapp-crm/enviar.ts`), y duplicarlo acá sería tener dos
     * políticas distintas para el mismo mensaje.
     *
     * Lo que SÍ se resuelve acá, antes de dar la orden por cumplida, son los
     * errores que la persona puede corregir en la misma frase: a qué cliente, qué
     * decirle, que haya canal, que tenga teléfono y que no haya pedido la baja.
     *
     * No crea nada por su cuenta, así que un reintento no duplica nada; el envío
     * es idempotente por la clave del comando.
     */
    v_rpc := public.eos_crm_preparar_envio_por_chat_v186(
      v_command.usuario_id,
      v_command.id,
      v_data
    );

    v_effect_id := (v_rpc ->> 'contacto_id')::uuid;
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
    'executor_version', 'v186'
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
$function$
;
