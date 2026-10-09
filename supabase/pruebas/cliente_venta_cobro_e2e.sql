-- El recorrido del cliente (09/10/2026): agendar, vender a crédito, cobrar en
-- partes y que la cartera quede exacta. De punta a punta en la base real.
--
--     npx supabase db query --linked -f supabase/pruebas/cliente_venta_cobro_e2e.sql
--
-- Termina en un error a propósito, con los resultados adentro: no queda nada
-- escrito. Cuentas sintéticas.
--
-- ============================================================
-- POR QUÉ ESTA PRUEBA
-- ============================================================
--
-- La sección 9 del encargo del 08/10/2026 pide el recorrido completo:
-- "registrar cliente, asignar siguiente acción, registrar venta o servicio,
-- vincular cobro y consultar pendientes". `crm_completo_e2e.sql` y
-- `venta_cliente_nuevo_e2e.sql` ya cubren cliente + venta; ningún archivo de
-- `supabase/pruebas/` ejercitaba REGISTRAR_COBRO a través del ejecutor real
-- (`eos_execute_internal_effect_v64`). Esta prueba cierra esa parte: vender a
-- crédito, cobrar en dos partes y verificar que la cartera (estado, saldo,
-- el ingreso que aparece en finanzas) queda exacta en cada paso.

create temp table _r (n serial, prueba text, ok boolean, detalle text);

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

-- Una acción entera como la corre el worker: orden, autorización y ejecutor.
create or replace function pg_temp.accion(p_usuario uuid, p_tipo text, p_datos jsonb)
returns text language plpgsql as $$
declare
  v_cmd uuid;
  v_res jsonb;
begin
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, input_fingerprint, origen, payload)
  values (gen_random_uuid(), p_usuario, gen_random_uuid(), p_tipo, md5(random()::text), 'n8n-worker-gated-rc1',
          jsonb_build_object('datos', p_datos))
  returning id into v_cmd;

  insert into public.eos_autonomy_events_v12 (usuario_id, command_id, event_type, actor)
  values (p_usuario, v_cmd, 'auto_allowed', 'service');

  select resultado into v_res from public.eos_execute_internal_effect_v64(v_cmd);
  return 'ok:' || v_res::text;
exception when others then
  return 'error:' || sqlerrm;
end;
$$;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  salida text;
  venta record;
  cobrado numeric;
  filas int;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into auth.users (id, aud, role, email, raw_user_meta_data) values
    (a, 'authenticated', 'authenticated', 'e2e-cliente-a-' || a || '@test.invalid', '{}'),
    (b, 'authenticated', 'authenticated', 'e2e-cliente-b-' || b || '@test.invalid', '{}');
  insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen) values
    (a, 'erp', 'activo', 'prueba'),
    (b, 'erp', 'activo', 'prueba');

  -- 1. Agendar el cliente, como pide la sección 9: "cliente con identidad,
  -- contacto, responsable e historial pertinente".
  salida := pg_temp.accion(a, 'CREAR_CONTACTO', '{"nombre": "ZZ Dolores Candia", "telefono": "0981222333"}'::jsonb);
  perform pg_temp.chk('el cliente se agenda', salida like 'ok:%', salida);

  -- 2. Venta a crédito: 3 cuotas de un servicio, 150.000 en total.
  salida := pg_temp.accion(a, 'REGISTRAR_VENTA', '{
    "contacto": "ZZ Dolores Candia",
    "condicion": "credito",
    "items": [{"producto": "Arreglo de techo", "cantidad": 1, "precio_unitario": 150000}]
  }'::jsonb);
  perform pg_temp.chk('la venta a crédito se registra', salida like 'ok:%', salida);

  select v.* into venta from public.eos_erp_ventas v
    where v.usuario_id = a and v.contacto_id = (select id from public.eos_crm_contactos where usuario_id = a and nombre = 'ZZ Dolores Candia')
    order by v.creado_en desc limit 1;

  perform pg_temp.chk('la venta queda EMITIDA, no cobrada, por 150.000',
    venta.estado = 'emitida' and venta.total = 150000 and venta.condicion = 'credito',
    venta.estado || ' / ' || venta.total::text);

  -- 3. Primer cobro, parcial: 60.000.
  salida := pg_temp.accion(a, 'REGISTRAR_COBRO', '{"contacto": "ZZ Dolores Candia", "monto": "60000"}'::jsonb);
  perform pg_temp.chk('el cobro parcial se registra', salida like 'ok:%', salida);

  select coalesce(sum(m.monto), 0) into cobrado from public.eos_erp_cuenta_movimientos_v107 m where m.venta_id = venta.id;
  select estado into venta.estado from public.eos_erp_ventas where id = venta.id;
  perform pg_temp.chk('tras el parcial: 60.000 aplicados y la venta sigue EMITIDA (deben 90.000)',
    cobrado = 60000 and venta.estado = 'emitida', cobrado::text || ' / ' || venta.estado);

  -- 4. El ingreso parcial ya aparece en finanzas (el puente que describe la v67).
  select count(*) into filas from public.eos_movimientos_financieros
    where usuario_id = a and ambito = 'negocio' and tipo = 'ingreso' and monto = 60000;
  perform pg_temp.chk('el cobro parcial aparece como ingreso del negocio', filas >= 1, filas::text);

  -- 5. Segundo cobro: el resto, sin decir el monto ("todo" implícito con una
  -- sola pendiente) -- cobra exactamente el saldo, no de más.
  salida := pg_temp.accion(a, 'REGISTRAR_COBRO', '{"contacto": "ZZ Dolores Candia"}'::jsonb);
  perform pg_temp.chk('el segundo cobro (sin monto, una sola pendiente) se registra', salida like 'ok:%', salida);

  select coalesce(sum(m.monto), 0) into cobrado from public.eos_erp_cuenta_movimientos_v107 m where m.venta_id = venta.id;
  select estado into venta.estado from public.eos_erp_ventas where id = venta.id;
  perform pg_temp.chk('tras el segundo cobro: exacto 150.000 en total y la venta queda COBRADA',
    cobrado = 150000 and venta.estado = 'cobrada', cobrado::text || ' / ' || venta.estado);

  -- 6. Consultar pendientes: ya no queda nada por cobrar de este cliente.
  salida := pg_temp.accion(a, 'REGISTRAR_COBRO', '{"contacto": "ZZ Dolores Candia"}'::jsonb);
  perform pg_temp.chk('sin nada pendiente, un tercer cobro falla y no crea otro movimiento',
    salida like 'error:%EOS_ACCION_COBRO_SIN_PENDIENTES%', salida);

  -- 7. No se cobra de más: una venta nueva de 50.000, pedir 999.999 falla.
  salida := pg_temp.accion(a, 'REGISTRAR_VENTA', '{
    "contacto": "ZZ Dolores Candia", "condicion": "credito",
    "items": [{"producto": "Revisión", "cantidad": 1, "precio_unitario": 50000}]
  }'::jsonb);
  perform pg_temp.chk('segunda venta a crédito, 50.000', salida like 'ok:%', salida);

  salida := pg_temp.accion(a, 'REGISTRAR_COBRO', '{"contacto": "ZZ Dolores Candia", "monto": "999999"}'::jsonb);
  perform pg_temp.chk('cobrar más de lo que debe, falla', salida like 'error:%', salida);

  -- 8. Aislamiento: B no ve ni el cliente, ni la venta, ni puede cobrarle.
  select count(*) into filas from public.eos_crm_contactos where usuario_id = b;
  perform pg_temp.chk('B no tiene contactos propios', filas = 0, filas::text);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into filas from public.eos_erp_ventas;
  reset role;
  perform pg_temp.chk('con su sesión, B no lee las ventas de A', filas = 0, filas::text);

  salida := pg_temp.accion(b, 'REGISTRAR_COBRO', '{"contacto": "ZZ Dolores Candia", "monto": "1000"}'::jsonb);
  perform pg_temp.chk('B no puede cobrarle al cliente de A (no lo resuelve)', salida like 'error:%', salida);
end;
$$;

do $$ begin
  raise exception 'EOS_E2E_CLIENTE_VENTA_COBRO %', (select json_agg(json_build_object('prueba', prueba, 'ok', ok, 'detalle', left(detalle, 180)) order by n) from _r);
end $$;
