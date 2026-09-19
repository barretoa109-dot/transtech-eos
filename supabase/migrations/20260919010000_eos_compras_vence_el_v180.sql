-- v180: las compras a crédito pueden llevar su vencimiento, y EOS avisa de los
-- pagos a proveedores vencidos o por vencer.
--
-- ============================================================
-- EL HUECO
-- ============================================================
--
-- `eos_erp_compras.vence_el` existe desde la cuenta corriente (v107) y la
-- pantalla de cartera ya lee "por pagar" con él, pero NADA lo escribía: ni
-- `eos_erp_registrar_compra`, ni la pantalla, ni el chat. Toda compra a
-- crédito quedaba "sin vencimiento" para siempre, y el panel no podía decir
-- "esta semana le tenés que pagar a Molino Sur". Es la mitad simétrica de lo
-- que la v168 hizo con las ventas.
--
-- ============================================================
-- QUÉ HACE
-- ============================================================
--
--   1. `eos_erp_registrar_compra` recibe `p_vence_el` (opcional, al final).
--      Al contado se ignora, igual que en las ventas.
--   2. `eos_erp_editar_compra` lo recibe también y, si no viene, CONSERVA el de
--      la compra original — el mismo defecto que la v178 arregló en las ventas:
--      corregir una cantidad no puede borrar un plazo pactado. Esto cubre de
--      paso a CORREGIR_COMPRA por chat (v170), que la llama sin vencimiento.
--   3. `eos_negocio_avisos` acepta el tipo `pagos_a_proveedores`, para que el
--      cron guarde el último aviso y no lo repita todos los días.
--
-- Las definiciones salen de `pg_get_functiondef` de producción y no de las
-- migraciones del repo: la base va por delante. Solo cambia lo dicho arriba.
--
-- Es un parámetro NUEVO: `create or replace` dejaría las dos firmas conviviendo
-- y una llamada con los argumentos viejos sería ambigua. Por eso se borran las
-- firmas anteriores primero y se vuelven a dar los permisos (un `drop` los
-- pierde). Quienes llaman con los argumentos de antes —los ejecutores del chat
-- de la v134/v135 y la v170— siguen funcionando: el nuevo es opcional.
--
-- ORDEN: se aplica ANTES de desplegar el código que manda `p_vence_el` y el
-- aviso `pagos_a_proveedores`.

drop function if exists public.eos_erp_registrar_compra(uuid, jsonb, uuid, date, text, text, boolean, text, text);
drop function if exists public.eos_erp_editar_compra(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text, text);

CREATE OR REPLACE FUNCTION public.eos_erp_registrar_compra(p_usuario_id uuid, p_items jsonb, p_contacto_id uuid DEFAULT NULL::uuid, p_fecha date DEFAULT NULL::date, p_moneda text DEFAULT 'PYG'::text, p_condicion text DEFAULT 'contado'::text, p_pagada boolean DEFAULT false, p_numero_comprobante text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_vence_el date DEFAULT NULL::date)
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
$function$;

CREATE OR REPLACE FUNCTION public.eos_erp_editar_compra(p_usuario_id uuid, p_compra_id uuid, p_items jsonb, p_contacto_id uuid DEFAULT NULL::uuid, p_fecha date DEFAULT NULL::date, p_moneda text DEFAULT 'PYG'::text, p_condicion text DEFAULT 'contado'::text, p_pagada boolean DEFAULT false, p_numero_comprobante text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text, p_vence_el date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_estado_actual text;
  v_vence_original date;
  v_registro jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select estado, vence_el into v_estado_actual, v_vence_original
  from public.eos_erp_compras
  where id = p_compra_id and usuario_id = p_usuario_id;

  if not found then
    raise exception 'EOS_COMPRA_NO_EXISTE';
  end if;

  if v_estado_actual = 'anulada' then
    raise exception 'EOS_COMPRA_YA_ANULADA';
  end if;

  -- Devuelve el stock, restaura el costo anterior del producto y borra el
  -- gasto vinculado. Nada de esto se repite acá: ver el porqué arriba.
  perform public.eos_erp_anular_compra(
    p_usuario_id, p_compra_id, coalesce(nullif(btrim(p_motivo), ''), 'Editada')
  );

  v_registro := public.eos_erp_registrar_compra(
    p_usuario_id, p_items, p_contacto_id, p_fecha, p_moneda, p_condicion,
    p_pagada, p_numero_comprobante, p_notas,
    -- Nuevo si lo hay; si no, el que ya tenía: corregir un número no puede
    -- borrar un plazo pactado con el proveedor.
    coalesce(p_vence_el, v_vence_original)
  );

  return jsonb_build_object(
    'ok', true,
    'compra_anterior_id', p_compra_id,
    'compra_id', v_registro ->> 'compra_id',
    'subtotal', v_registro -> 'subtotal',
    'iva_total', v_registro -> 'iva_total',
    'total', v_registro -> 'total'
  );
end;
$function$;

revoke all on function public.eos_erp_registrar_compra(uuid, jsonb, uuid, date, text, text, boolean, text, text, date)
  from public, anon, authenticated;
grant execute on function public.eos_erp_registrar_compra(uuid, jsonb, uuid, date, text, text, boolean, text, text, date)
  to service_role, postgres;

revoke all on function public.eos_erp_editar_compra(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text, text, date)
  from public, anon, authenticated;
grant execute on function public.eos_erp_editar_compra(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text, text, date)
  to service_role, postgres;

-- El aviso proactivo de pagos a proveedores (ver lib/erp/riesgos-negocio.ts).
alter table public.eos_negocio_avisos
  drop constraint if exists eos_negocio_avisos_tipo_check;

alter table public.eos_negocio_avisos
  add constraint eos_negocio_avisos_tipo_check
  check (tipo in ('inventario_bajo', 'cobros_demorados', 'gasto_anormal', 'stock_por_agotarse', 'pagos_a_proveedores'));
