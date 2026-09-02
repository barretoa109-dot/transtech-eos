-- ============================================================
-- v106 · Corregir los importes de una compra ya registrada
-- ============================================================
--
-- POR QUÉ
--
-- La compra es donde entra el costo. Si alguien tipea 1.012.000 donde eran
-- 1.021.000, ese número se convierte en el costo del producto, en el margen de
-- todo lo que se venda después, y en un gasto del panel financiero. Hoy la
-- única salida es anular y volver a cargar la compra entera.
--
-- Esta función corrige los precios sin deshacer nada.
--
-- ============================================================
-- LOS PRECIOS SÍ, LAS CANTIDADES NO
-- ============================================================
--
-- Es la línea que hace que esto sea seguro. Cambiar un precio mueve plata:
-- el total de la compra y, si está pagada, su gasto — dos cosas que esta
-- función actualiza en la misma transacción, así que no pueden quedar
-- discrepando.
--
-- Cambiar una CANTIDAD movería mercadería. El stock ya se sumó al registrar la
-- compra, y volver a tocarlo desde acá dejaría el saldo sin la fila
-- correspondiente en `eos_erp_movimientos_stock` — que es justamente el rastro
-- que permite explicar por qué el sistema dice 12 y en el estante hay 9. Para
-- eso está anular y volver a cargar, que deja las dos huellas.
--
-- Mismo criterio que la v105 en ventas: se corrige lo que no tiene otro
-- camino, y no se abre una puerta trasera a lo que ya se contó en otro lado.

create or replace function public.eos_erp_corregir_compra_v106(
  p_usuario_id uuid,
  p_compra_id uuid,
  p_precios jsonb,
  p_actualizar_producto boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_compra public.eos_erp_compras%rowtype;
  v_item public.eos_erp_compra_items%rowtype;
  v_entrada jsonb;
  v_precio numeric;
  v_total_linea numeric;
  v_antes jsonb := '[]'::jsonb;
  v_despues jsonb := '[]'::jsonb;
  v_tocados int := 0;
  v_productos int := 0;
  v_subtotal numeric := 0;
  v_iva_total numeric := 0;
  v_total numeric := 0;
  v_iva_monto numeric;
  v_total_previo numeric;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_compra
  from public.eos_erp_compras
  where id = p_compra_id and usuario_id = p_usuario_id;

  if not found then
    raise exception 'EOS_COMPRA_NO_EXISTE';
  end if;

  if v_compra.estado = 'anulada' then
    raise exception 'EOS_COMPRA_ANULADA';
  end if;

  if jsonb_typeof(p_precios) is distinct from 'array' or jsonb_array_length(p_precios) = 0 then
    raise exception 'EOS_PRECIOS_VACIOS';
  end if;

  v_total_previo := v_compra.total;

  for v_entrada in select * from jsonb_array_elements(p_precios)
  loop
    select * into v_item
    from public.eos_erp_compra_items
    where id = (v_entrada ->> 'item_id')::uuid
      and compra_id = p_compra_id;

    if not found then
      raise exception 'EOS_ITEM_NO_EXISTE: %', coalesce(v_entrada ->> 'item_id', '(sin id)');
    end if;

    v_precio := nullif(btrim(coalesce(v_entrada ->> 'precio_unitario', '')), '')::numeric;

    -- Una compra sin precio no existe: algo se pagó. Cero se admite —hay
    -- muestras y bonificaciones— pero vacío no.
    if v_precio is null or v_precio < 0 or v_precio = 'NaN'::numeric then
      raise exception 'EOS_PRECIO_INVALIDO';
    end if;

    if v_precio is distinct from v_item.precio_unitario then
      v_antes := v_antes || jsonb_build_array(jsonb_build_object(
        'descripcion', v_item.descripcion, 'precio_unitario', v_item.precio_unitario
      ));
      v_despues := v_despues || jsonb_build_array(jsonb_build_object(
        'descripcion', v_item.descripcion, 'precio_unitario', v_precio
      ));

      v_total_linea := round(v_precio * v_item.cantidad, 2);

      update public.eos_erp_compra_items
      set precio_unitario = v_precio,
          total = v_total_linea
      where id = v_item.id;

      v_tocados := v_tocados + 1;

      if p_actualizar_producto and v_item.producto_id is not null then
        update public.eos_erp_productos
        set costo = v_precio,
            actualizado_en = now()
        where id = v_item.producto_id
          and usuario_id = p_usuario_id
          and costo is distinct from v_precio;

        if found then
          v_productos := v_productos + 1;
        end if;
      end if;
    end if;
  end loop;

  /*
   * Los totales se recalculan desde las líneas, no se ajustan por diferencia.
   *
   * Sumar el delta sería más corto y arrastraría para siempre cualquier
   * redondeo que ya estuviera mal. Recalcular desde cero hace que la cabecera
   * sea, por construcción, la suma de lo que se ve debajo.
   *
   * El IVA se saca de adentro con los mismos divisores que usa el resto del
   * sistema: 11 para el 10%, 21 para el 5%.
   */
  for v_item in
    select * from public.eos_erp_compra_items where compra_id = p_compra_id
  loop
    v_iva_monto := case
      when v_item.iva = 10 then round(v_item.total / 11)
      when v_item.iva = 5 then round(v_item.total / 21)
      else 0
    end;

    v_subtotal := v_subtotal + (v_item.total - v_iva_monto);
    v_iva_total := v_iva_total + v_iva_monto;
    v_total := v_total + v_item.total;
  end loop;

  update public.eos_erp_compras
  set subtotal = v_subtotal,
      iva_total = v_iva_total,
      total = v_total,
      actualizado_en = now()
  where id = p_compra_id;

  /*
   * Y el gasto, si la compra estaba pagada.
   *
   * En la misma transacción a propósito. Un total corregido con un gasto
   * viejo colgando es peor que no haber corregido nada: el panel financiero
   * mostraría una plata que no coincide con ningún documento.
   */
  if v_compra.movimiento_id is not null and v_total is distinct from v_total_previo then
    update public.eos_movimientos_financieros
    set monto = v_total,
        updated_at = now()
    where id = v_compra.movimiento_id
      and usuario_id = p_usuario_id;
  end if;

  return jsonb_build_object(
    'items_corregidos', v_tocados,
    'productos_actualizados', v_productos,
    'total_anterior', v_total_previo,
    'total', v_total,
    'movimiento_actualizado',
      v_compra.movimiento_id is not null and v_total is distinct from v_total_previo,
    'antes', v_antes,
    'despues', v_despues
  );
end $$;

revoke all on function public.eos_erp_corregir_compra_v106(uuid, uuid, jsonb, boolean)
  from public, anon, authenticated;

grant execute on function public.eos_erp_corregir_compra_v106(uuid, uuid, jsonb, boolean)
  to service_role;

comment on function public.eos_erp_corregir_compra_v106(uuid, uuid, jsonb, boolean) is
  'Corrige los precios de una compra, recalcula sus totales y su gasto asociado. No toca cantidades ni stock: para eso, anular y volver a cargar.';
