-- EOS ERP — registrar una venta entera, o ninguna
--
-- ============================================================
-- POR QUÉ ESTO ES UNA FUNCIÓN Y NO CINCO CONSULTAS
-- ============================================================
--
-- Registrar una venta toca cinco cosas: la cabecera, los ítems, el stock de
-- cada producto, el historial de movimientos de stock y —si se cobró— el
-- ingreso en Finanzas.
--
-- Hecho desde la aplicación son cinco viajes sin transacción. Si el tercero
-- falla queda una venta con ítems, el stock descontado a medias y ningún
-- ingreso: el inventario miente y el panel financiero también. Y ninguno de los
-- dos se corrige solo, porque nadie sabe que quedó a medias.
--
-- Acá adentro, o pasa todo o no pasa nada.
--
-- Como efecto secundario, esto le da a EOS una sola puerta para registrar una
-- venta desde el chat: "vendí tres cajas a Rossana" es una llamada, no cinco.

-- ============================================================
-- 1) De dónde salió un movimiento financiero
-- ============================================================
--
-- `origen` distingue lo que el usuario cargó a mano de lo que EOS vio. Una
-- venta del ERP no es ninguna de las dos: no la tipeó nadie en el panel de
-- finanzas y tampoco llegó por correo. Sin su propio valor, o miente diciendo
-- 'manual' —y ensucia la métrica de "cuánto de esto es carga manual", que es la
-- que mide si EOS está cumpliendo su promesa— o queda fuera del check.

alter table public.eos_movimientos_financieros
  drop constraint if exists eos_movimientos_financieros_origen_check;

alter table public.eos_movimientos_financieros
  add constraint eos_movimientos_financieros_origen_check
  check (origen in ('manual', 'documento', 'chat', 'integracion', 'estimado', 'erp'));

comment on column public.eos_movimientos_financieros.origen is
  'Procedencia del movimiento. "manual" debe ser excepción. "erp" es una venta o compra registrada en el módulo de gestión.';

-- ============================================================
-- 2) La venta
-- ============================================================

create or replace function public.eos_erp_registrar_venta(
  p_usuario_id uuid,
  p_items jsonb,
  p_contacto_id uuid default null,
  p_fecha date default null,
  p_moneda text default 'PYG',
  p_condicion text default 'contado',
  p_cobrada boolean default false,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_fecha date := coalesce(p_fecha, current_date);
  v_estado text;
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
    usuario_id, contacto_id, fecha, moneda, condicion, estado, notas
  ) values (
    p_usuario_id, p_contacto_id, v_fecha, coalesce(p_moneda, 'PYG'),
    case when p_condicion = 'credito' then 'credito' else 'contado' end,
    v_estado, p_notas
  )
  returning id into v_venta_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto := null;

    if (v_item ->> 'producto_id') is not null then
      select * into v_producto
      from public.eos_erp_productos
      where id = (v_item ->> 'producto_id')::uuid
        and usuario_id = p_usuario_id
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
    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, metadata
    ) values (
      p_usuario_id, 'ingreso', v_total_venta, coalesce(p_moneda, 'PYG'),
      'Venta' || coalesce(' — ' || (
        select c.nombre from public.eos_crm_contactos c where c.id = p_contacto_id
      ), ''),
      'ventas', v_fecha, 'erp',
      jsonb_build_object('venta_id', v_venta_id)
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
$$;

revoke all on function public.eos_erp_registrar_venta(uuid, jsonb, uuid, date, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_registrar_venta(uuid, jsonb, uuid, date, text, text, boolean, text)
  to service_role;

comment on function public.eos_erp_registrar_venta(uuid, jsonb, uuid, date, text, text, boolean, text) is
  'Registra una venta entera: cabecera, ítems, stock y el ingreso en Finanzas. O pasa todo o no pasa nada.';

-- ============================================================
-- 3) Cobrar una venta que se hizo a crédito
-- ============================================================

create or replace function public.eos_erp_cobrar_venta(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_fecha date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venta public.eos_erp_ventas%rowtype;
  v_movimiento_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_venta
  from public.eos_erp_ventas
  where id = p_venta_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_VENTA_NO_EXISTE';
  end if;

  if v_venta.estado = 'anulada' then
    raise exception 'EOS_VENTA_ANULADA';
  end if;

  -- Idempotente: cobrar dos veces la misma venta duplicaría el ingreso y le
  -- mostraría al usuario plata que no tiene. Un doble clic alcanza para eso.
  if v_venta.movimiento_id is not null then
    return jsonb_build_object(
      'ok', true, 'ya_estaba', true,
      'venta_id', v_venta.id, 'movimiento_id', v_venta.movimiento_id
    );
  end if;

  insert into public.eos_movimientos_financieros (
    usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, metadata
  ) values (
    p_usuario_id, 'ingreso', v_venta.total, v_venta.moneda,
    'Cobro de venta' || coalesce(' — ' || (
      select c.nombre from public.eos_crm_contactos c where c.id = v_venta.contacto_id
    ), ''),
    'ventas', coalesce(p_fecha, current_date), 'erp',
    jsonb_build_object('venta_id', v_venta.id)
  )
  returning id into v_movimiento_id;

  update public.eos_erp_ventas
  set estado = 'cobrada',
      movimiento_id = v_movimiento_id,
      actualizado_en = now()
  where id = v_venta.id;

  return jsonb_build_object(
    'ok', true, 'ya_estaba', false,
    'venta_id', v_venta.id, 'movimiento_id', v_movimiento_id
  );
end;
$$;

revoke all on function public.eos_erp_cobrar_venta(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.eos_erp_cobrar_venta(uuid, uuid, date) to service_role;
