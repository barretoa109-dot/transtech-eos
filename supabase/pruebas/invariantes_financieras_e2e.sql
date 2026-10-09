-- Invariantes financieras (09/10/2026): el conjunto de prueba de resultado conocido
-- que pide el encargo del 08/10, de punta a punta en la base real.
--
--     npx supabase db query --linked -f supabase/pruebas/invariantes_financieras_e2e.sql
--
-- Termina en un error a propósito, con los resultados adentro: no queda nada
-- escrito. Cuentas sintéticas.
--
-- ============================================================
-- POR QUÉ ESTA PRUEBA, SI YA HAY OTRAS DE FINANZAS
-- ============================================================
--
-- Las pruebas existentes (`finanzas_no_repite_e2e.sql`, los tests de
-- `lib/finanzas/`) cubren incidentes puntuales ya resueltos. Ninguna recorre
-- el escenario COMPLETO que describe el encargo como la vara de medir la
-- confianza financiera: saldo inicial, ingreso, egreso, reintento técnico,
-- repetición intencional, transferencia entre cuentas propias, una moneda
-- separada, anulación, y los casos de borde (monto inválido, sin permisos,
-- aislamiento entre cuentas). Esta es esa prueba, una sola vez, para poder
-- señalar un solo archivo como la prueba de que el sistema cumple.
--
-- ============================================================
-- UN AJUSTE AL ESCENARIO DEL ENCARGO, A PROPÓSITO
-- ============================================================
--
-- El encargo describe "cuenta de 1.000.000; ingreso de 250.000 y egreso de
-- 100.000 producen 1.150.000": un saldo que SUMA los movimientos. Este
-- producto no funciona así, por diseño (ver `eos_finanzas_declarar_saldo_v149`
-- y `lib/finanzas/conciliacion.ts`): el saldo de una cuenta es DECLARADO,
-- nunca calculado, justamente para no fingir una precisión que EOS no tiene
-- (no ve efectivo, billeteras ni todo lo que pasa por el banco). Lo que SÍ
-- se calcula, y es donde vive el invariante real, es el NETO de movimientos
-- (ingresos menos gastos) — lo que efectivamente entra al panel, al
-- presupuesto y al pronóstico. Esta prueba verifica eso, en los mismos
-- montos que usa el encargo, en vez de fingir una suma que el producto no
-- hace.

create temp table _r (n serial, prueba text, ok boolean, detalle text);

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

create or replace function pg_temp.orden(
  p_usuario uuid, p_accion text, p_datos jsonb, p_autorizada boolean default true
)
returns uuid language plpgsql as $$
declare c uuid := gen_random_uuid();
begin
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, payload, estado)
  values (c, p_usuario, gen_random_uuid(), p_accion, jsonb_build_object('datos', p_datos), 'recibida');
  if p_autorizada then
    insert into public.eos_autonomy_events_v12 (usuario_id, command_id, event_type, actor, detail)
    values (p_usuario, c, 'auto_allowed', 'service', '{"risk_points": 3}');
  end if;
  return c;
end;
$$;

create or replace function pg_temp.ejecutar(p_orden uuid) returns text language plpgsql as $$
declare r record;
begin
  select * into r from public.eos_execute_internal_effect_v64(p_orden);
  return 'ok:' || coalesce(r.idempotent::text, '?') || ':' || coalesce(r.resultado ->> 'id', r.resultado ->> 'primero', '?');
exception when others then
  return 'error:' || sqlerrm;
end;
$$;

/** Ingresos menos gastos, en una moneda, de una cuenta real (no el total combinado). */
create or replace function pg_temp.neto(p_usuario uuid, p_moneda text) returns numeric language sql as $$
  select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0)
  from public.eos_movimientos_financieros
  where usuario_id = p_usuario and moneda = p_moneda;
$$;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  o uuid;
  o_repetido uuid;
  salida text;
  filas int;
  saldo_usd numeric;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into auth.users (id, aud, role, email, raw_user_meta_data) values
    (a, 'authenticated', 'authenticated', 'e2e-fin-a-' || a || '@test.invalid', '{}'),
    (b, 'authenticated', 'authenticated', 'e2e-fin-b-' || b || '@test.invalid', '{}');

  -- 1. Saldo inicial declarado: 1.000.000 en una cuenta PYG.
  o := pg_temp.orden(a, 'DECLARAR_SALDO', '{"cuenta": "Ueno Prueba", "saldo": "1000000"}'::jsonb);
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('saldo inicial declarado', salida like 'ok:false:%', salida);

  -- 2. Ingreso de 250.000.
  o := pg_temp.orden(a, 'REGISTRAR_MOVIMIENTO_PERSONAL',
    '{"tipo": "ingreso", "descripcion": "Venta de un mueble viejo", "monto": "250000"}'::jsonb);
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('ingreso de 250.000 registrado', salida like 'ok:false:%', salida);

  -- 3. Egreso de 100.000 (el que se reintenta y se repite más abajo).
  o := pg_temp.orden(a, 'REGISTRAR_MOVIMIENTO_PERSONAL',
    '{"tipo": "gasto", "descripcion": "Reparación de la heladera", "monto": "100000"}'::jsonb);
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('egreso de 100.000 registrado', salida like 'ok:false:%', salida);
  perform pg_temp.chk('neto tras ingreso y egreso: 150.000', pg_temp.neto(a, 'PYG') = 150000, pg_temp.neto(a, 'PYG')::text);

  -- 4. Reintento TÉCNICO del mismo comando (mismo command_id, p.ej. un timeout
  -- de red que hizo que el cliente reenviara la misma orden): no duplica.
  salida := pg_temp.ejecutar(o);
  select count(*) into filas from public.eos_movimientos_financieros where action_command_id = o;
  perform pg_temp.chk('reintento técnico no duplica', salida like 'ok:true:%' and filas = 1, salida || ' / ' || filas);
  perform pg_temp.chk('neto sigue en 150.000 tras el reintento técnico', pg_temp.neto(a, 'PYG') = 150000, pg_temp.neto(a, 'PYG')::text);

  -- 5a. Reenvío ACCIDENTAL (mismo tipo, monto, fecha y descripción parecida,
  -- un command_id nuevo -- como las cinco compras repetidas del caso Green
  -- del 29/09, v226): NO es un reintento técnico, pero tampoco se anota como
  -- gasto nuevo. Se detecta "igual" y va a `repetidos`, sin inflar el neto.
  o_repetido := pg_temp.orden(a, 'REGISTRAR_MOVIMIENTO_PERSONAL',
    '{"tipo": "gasto", "descripcion": "Reparación de la heladera", "monto": "100000"}'::jsonb);
  salida := pg_temp.ejecutar(o_repetido);
  select count(*) into filas from public.eos_movimientos_financieros where usuario_id = a and tipo = 'gasto';
  -- El command_id de esta orden SÍ es nuevo (o_repetido <> o): la detección
  -- de "igual" es por contenido (tipo, monto, fecha, descripción parecida),
  -- no por reintento. Sigue habiendo una sola fila de gasto.
  perform pg_temp.chk('reenvío accidental (v226) no crea un gasto nuevo',
    o_repetido <> o and filas = 1, salida || ' / filas gasto: ' || filas);
  perform pg_temp.chk('neto sigue en 150.000 tras el reenvío accidental', pg_temp.neto(a, 'PYG') = 150000, pg_temp.neto(a, 'PYG')::text);

  -- 5b. Repetición INTENCIONAL de verdad: la persona insiste en que es OTRA
  -- vez lo mismo ("repetir": true, el mismo nombre que ya usa el freno de
  -- `lib/gateway/worker.ts` para las compras con tarjeta). Ahí sí es un
  -- segundo gasto real.
  o_repetido := pg_temp.orden(a, 'REGISTRAR_MOVIMIENTO_PERSONAL',
    '{"tipo": "gasto", "descripcion": "Reparación de la heladera", "monto": "100000", "repetir": true}'::jsonb);
  salida := pg_temp.ejecutar(o_repetido);
  perform pg_temp.chk('con "repetir":true sí crea un segundo gasto', salida like 'ok:false:%' and o_repetido <> o, salida);
  perform pg_temp.chk('neto baja a 50.000 con el segundo gasto confirmado', pg_temp.neto(a, 'PYG') = 50000, pg_temp.neto(a, 'PYG')::text);

  -- 6. Transferencia de 200.000 a otra cuenta propia: NO toca ingresos ni
  -- gastos (vive en otra tabla, a propósito -- ver eos_finanzas_transferencias).
  o := pg_temp.orden(a, 'REGISTRAR_TRANSFERENCIA',
    '{"monto": "200000", "origen": "Ueno Prueba", "destino": "Continental Prueba"}'::jsonb);
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('transferencia entre cuentas propias registrada', salida like 'ok:false:%', salida);
  perform pg_temp.chk('la transferencia NO cambia el neto de ingresos/gastos', pg_temp.neto(a, 'PYG') = 50000, pg_temp.neto(a, 'PYG')::text);
  select count(*) into filas from public.eos_movimientos_financieros where usuario_id = a and descripcion like '%Continental%';
  perform pg_temp.chk('la transferencia no aparece como movimiento', filas = 0, filas::text);

  -- 7. Una cuenta USD de 100 queda separada: no se mezcla con el neto en PYG.
  o := pg_temp.orden(a, 'DECLARAR_SALDO', '{"cuenta": "Caja USD Prueba", "saldo": "100", "moneda": "USD"}'::jsonb);
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('cuenta USD declarada aparte', salida like 'ok:false:%', salida);
  select c.saldo_declarado into saldo_usd from public.eos_finanzas_cuentas c
    where c.usuario_id = a and c.moneda = 'USD';
  perform pg_temp.chk('el saldo USD no se mezcló con PYG', saldo_usd = 100, saldo_usd::text);
  perform pg_temp.chk('el neto en PYG no cambió por la cuenta USD', pg_temp.neto(a, 'PYG') = 50000, pg_temp.neto(a, 'PYG')::text);

  -- 8. "Anular" el gasto repetido intencionalmente: por diseño, un movimiento
  -- personal NO se borra por chat (la única operación donde una coincidencia
  -- equivocada destruiría un dato sin dejar rastro) -- se borra desde la
  -- pantalla, un clic, la misma ruta que usa esta prueba: un delete directo,
  -- autenticado como la propia persona.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  delete from public.eos_movimientos_financieros where action_command_id = o_repetido;
  reset role;
  perform pg_temp.chk('anular el gasto repetido restaura el neto a 150.000', pg_temp.neto(a, 'PYG') = 150000, pg_temp.neto(a, 'PYG')::text);

  -- 9. Monto inválido o ausente: no escribe nada.
  o := pg_temp.orden(a, 'REGISTRAR_MOVIMIENTO_PERSONAL', '{"tipo": "gasto", "descripcion": "sin monto"}'::jsonb);
  salida := pg_temp.ejecutar(o);
  select count(*) into filas from public.eos_movimientos_financieros where action_command_id = o;
  perform pg_temp.chk('sin monto, falla y no escribe', salida like 'error:%EOS_ACCION_PERSONAL_SIN_MONTO%' and filas = 0, salida);

  o := pg_temp.orden(a, 'REGISTRAR_MOVIMIENTO_PERSONAL', '{"tipo": "gasto", "descripcion": "monto cero", "monto": "0"}'::jsonb);
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('monto cero también falla (no es un movimiento)', salida like 'error:%EOS_ACCION_PERSONAL_SIN_MONTO%', salida);
  perform pg_temp.chk('el neto no se movió por los dos intentos inválidos', pg_temp.neto(a, 'PYG') = 150000, pg_temp.neto(a, 'PYG')::text);

  -- 10. Sin autorización del Worker Gate: no se escribe.
  o := pg_temp.orden(a, 'REGISTRAR_MOVIMIENTO_PERSONAL',
    '{"tipo": "gasto", "descripcion": "sin permiso", "monto": "999999"}'::jsonb, false);
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('sin autorización del Worker Gate, no se escribe', salida like 'error:%NOT_AUTHORIZED%', salida);
  perform pg_temp.chk('el neto no se movió por la orden sin autorizar', pg_temp.neto(a, 'PYG') = 150000, pg_temp.neto(a, 'PYG')::text);

  -- 11. Aislamiento: B no ve nada de A, ni sumando por accidente.
  perform pg_temp.chk('B no tiene movimientos propios todavía', pg_temp.neto(b, 'PYG') = 0, pg_temp.neto(b, 'PYG')::text);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into filas from public.eos_movimientos_financieros;
  reset role;
  perform pg_temp.chk('con su sesión, B no lee los movimientos de A', filas = 0, filas::text);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into filas from public.eos_finanzas_cuentas;
  reset role;
  perform pg_temp.chk('con su sesión, B no lee las cuentas de A (ni la de USD)', filas = 0, filas::text);
end;
$$;

do $$ begin
  raise exception 'EOS_E2E_INVARIANTES_FINANCIERAS %', (select json_agg(json_build_object('prueba', prueba, 'ok', ok, 'detalle', left(detalle, 160)) order by n) from _r);
end $$;
