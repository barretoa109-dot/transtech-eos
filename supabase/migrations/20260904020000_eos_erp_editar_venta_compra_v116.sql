-- ============================================================
-- v116 · Editar una venta o una compra ya registrada
-- ============================================================
--
-- QUÉ PEDÍA LA USUARIA
--
-- "Debe de poder editar todo lo que sean compras y ventas en todos sus
-- apartados." Hoy una venta o compra ya guardada solo tiene dos caminos:
-- `Corregir costo` (un solo número, para el margen) y `Anular` (borrarla
-- entera). No hay forma de decir "puse 3 en vez de 5" o "el precio estaba
-- mal" sin anular a mano, escribir el motivo, y volver a cargar todo de
-- cero desde la pantalla de "Nueva venta".
--
-- QUÉ ES "EDITAR" ACÁ, Y POR QUÉ
--
-- No es una actualización en el lugar de `eos_erp_ventas`/`eos_erp_venta_items`.
-- Es anular la vieja y registrar la nueva, atado en una sola transacción para
-- que se vea como una sola acción del lado de la pantalla.
--
-- La razón es `eos_erp_anular_venta` (v88) y `eos_erp_anular_compra` (v92):
-- ya revierten el stock, borran el movimiento financiero, y —el motivo real
-- de reusarlas y no escribir algo nuevo— ya RECHAZAN anular una venta con una
-- factura electrónica activa (`EOS_VENTA_CON_FACTURA`) y una compra ya
-- restaura el costo anterior del producto con una lógica que agrupa por
-- producto y mira la última compra vigente. Reescribir eso para que funcione
-- "en el lugar" sería duplicar cada una de esas reglas con el riesgo de que
-- las dos copias diverjan la primera vez que una de las dos se corrija sola.
-- Llamar a las funciones que la pantalla de Anular ya prueba todos los días
-- hereda esas protecciones gratis, factura incluida.
--
-- Que las dos mitades corran en una sola función de base de datos (no dos
-- llamadas separadas desde la ruta) es lo que evita el estado a medias: si
-- anular funciona pero el registro nuevo falla —un ítem con un producto que
-- no es del usuario, por ejemplo— Postgres deshace las dos partes, y la venta
-- vieja sigue como estaba. Dos llamadas HTTP separadas no podrían garantizar
-- eso.

create or replace function public.eos_erp_editar_venta(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_items jsonb,
  p_contacto_id uuid default null,
  p_fecha date default null,
  p_moneda text default 'PYG',
  p_condicion text default 'contado',
  p_cobrada boolean default false,
  p_notas text default null,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado_actual text;
  v_registro jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select estado into v_estado_actual
  from public.eos_erp_ventas
  where id = p_venta_id and usuario_id = p_usuario_id;

  if not found then
    raise exception 'EOS_VENTA_NO_EXISTE';
  end if;

  if v_estado_actual = 'anulada' then
    raise exception 'EOS_VENTA_YA_ANULADA';
  end if;

  -- Devuelve stock, borra el ingreso vinculado y rechaza sola si hay una
  -- factura activa. Nada de esto se repite acá a propósito: ver el porqué
  -- arriba.
  perform public.eos_erp_anular_venta(
    p_usuario_id, p_venta_id, coalesce(nullif(btrim(p_motivo), ''), 'Editada')
  );

  v_registro := public.eos_erp_registrar_venta(
    p_usuario_id, p_items, p_contacto_id, p_fecha, p_moneda, p_condicion, p_cobrada, p_notas
  );

  return jsonb_build_object(
    'ok', true,
    'venta_anterior_id', p_venta_id,
    'venta_id', v_registro ->> 'venta_id',
    'subtotal', v_registro -> 'subtotal',
    'iva_total', v_registro -> 'iva_total',
    'total', v_registro -> 'total',
    'estado', v_registro -> 'estado'
  );
end;
$$;

revoke all on function public.eos_erp_editar_venta(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_editar_venta(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text)
  to service_role;

comment on function public.eos_erp_editar_venta(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text) is
  'Anula la venta y registra una nueva con los datos corregidos, en una sola transacción. No actualiza en el lugar: reusa eos_erp_anular_venta y eos_erp_registrar_venta para heredar sus mismas reglas (stock, factura activa, etc).';

create or replace function public.eos_erp_editar_compra(
  p_usuario_id uuid,
  p_compra_id uuid,
  p_items jsonb,
  p_contacto_id uuid default null,
  p_fecha date default null,
  p_moneda text default 'PYG',
  p_condicion text default 'contado',
  p_pagada boolean default false,
  p_numero_comprobante text default null,
  p_notas text default null,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado_actual text;
  v_registro jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select estado into v_estado_actual
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
    p_pagada, p_numero_comprobante, p_notas
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
$$;

revoke all on function public.eos_erp_editar_compra(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_editar_compra(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text, text)
  to service_role;

comment on function public.eos_erp_editar_compra(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text, text) is
  'Anula la compra y registra una nueva con los datos corregidos, en una sola transacción. No actualiza en el lugar: reusa eos_erp_anular_compra y eos_erp_registrar_compra para heredar sus mismas reglas (stock, costo anterior, etc).';
