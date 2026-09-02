-- ============================================================
-- v105 · Corregir un costo que se cargó mal
-- ============================================================
--
-- POR QUÉ
--
-- Lo pidió Sofía, que usa EOS para su negocio: "poder editar si cargué mal el
-- costo". Hoy no se puede, y el motivo es una decisión correcta que deja un
-- agujero.
--
-- Desde la v100 cada línea de venta congela el costo que el producto tenía en
-- ese momento. Es lo correcto: si mañana sube el proveedor, la venta de ayer
-- no puede cambiar de margen sola. Pero significa que un costo mal tipeado
-- queda mal para siempre, y arreglar la ficha del producto no arregla las
-- ventas ya hechas. El margen sigue mintiendo y no hay forma de corregirlo.
--
-- Esta función es esa forma. Corregir un error de carga no es reescribir la
-- historia: es escribirla bien.
--
-- ============================================================
-- QUÉ NO HACE
-- ============================================================
--
-- No toca el precio de venta, ni las cantidades, ni el total, ni el stock, ni
-- el movimiento de dinero. Solo el costo, que es lo único que no tiene otro
-- camino de corrección.
--
-- Cambiar el precio o la cantidad de una venta ya registrada movería plata y
-- mercadería que ya se contaron en otros lados. Para eso está anular y
-- volver a cargar, que deja rastro de las dos cosas.
--
-- ============================================================
-- Y ARREGLA TAMBIÉN EL PRODUCTO
-- ============================================================
--
-- Con `p_actualizar_producto`, porque quien se equivocó al cargar el costo lo
-- tiene mal en la ficha también, y la próxima venta repetiría el error. Es
-- opcional y no por prolijidad: si el costo REALMENTE cambió después —subió el
-- proveedor— corregir la venta vieja no debe pisar el costo actual.

alter table public.eos_auditoria_v60
  drop constraint if exists eos_auditoria_v60_evento_check;

alter table public.eos_auditoria_v60
  add constraint eos_auditoria_v60_evento_check
  check (evento = any (array[
    'correo_recibido', 'movimiento_ingerido', 'movimiento_descartado',
    'movimiento_confirmado', 'accion_autorizada', 'accion_rechazada',
    'datos_exportados', 'conciliacion_registrada',
    'venta_registrada', 'venta_cobrada', 'venta_anulada',
    'compra_registrada', 'compra_pagada', 'compra_anulada',
    'stock_ajustado', 'producto_modificado', 'comprobante_emitido',
    'costo_corregido'
  ]));

create or replace function public.eos_erp_corregir_costo_venta_v105(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_costos jsonb,
  p_actualizar_producto boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_venta public.eos_erp_ventas%rowtype;
  v_item public.eos_erp_venta_items%rowtype;
  v_entrada jsonb;
  v_costo numeric;
  v_antes jsonb := '[]'::jsonb;
  v_despues jsonb := '[]'::jsonb;
  v_tocados int := 0;
  v_productos int := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_venta
  from public.eos_erp_ventas
  where id = p_venta_id and usuario_id = p_usuario_id;

  if not found then
    raise exception 'EOS_VENTA_NO_EXISTE';
  end if;

  -- Una venta anulada no tiene margen que corregir: no cuenta en ningún lado.
  if v_venta.estado = 'anulada' then
    raise exception 'EOS_VENTA_ANULADA';
  end if;

  if jsonb_typeof(p_costos) is distinct from 'array' or jsonb_array_length(p_costos) = 0 then
    raise exception 'EOS_COSTOS_VACIOS';
  end if;

  for v_entrada in select * from jsonb_array_elements(p_costos)
  loop
    select * into v_item
    from public.eos_erp_venta_items
    where id = (v_entrada ->> 'item_id')::uuid
      and venta_id = p_venta_id;

    if not found then
      raise exception 'EOS_ITEM_NO_EXISTE: %', coalesce(v_entrada ->> 'item_id', '(sin id)');
    end if;

    -- Vacío es "no sé cuánto costó", que es distinto de cero. Cero mostraría
    -- 100% de margen, que es el número más caro que puede mostrar un sistema.
    v_costo := nullif(btrim(coalesce(v_entrada ->> 'costo_unitario', '')), '')::numeric;

    if v_costo is not null and (v_costo < 0 or v_costo = 'NaN'::numeric) then
      raise exception 'EOS_COSTO_INVALIDO';
    end if;

    if v_costo is not distinct from v_item.costo_unitario then
      continue;
    end if;

    v_antes := v_antes || jsonb_build_array(jsonb_build_object(
      'descripcion', v_item.descripcion, 'costo_unitario', v_item.costo_unitario
    ));
    v_despues := v_despues || jsonb_build_array(jsonb_build_object(
      'descripcion', v_item.descripcion, 'costo_unitario', v_costo
    ));

    update public.eos_erp_venta_items
    set costo_unitario = v_costo,
        -- Ya no es una estimación: lo escribió una persona a mano.
        costo_estimado = false
    where id = v_item.id;

    v_tocados := v_tocados + 1;

    if p_actualizar_producto and v_item.producto_id is not null and v_costo is not null then
      update public.eos_erp_productos
      set costo = v_costo,
          actualizado_en = now()
      where id = v_item.producto_id
        and usuario_id = p_usuario_id
        and costo is distinct from v_costo;

      if found then
        v_productos := v_productos + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'items_corregidos', v_tocados,
    'productos_actualizados', v_productos,
    'antes', v_antes,
    'despues', v_despues
  );
end $$;

revoke all on function public.eos_erp_corregir_costo_venta_v105(uuid, uuid, jsonb, boolean)
  from public, anon, authenticated;

grant execute on function public.eos_erp_corregir_costo_venta_v105(uuid, uuid, jsonb, boolean)
  to service_role;

comment on function public.eos_erp_corregir_costo_venta_v105(uuid, uuid, jsonb, boolean) is
  'Corrige el costo congelado de las líneas de una venta, y opcionalmente el costo del producto. No toca precio, cantidad, total, stock ni movimientos.';
