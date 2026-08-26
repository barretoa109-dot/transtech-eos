-- EOS ERP — registrar una compra entera, o ninguna
--
-- El espejo de `eos_erp_registrar_venta` (v69), con tres diferencias que no son
-- de forma:
--
--  1. **El stock ENTRA en vez de salir.** Una compra repone.
--  2. **El movimiento financiero es un GASTO**, no un ingreso.
--  3. **No hay "cobrada": hay "pagada".** Una compra a crédito es plata que
--     todavía no salió, y anotarla como gasto haría que el panel muestre menos
--     disponible del que hay — el error simétrico al de la venta a crédito.
--
-- El resto del razonamiento es el mismo: cinco escrituras sin transacción dejan
-- el inventario y el panel financiero mintiendo a medias, y ninguno de los dos
-- se corrige solo porque nadie sabe que quedó a medias.
--
-- ============================================================
-- POR QUÉ UNA COMPRA ACTUALIZA EL COSTO DEL PRODUCTO
-- ============================================================
--
-- Sin costo actualizado, el margen que muestre cualquier informe es el del día
-- que se cargó el producto. En Paraguay los precios de reposición se mueven
-- seguido, y un margen calculado con el costo de hace seis meses no es un
-- número impreciso: es un número que hace vender a pérdida creyendo que se gana.
--
-- Se guarda el ÚLTIMO costo y no un promedio ponderado a propósito: el promedio
-- necesita historia completa de existencias para no mentir, y acá el stock
-- puede haber empezado en cualquier número declarado a ojo.

create or replace function public.eos_erp_registrar_compra(
  p_usuario_id uuid,
  p_items jsonb,
  p_contacto_id uuid default null,
  p_fecha date default null,
  p_moneda text default 'PYG',
  p_condicion text default 'contado',
  p_pagada boolean default false,
  p_numero_comprobante text default null,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_fecha date := coalesce(p_fecha, current_date);
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
    usuario_id, contacto_id, fecha, moneda, numero_comprobante, condicion, estado, notas
  ) values (
    p_usuario_id, p_contacto_id, v_fecha, coalesce(p_moneda, 'PYG'), p_numero_comprobante,
    case when p_condicion = 'credito' then 'credito' else 'contado' end,
    case when p_pagada then 'pagada' else 'registrada' end,
    p_notas
  )
  returning id into v_compra_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto := null;

    if (v_item ->> 'producto_id') is not null then
      select * into v_producto
      from public.eos_erp_productos
      where id = (v_item ->> 'producto_id')::uuid
        and usuario_id = p_usuario_id
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
    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, metadata
    ) values (
      p_usuario_id, 'gasto', v_total_compra, coalesce(p_moneda, 'PYG'),
      'Compra' || coalesce(' — ' || (
        select c.nombre from public.eos_crm_contactos c where c.id = p_contacto_id
      ), ''),
      'compras', v_fecha, 'erp',
      jsonb_build_object('compra_id', v_compra_id)
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
$$;

revoke all on function public.eos_erp_registrar_compra(uuid, jsonb, uuid, date, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_registrar_compra(uuid, jsonb, uuid, date, text, text, boolean, text, text)
  to service_role;

comment on function public.eos_erp_registrar_compra(uuid, jsonb, uuid, date, text, text, boolean, text, text) is
  'Registra una compra entera: cabecera, ítems, stock, costo del producto y el gasto en Finanzas. O pasa todo o no pasa nada.';

-- ============================================================
-- Pagar una compra que se hizo a crédito
-- ============================================================

create or replace function public.eos_erp_pagar_compra(
  p_usuario_id uuid,
  p_compra_id uuid,
  p_fecha date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_compra public.eos_erp_compras%rowtype;
  v_movimiento_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_compra
  from public.eos_erp_compras
  where id = p_compra_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_COMPRA_NO_EXISTE';
  end if;

  if v_compra.estado = 'anulada' then
    raise exception 'EOS_COMPRA_ANULADA';
  end if;

  -- Idempotente por el mismo motivo que el cobro de una venta: un doble clic no
  -- puede descontarle plata dos veces a nadie.
  if v_compra.movimiento_id is not null then
    return jsonb_build_object(
      'ok', true, 'ya_estaba', true,
      'compra_id', v_compra.id, 'movimiento_id', v_compra.movimiento_id
    );
  end if;

  insert into public.eos_movimientos_financieros (
    usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, metadata
  ) values (
    p_usuario_id, 'gasto', v_compra.total, v_compra.moneda,
    'Pago de compra' || coalesce(' — ' || (
      select c.nombre from public.eos_crm_contactos c where c.id = v_compra.contacto_id
    ), ''),
    'compras', coalesce(p_fecha, current_date), 'erp',
    jsonb_build_object('compra_id', v_compra.id)
  )
  returning id into v_movimiento_id;

  update public.eos_erp_compras
  set estado = 'pagada',
      movimiento_id = v_movimiento_id,
      actualizado_en = now()
  where id = v_compra.id;

  return jsonb_build_object(
    'ok', true, 'ya_estaba', false,
    'compra_id', v_compra.id, 'movimiento_id', v_movimiento_id
  );
end;
$$;

revoke all on function public.eos_erp_pagar_compra(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.eos_erp_pagar_compra(uuid, uuid, date) to service_role;
