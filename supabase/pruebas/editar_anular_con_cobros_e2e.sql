-- Prueba de la v209: una venta o compra a crédito ya cobrada (o pagada) se
-- puede editar y anular.
--
-- Se corre DESPUÉS de la migración, en una transacción con rollback:
--
--     sudo -u postgres psql -d eos_local < supabase/pruebas/editar_anular_con_cobros_e2e.sql
--
-- o contra la base enlazada con `npx supabase db query --linked -f`.

begin;

create temp table _r (n serial, prueba text, ok boolean, detalle text) on commit drop;

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

do $$
declare
  ua uuid := gen_random_uuid();
  pa uuid; ca uuid;
  v jsonb; e jsonb; a jsonb; c jsonb;
  mov uuid;
  hoy date := (now() at time zone 'America/Asuncion')::date;
  ingresos_antes numeric;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-cobros-' || ua || '@test.invalid', '{}');

  insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, costo, controla_stock, stock_actual, stock_minimo)
  values (ua, 'Kit de dr althea', 305000, 200000, true, 10, 0) returning id into pa;
  insert into public.eos_crm_contactos (usuario_id, nombre) values (ua, 'Clienta') returning id into ca;

  -- ---------------------------------------------------------------- venta cobrada de una vez
  v := public.eos_erp_registrar_venta(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 1)),
    ca, hoy, 'PYG', 'credito', false, null, hoy + 20);
  perform public.eos_erp_cobrar_venta(ua, (v->>'venta_id')::uuid);
  mov := (select movimiento_id from public.eos_erp_ventas where id = (v->>'venta_id')::uuid);

  -- El caso del 27/09: editar el precio de una venta ya cobrada.
  e := public.eos_erp_editar_venta(
    ua, (v->>'venta_id')::uuid,
    jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 1, 'precio_unitario', 305000)),
    ca, hoy, 'PYG', 'credito', false, null, 'Precio corregido');

  perform pg_temp.chk('editar una venta cobrada funciona', (e->>'ok')::boolean);
  perform pg_temp.chk('el cobro pasó a la venta corregida',
    exists (select 1 from public.eos_erp_cuenta_movimientos_v107
            where venta_id = (e->>'venta_id')::uuid and movimiento_id = mov));
  perform pg_temp.chk('la plata del cobro sigue en el panel (el mismo ingreso)',
    exists (select 1 from public.eos_movimientos_financieros where id = mov));
  perform pg_temp.chk('y dice de qué venta es: la corregida',
    (select metadata->>'venta_id' from public.eos_movimientos_financieros where id = mov) = e->>'venta_id');
  perform pg_temp.chk('la venta corregida sigue cobrada', e->>'estado' = 'cobrada', e->>'estado');

  -- Anularla: se van la venta, el cobro y su plata.
  a := public.eos_erp_anular_venta(ua, (e->>'venta_id')::uuid, 'Se canceló');
  perform pg_temp.chk('anular una venta cobrada funciona', (a->>'ok')::boolean);
  perform pg_temp.chk('dice cuántos cobros revirtió', (a->>'cobros_revertidos')::int = 1, a->>'cobros_revertidos');
  perform pg_temp.chk('el ingreso del cobro ya no está',
    not exists (select 1 from public.eos_movimientos_financieros where id = mov));
  perform pg_temp.chk('el stock volvió', (select stock_actual from public.eos_erp_productos where id = pa) = 10);

  -- ---------------------------------------------------------------- cobro parcial
  v := public.eos_erp_registrar_venta(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 1)),
    ca, hoy, 'PYG', 'credito', false, null, hoy + 20);
  perform public.eos_erp_registrar_cobranza_v107(ua, (v->>'venta_id')::uuid, null, 100000, hoy, 'seña');

  e := public.eos_erp_editar_venta(
    ua, (v->>'venta_id')::uuid,
    jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 2)),
    ca, hoy, 'PYG', 'credito', false, null, 'Llevó dos');
  perform pg_temp.chk('con cobro parcial, editar conserva la seña',
    public.eos_erp_saldo_documento_v107((e->>'venta_id')::uuid, null) = 610000 - 100000,
    public.eos_erp_saldo_documento_v107((e->>'venta_id')::uuid, null)::text);
  perform pg_temp.chk('y queda pendiente, no cobrada', e->>'estado' = 'emitida', e->>'estado');

  a := public.eos_erp_anular_venta(ua, (e->>'venta_id')::uuid, 'Devolvió todo');
  perform pg_temp.chk('con cobro parcial, anular funciona (antes: EOS_DOCUMENTO_CON_COBRANZAS)',
    (a->>'cobros_revertidos')::int = 1);

  -- ---------------------------------------------------------------- corregida a contado
  v := public.eos_erp_registrar_venta(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 1)),
    ca, hoy, 'PYG', 'credito', false, null, hoy + 20);
  perform public.eos_erp_cobrar_venta(ua, (v->>'venta_id')::uuid);
  ingresos_antes := (select coalesce(sum(monto), 0) from public.eos_movimientos_financieros
                     where usuario_id = ua and tipo = 'ingreso');

  e := public.eos_erp_editar_venta(
    ua, (v->>'venta_id')::uuid,
    jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 1)),
    ca, hoy, 'PYG', 'contado', true, null, 'Era al contado');
  perform pg_temp.chk('corregida a contado: la plata no se cuenta dos veces',
    (select coalesce(sum(monto), 0) from public.eos_movimientos_financieros
     where usuario_id = ua and tipo = 'ingreso') = ingresos_antes,
    (select coalesce(sum(monto), 0) from public.eos_movimientos_financieros
     where usuario_id = ua and tipo = 'ingreso')::text || ' vs ' || ingresos_antes::text);

  -- ---------------------------------------------------------------- compra pagada
  c := public.eos_erp_registrar_compra(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 2, 'costo_unitario', 200000)),
    ca, hoy, 'PYG', 'credito', false, null, null, hoy + 20);
  perform public.eos_erp_pagar_compra(ua, (c->>'compra_id')::uuid);

  c := public.eos_erp_editar_compra(
    ua, (c->>'compra_id')::uuid,
    jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 2, 'costo_unitario', 190000)),
    ca, hoy, 'PYG', 'credito', false, null, null, 'Costo corregido');
  perform pg_temp.chk('editar el costo de una compra pagada funciona', (c->>'pagos_conservados')::int = 1);

  a := public.eos_erp_anular_compra(ua, (c->>'compra_id')::uuid, 'Devolución al proveedor');
  perform pg_temp.chk('anular una compra pagada funciona', (a->>'pagos_revertidos')::int = 1);

  -- ---------------------------------------------------------------- sin cobros, como siempre
  v := public.eos_erp_registrar_venta(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 1)),
    ca, hoy, 'PYG', 'contado', true, null, null);
  a := public.eos_erp_anular_venta(ua, (v->>'venta_id')::uuid, 'Error de carga');
  perform pg_temp.chk('una venta al contado se sigue anulando igual',
    (a->>'movimiento_borrado')::boolean and (a->>'cobros_revertidos')::int = 0);
end $$;

reset role;

select
  (select count(*) from _r where ok) || ' de ' || (select count(*) from _r) as resumen;

select n, prueba, ok, detalle from _r order by n;

select pg_temp.chk('anon NO ejecuta los ayudantes',
  not has_function_privilege('anon', 'public.eos_erp_quitar_cobros_v209(uuid, uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.eos_erp_pasar_cobros_v209(uuid, uuid, uuid, jsonb)', 'execute'));

select n, prueba, ok from _r where n = (select max(n) from _r);

rollback;
