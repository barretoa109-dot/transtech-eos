-- Alinear las correcciones del ERP con lo que quedó escrito (v79).
--
-- La v78 se aplicó a producción y DESPUÉS se editó en el repositorio: la
-- revisión en paralelo le agregó tres cosas que valen la pena.
--
--   * El motivo de la anulación pasa a ser obligatorio. Un rastro de auditoría
--     que no dice por qué se anuló algo explica la mitad de lo que hace falta
--     explicar seis meses después.
--   * Al anular una compra se recupera el costo de la compra anterior vigente,
--     en vez de dejar clavado el costo que fijó la compra anulada. Era la
--     limitación que la propia v78 documentaba como conocida.
--   * El ajuste de stock valida que los números sean números.
--
-- Una migración aplicada no se reescribe: la base ya corrió la versión vieja y
-- editar el archivo sólo logra que el repositorio y producción cuenten
-- historias distintas. Eso es exactamente lo que pasó con la v76 y quedó
-- documentado en `docs/puesta-en-marcha-migraciones.md`.
--
-- Así que las mejoras viajan acá. Una base nueva aplica la v78 y después esta,
-- y termina en el mismo estado que producción: `create or replace` sobre las
-- mismas tres funciones.

-- ============================================================
-- Anular una venta
-- ============================================================

create or replace function public.eos_erp_anular_venta(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_venta public.eos_erp_ventas%rowtype;
  v_item record;
  v_saldo numeric(16,3);
  v_documento public.eos_fe_documentos%rowtype;
  v_devueltos int := 0;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
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

  if v_motivo is null then
    raise exception 'EOS_ANULACION_MOTIVO_REQUERIDO';
  end if;

  v_motivo := left(v_motivo, 500);

  -- Idempotente: dos clics no devuelven el stock dos veces.
  if v_venta.estado = 'anulada' then
    return jsonb_build_object(
      'ok', true, 'ya_estaba', true, 'venta_id', v_venta.id
    );
  end if;

  /*
   * Una factura emitida no se deshace borrando una fila.
   *
   * Si la venta tiene un documento electrónico que ya salió de borrador, el
   * hecho imponible existe ante la SET y anularlo es un trámite fiscal (nota
   * de crédito o evento de cancelación en SIFEN), no una operación de base de
   * datos. Dejar que el sistema "anule" acá le haría creer al usuario que
   * quedó resuelto algo que la SET todavía tiene registrado.
   *
   * Un documento en borrador sí se cancela junto con la venta: nunca se firmó
   * ni se envió, así que no existe para nadie más que para nosotros.
   */
  select * into v_documento
  from public.eos_fe_documentos
  where venta_id = v_venta.id and usuario_id = p_usuario_id
  order by creado_en desc
  limit 1;

  if found and v_documento.estado not in ('borrador', 'cancelado') then
    raise exception 'EOS_VENTA_CON_FACTURA';
  end if;

  if found and v_documento.estado = 'borrador' then
    update public.eos_fe_documentos
    set estado = 'cancelado', actualizado_en = now()
    where id = v_documento.id;
  end if;

  -- El stock vuelve al estante, con su movimiento.
  for v_item in
    select producto_id, cantidad
    from public.eos_erp_venta_items
    where venta_id = v_venta.id and producto_id is not null
  loop
    update public.eos_erp_productos
    set stock_actual = stock_actual + v_item.cantidad,
        actualizado_en = now()
    where id = v_item.producto_id
      and usuario_id = p_usuario_id
      and controla_stock
    returning stock_actual into v_saldo;

    if found then
      insert into public.eos_erp_movimientos_stock (
        usuario_id, producto_id, tipo, cantidad, saldo_resultante,
        motivo, referencia_tipo, referencia_id, fecha
      ) values (
        p_usuario_id, v_item.producto_id, 'entrada', v_item.cantidad, v_saldo,
        coalesce('Anulación de venta — ' || v_motivo, 'Anulación de venta'),
        'venta', v_venta.id, current_date
      );

      v_devueltos := v_devueltos + 1;
    end if;
  end loop;

  -- La plata que nunca entró deja de figurar. La FK es ON DELETE SET NULL, así
  -- que `movimiento_id` se limpia solo.
  if v_venta.movimiento_id is not null then
    delete from public.eos_movimientos_financieros
    where id = v_venta.movimiento_id and usuario_id = p_usuario_id;
  end if;

  update public.eos_erp_ventas
  set estado = 'anulada',
      notas = case
        when v_motivo is null then notas
        else left(coalesce(notas || E'\n', '') || 'Anulada: ' || v_motivo, 2000)
      end,
      actualizado_en = now()
  where id = v_venta.id;

  return jsonb_build_object(
    'ok', true,
    'ya_estaba', false,
    'venta_id', v_venta.id,
    'productos_devueltos', v_devueltos,
    'movimiento_borrado', v_venta.movimiento_id is not null
  );
end;
$function$;

-- ============================================================
-- Anular una compra
-- ============================================================

create or replace function public.eos_erp_anular_compra(
  p_usuario_id uuid,
  p_compra_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_compra public.eos_erp_compras%rowtype;
  v_item record;
  v_saldo numeric(16,3);
  v_retirados int := 0;
  v_costo_anterior numeric(16,2);
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
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

  if v_motivo is null then
    raise exception 'EOS_ANULACION_MOTIVO_REQUERIDO';
  end if;

  v_motivo := left(v_motivo, 500);

  if v_compra.estado = 'anulada' then
    return jsonb_build_object(
      'ok', true, 'ya_estaba', true, 'compra_id', v_compra.id
    );
  end if;

  /*
   * El stock sale, y puede quedar negativo.
   *
   * Se permite a propósito, igual que al vender: si esa mercadería ya se
   * vendió, retirarla deja el saldo por debajo de cero, y eso es información
   * verdadera —el sistema está contando algo que no existe— y no un error que
   * convenga esconder bloqueando la anulación. Queda registrado y visible.
   */
  for v_item in
    select producto_id, cantidad
    from public.eos_erp_compra_items
    where compra_id = v_compra.id and producto_id is not null
  loop
    update public.eos_erp_productos
    set stock_actual = stock_actual - v_item.cantidad,
        actualizado_en = now()
    where id = v_item.producto_id
      and usuario_id = p_usuario_id
      and controla_stock
    returning stock_actual into v_saldo;

    if found then
      insert into public.eos_erp_movimientos_stock (
        usuario_id, producto_id, tipo, cantidad, saldo_resultante,
        motivo, referencia_tipo, referencia_id, fecha
      ) values (
        p_usuario_id, v_item.producto_id, 'salida', v_item.cantidad, v_saldo,
        coalesce('Anulación de compra — ' || v_motivo, 'Anulación de compra'),
        'compra', v_compra.id, current_date
      );

      v_retirados := v_retirados + 1;
    end if;

    -- Al anular también deja de ser válido el costo que esa compra había
    -- fijado. Se recupera el último costo de una compra todavía vigente. Si no
    -- hay historia anterior no se inventa un valor: queda el costo conocido,
    -- que puede haber sido cargado al crear el producto.
    select ci.precio_unitario
      into v_costo_anterior
    from public.eos_erp_compra_items ci
    join public.eos_erp_compras c on c.id = ci.compra_id
    where ci.producto_id = v_item.producto_id
      and c.usuario_id = p_usuario_id
      and c.id <> v_compra.id
      and c.estado <> 'anulada'
    order by c.fecha desc, c.creado_en desc, ci.orden desc
    limit 1;

    if found then
      update public.eos_erp_productos
      set costo = v_costo_anterior,
          actualizado_en = now()
      where id = v_item.producto_id and usuario_id = p_usuario_id;
    end if;
  end loop;

  if v_compra.movimiento_id is not null then
    delete from public.eos_movimientos_financieros
    where id = v_compra.movimiento_id and usuario_id = p_usuario_id;
  end if;

  update public.eos_erp_compras
  set estado = 'anulada',
      notas = case
        when v_motivo is null then notas
        else left(coalesce(notas || E'\n', '') || 'Anulada: ' || v_motivo, 2000)
      end,
      actualizado_en = now()
  where id = v_compra.id;

  return jsonb_build_object(
    'ok', true,
    'ya_estaba', false,
    'compra_id', v_compra.id,
    'productos_retirados', v_retirados,
    'movimiento_borrado', v_compra.movimiento_id is not null
  );
end;
$function$;

-- ============================================================
-- Ajustar el stock
-- ============================================================
--
-- Dos formas, porque son dos gestos distintos de la vida real:
--
--   * `p_stock_contado`: "conté y hay 47". El conteo físico de fin de mes.
--   * `p_delta`: "se me rompieron 3". La merma puntual, sin contar todo.
--
-- Va una o la otra, nunca las dos. Sin ninguna de estas, el stock se desvía de
-- la realidad en semanas y no hay forma de volver a alinearlo: el usuario
-- termina ignorando el número, y un stock que nadie mira no sirve para nada.

create or replace function public.eos_erp_ajustar_stock(
  p_usuario_id uuid,
  p_producto_id uuid,
  p_stock_contado numeric default null,
  p_delta numeric default null,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_producto public.eos_erp_productos%rowtype;
  v_diferencia numeric(16,3);
  v_saldo numeric(16,3);
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if (p_stock_contado is null) = (p_delta is null) then
    raise exception 'EOS_AJUSTE_MODO_INVALIDO';
  end if;

  if v_motivo is null then
    raise exception 'EOS_AJUSTE_MOTIVO_REQUERIDO';
  end if;

  v_motivo := left(v_motivo, 500);

  if p_stock_contado in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or p_delta in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
    raise exception 'EOS_AJUSTE_NUMERO_INVALIDO';
  end if;

  if p_stock_contado is not null and p_stock_contado < 0 then
    raise exception 'EOS_AJUSTE_CONTEO_NEGATIVO';
  end if;

  select * into v_producto
  from public.eos_erp_productos
  where id = p_producto_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_PRODUCTO_NO_EXISTE';
  end if;

  if not v_producto.controla_stock then
    raise exception 'EOS_PRODUCTO_SIN_STOCK';
  end if;

  v_diferencia := case
    when p_stock_contado is not null then p_stock_contado - v_producto.stock_actual
    else p_delta
  end;

  -- Contar y que dé lo mismo no es un error, pero tampoco un movimiento.
  if v_diferencia = 0 then
    return jsonb_build_object(
      'ok', true,
      'sin_cambios', true,
      'producto_id', v_producto.id,
      'stock_actual', v_producto.stock_actual
    );
  end if;

  update public.eos_erp_productos
  set stock_actual = stock_actual + v_diferencia,
      actualizado_en = now()
  where id = v_producto.id
  returning stock_actual into v_saldo;

  insert into public.eos_erp_movimientos_stock (
    usuario_id, producto_id, tipo, cantidad, saldo_resultante,
    motivo, referencia_tipo, referencia_id, fecha
  ) values (
    p_usuario_id, v_producto.id, 'ajuste', v_diferencia, v_saldo,
    v_motivo,
    case when p_stock_contado is not null then 'inventario' else 'manual' end,
    null, current_date
  );

  return jsonb_build_object(
    'ok', true,
    'sin_cambios', false,
    'producto_id', v_producto.id,
    'stock_anterior', v_producto.stock_actual,
    'stock_actual', v_saldo,
    'diferencia', v_diferencia
  );
end;
$function$;

-- Estas funciones son `security definer` y saltean la RLS a propósito: reciben
-- el usuario por parámetro y lo verifican en cada consulta. Sólo el rol de
-- servicio puede invocarlas, igual que el resto del ERP.
revoke all on function public.eos_erp_anular_venta(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.eos_erp_anular_compra(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.eos_erp_ajustar_stock(uuid, uuid, numeric, numeric, text) from public, anon, authenticated;

grant execute on function public.eos_erp_anular_venta(uuid, uuid, text) to service_role;
grant execute on function public.eos_erp_anular_compra(uuid, uuid, text) to service_role;
grant execute on function public.eos_erp_ajustar_stock(uuid, uuid, numeric, numeric, text) to service_role;
