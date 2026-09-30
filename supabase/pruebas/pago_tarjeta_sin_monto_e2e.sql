-- Prueba de la v227: un pago de tarjeta sin monto dicho no se anota.
--
--     cat supabase/pruebas/pago_tarjeta_sin_monto_e2e_inicio.sql \
--         supabase/migrations/20260930105000_eos_pago_tarjeta_sin_monto_v227.sql \
--         supabase/pruebas/pago_tarjeta_sin_monto_e2e.sql > /tmp/e2e227.sql
--     npx supabase db query --linked -f /tmp/e2e227.sql
--
-- Termina en un error a propósito, con los resultados adentro: no queda nada
-- escrito. Usa una cuenta sintética creada adentro de la transacción.

create temp table _r (n serial, prueba text, ok boolean, detalle text);

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

create or replace function pg_temp.pagar(p_usuario uuid, p_datos jsonb)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := public.eos_finanzas_pagar_deuda_v139(p_usuario, null, p_datos);
  return 'ok:' || v::text;
exception when others then
  return 'error:' || sqlerrm;
end;
$$;

do $$
declare
  ua uuid := gen_random_uuid();
  salida text;
  saldo numeric;
  movimientos int;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-v227-' || ua || '@test.invalid', '{}');
  insert into public.eos_finanzas_tarjetas (usuario_id, nombre, emisor, pago_minimo, resumen_al, saldo_utilizado, saldo_al)
  values (ua, 'Green', 'American Express', 188000, current_date, 2000000, current_date);

  -- 1. "Ya pagué el mínimo de la Green": sin monto, no se paga nada.
  salida := pg_temp.pagar(ua, '{"acreedor": "Green"}');
  select saldo_utilizado into saldo from public.eos_finanzas_tarjetas where usuario_id = ua;
  select count(*) into movimientos from public.eos_movimientos_financieros where usuario_id = ua;
  perform pg_temp.chk('sin monto: no se paga y se pregunta',
    salida like 'error:EOS_ACCION_PAGO_TARJETA_SIN_MONTO: Green · 188000%', salida);
  perform pg_temp.chk('sin monto: el saldo queda igual y no hay movimiento',
    saldo = 2000000 and movimientos = 0, saldo::text || ' / ' || movimientos);

  -- 2. Con el monto dicho, se paga como antes.
  salida := pg_temp.pagar(ua, '{"acreedor": "Green", "monto": "188.000"}');
  select saldo_utilizado into saldo from public.eos_finanzas_tarjetas where usuario_id = ua;
  select count(*) into movimientos from public.eos_movimientos_financieros where usuario_id = ua;
  perform pg_temp.chk('con monto: se paga y baja el saldo',
    salida like 'ok:%' and saldo = 1812000 and movimientos = 1, salida || ' / ' || saldo);
end;
$$;

do $$ begin
  raise exception 'EOS_E2E_V227 %', (select json_agg(json_build_object('prueba', prueba, 'ok', ok, 'detalle', left(detalle, 160)) order by n) from _r);
end $$;
