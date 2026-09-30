-- Prueba de la v226: el caso Green del 29/09/2026, de punta a punta en la base.
--
-- Corre la migración y la prueba en UNA transacción que termina en un error a
-- propósito, con los resultados adentro del mensaje: no queda nada escrito.
--
--     cat supabase/pruebas/finanzas_no_repite_e2e_inicio.sql \
--         supabase/migrations/20260930101000_eos_pago_de_tarjeta_v222.sql \
--         supabase/migrations/20260930104000_eos_finanzas_no_repite_v226.sql \
--         supabase/pruebas/finanzas_no_repite_e2e.sql > /tmp/e2e226.sql
--     npx supabase db query --linked -f /tmp/e2e226.sql
--
-- (Con la v222 y la v226 ya aplicadas, alcanza con el inicio y este archivo.)
--
-- Reproduce lo que pasó: una tarjeta Green cargada el 23/09, un gasto de
-- 22.650 del 27/09 ya anotado, y el mensaje "gasté 46.000 en Punto Farma con
-- la Green, ya pagué el mínimo, y gané 100.000" seguido de tres "no está".

create temp table _r (n serial, prueba text, ok boolean, detalle text);

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

-- Una acción entera como la corre el worker: orden, autorización y ejecutor.
create or replace function pg_temp.accion(p_usuario uuid, p_accion text, p_datos jsonb)
returns text language plpgsql as $$
declare
  v_cmd uuid;
  v_res jsonb;
begin
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, input_fingerprint, origen, payload)
  values (gen_random_uuid(), p_usuario, gen_random_uuid(), p_accion, md5(random()::text), 'n8n-worker-gated-rc1',
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
  ua uuid := gen_random_uuid();
  hoy date := (now() at time zone 'America/Asuncion')::date;
  salida text;
  r jsonb;
  n integer;
  resumen date;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-v226-' || ua || '@test.invalid', '{}');

  -- Lo que ya tenía la cuenta antes del mensaje.
  salida := pg_temp.accion(ua, 'REGISTRAR_TARJETA', jsonb_build_object(
    'tarjeta', 'Green ****7450', 'emisor', 'American Express', 'moneda', 'PYG',
    'linea', 3000000, 'saldo', 2832181, 'dia_cierre', 15, 'dia_vencimiento', 6,
    'pago_minimo', 188000, 'resumen_al', (hoy - 6)::text));
  perform pg_temp.chk('preparación: la tarjeta Green queda cargada', salida like 'ok:%', salida);

  salida := pg_temp.accion(ua, 'REGISTRAR_MOVIMIENTO_PERSONAL', jsonb_build_object('movimientos', jsonb_build_array(
    jsonb_build_object('tipo', 'gasto', 'monto', 22650, 'descripcion', 'Punto Farma - Molas López', 'fecha', (hoy - 2)::text))));
  perform pg_temp.chk('preparación: el gasto de 22.650 de hace dos días', salida like 'ok:%', salida);

  -- 1. El mensaje: la compra con la Green y el ingreso, cada uno a su lugar.
  salida := pg_temp.accion(ua, 'REGISTRAR_COMPRA_TARJETA', '{"tarjeta": "Green", "total": 46000, "descripcion": "Punto Farma"}');
  r := substr(salida, 4)::jsonb;
  select count(*) into n from public.eos_finanzas_tarjeta_compras c where c.usuario_id = ua and c.monto_total = 46000;
  perform pg_temp.chk('compra: se anota una vez, en la Green',
    salida like 'ok:%' and n = 1 and r ->> 'tarjeta' = 'Green ****7450' and coalesce(r ->> 'ya_estaba', 'false') = 'false', salida);

  perform pg_temp.chk('compra: no aparece como gasto de Personal',
    not exists (select 1 from public.eos_movimientos_financieros m where m.usuario_id = ua and m.monto = 46000), '');

  salida := pg_temp.accion(ua, 'REGISTRAR_MOVIMIENTO_PERSONAL', '{"movimientos": [{"tipo": "ingreso", "monto": 100000, "descripcion": "Ingreso"}]}');
  select count(*) into n from public.eos_movimientos_financieros m where m.usuario_id = ua and m.tipo = 'ingreso' and m.monto = 100000;
  perform pg_temp.chk('ingreso: se anota en Personal', salida like 'ok:%' and n = 1, salida);

  -- 2. El pago del resumen, dicho con su monto (v222): baja el usado de la
  --    Green y anota la salida. (Que "ya pagué el mínimo" dicho AL PASAR no
  --    mande esta acción es del prompt: lo mide la batería, green-varias-cosas.)
  salida := pg_temp.accion(ua, 'REGISTRAR_PAGO_DEUDA', '{"acreedor": "Green", "monto": 188000}');
  select count(*) into n from public.eos_movimientos_financieros m
  where m.usuario_id = ua and m.monto = 188000 and m.descripcion = 'Pago de tarjeta — Green ****7450';
  perform pg_temp.chk('pago explícito de la tarjeta: baja el usado y anota la salida una vez',
    salida like 'ok:%"es_tarjeta": true%' and salida like '%"saldo_despues": 2644181%' and n = 1, salida);

  -- 3. "No cargaste el débito": el 22.650 de la captura, con otra descripción.
  salida := pg_temp.accion(ua, 'REGISTRAR_MOVIMIENTO_PERSONAL', jsonb_build_object('movimientos', jsonb_build_array(
    jsonb_build_object('tipo', 'gasto', 'monto', 22650, 'descripcion', 'Punto Farma - débito Ueno', 'fecha', (hoy - 2)::text))));
  r := substr(salida, 4)::jsonb;
  select count(*) into n from public.eos_movimientos_financieros m where m.usuario_id = ua and m.monto = 22650;
  perform pg_temp.chk('gasto de una captura que ya estaba: no se duplica y se dice cómo estaba',
    salida like 'ok:%' and n = 1 and jsonb_array_length(r -> 'repetidos') = 1
    and r -> 'repetidos' -> 0 ->> 'como' = 'Punto Farma - Molas López'
    and jsonb_array_length(r -> 'movimientos') = 0, salida);

  -- 4. Los tres "no está": la compra vuelve a llegar, con y sin la terminación.
  salida := pg_temp.accion(ua, 'REGISTRAR_COMPRA_TARJETA', '{"tarjeta": "Green", "total": 46000, "descripcion": "Punto Farma"}');
  r := substr(salida, 4)::jsonb;
  select count(*) into n from public.eos_finanzas_tarjeta_compras c where c.usuario_id = ua and c.monto_total = 46000;
  perform pg_temp.chk('la misma compra otra vez: ya estaba, no hay segunda',
    salida like 'ok:%' and n = 1 and r ->> 'ya_estaba' = 'true' and r ->> 'anotada_a_las' is not null, salida);

  salida := pg_temp.accion(ua, 'REGISTRAR_COMPRA_TARJETA', '{"tarjeta": "Green ****7450", "total": 46000, "descripcion": "Compra Punto Farma"}');
  select count(*) into n from public.eos_finanzas_tarjeta_compras c where c.usuario_id = ua and c.monto_total = 46000;
  perform pg_temp.chk('la misma compra dicha distinto: tampoco se duplica', salida like '%"ya_estaba": true%' and n = 1, salida);

  -- 5. REGISTRAR_TARJETA con lo que el modelo ya tenía en el contexto.
  salida := pg_temp.accion(ua, 'REGISTRAR_TARJETA', '{"tarjeta": "Green ****7450", "pago_minimo": 188000, "dia_cierre": 15, "dia_vencimiento": 6}');
  r := substr(salida, 4)::jsonb;
  select t.resumen_al into resumen from public.eos_finanzas_tarjetas t where t.usuario_id = ua and t.nombre = 'Green ****7450';
  perform pg_temp.chk('tarjeta repetida igual: sin cambios y el resumen conserva su fecha',
    salida like 'ok:%' and r ->> 'sin_cambios' = 'true' and resumen = hoy - 6, salida);

  salida := pg_temp.accion(ua, 'REGISTRAR_TARJETA', '{"tarjeta": "Green ****7450", "emisor": "Banco Basa"}');
  r := substr(salida, 4)::jsonb;
  perform pg_temp.chk('tarjeta con un dato distinto: dice qué cambió, con el antes',
    salida like 'ok:%' and r ->> 'sin_cambios' = 'false'
    and r -> 'cambios' @> '[{"campo": "emisor", "antes": "American Express", "despues": "Banco Basa"}]', salida);

  -- 6. Lo que NO tiene que frenar.
  salida := pg_temp.accion(ua, 'REGISTRAR_COMPRA_TARJETA', '{"tarjeta": "Green", "total": 46000, "descripcion": "Punto Farma", "repetir": true}');
  select count(*) into n from public.eos_finanzas_tarjeta_compras c where c.usuario_id = ua and c.monto_total = 46000;
  perform pg_temp.chk('otra compra igual, dicha como otra (repetir): se anota', salida like 'ok:%' and n = 2, salida);

  salida := pg_temp.accion(ua, 'REGISTRAR_COMPRA_TARJETA', '{"tarjeta": "Green", "total": 46000, "descripcion": "Stock"}');
  select count(*) into n from public.eos_finanzas_tarjeta_compras c where c.usuario_id = ua and c.monto_total = 46000;
  perform pg_temp.chk('mismo monto en otro comercio: se anota', salida like 'ok:%' and salida not like '%ya_estaba%' and n = 3, salida);

  salida := pg_temp.accion(ua, 'REGISTRAR_MOVIMIENTO_PERSONAL', '{"movimientos": [{"tipo": "gasto", "monto": 5000, "descripcion": "Pasaje"}, {"tipo": "gasto", "monto": 5000, "descripcion": "Pasaje"}]}');
  select count(*) into n from public.eos_movimientos_financieros m where m.usuario_id = ua and m.monto = 5000;
  perform pg_temp.chk('dos pasajes iguales en un mismo mensaje: son dos', salida like 'ok:%' and n = 2, salida);

  salida := pg_temp.accion(ua, 'REGISTRAR_MOVIMIENTO_PERSONAL', '{"movimientos": [{"tipo": "ingreso", "monto": 100000, "descripcion": "Ingreso", "otra_igual": true}]}');
  select count(*) into n from public.eos_movimientos_financieros m where m.usuario_id = ua and m.tipo = 'ingreso' and m.monto = 100000;
  perform pg_temp.chk('otro ingreso igual, dicho como otro: se anota', salida like 'ok:%' and n = 2, salida);

  salida := pg_temp.accion(ua, 'REGISTRAR_MOVIMIENTO_PERSONAL', '{"movimientos": [{"tipo": "ingreso", "monto": 100000, "descripcion": "Ingreso"}]}');
  select count(*) into n from public.eos_movimientos_financieros m where m.usuario_id = ua and m.tipo = 'ingreso' and m.monto = 100000;
  perform pg_temp.chk('el mismo ingreso reenviado enseguida: ya estaba', salida like '%"repetidos": [{%' and n = 2, salida);

  -- 7. La tarjeta se lee con las compras, como la lee la pantalla.
  select count(*) into n
  from public.eos_finanzas_tarjetas t
  join public.eos_finanzas_tarjeta_compras c on c.tarjeta_id = t.id
  where t.usuario_id = ua and t.ambito = 'personal' and t.activa and c.cuotas_pagadas < c.cuotas_totales;
  perform pg_temp.chk('la lectura de Tarjetas encuentra las compras vivas', n = 3, n::text);
end;
$$;

-- Los resultados viajan en el error, que además deshace todo.
do $$
begin
  raise exception 'EOS_E2E_V226 %', (select string_agg(case when ok then 'OK    ' || prueba else 'FALLA ' || prueba || '  ->  ' || left(detalle, 400) end, ' ## ' order by n) from _r);
end;
$$;
