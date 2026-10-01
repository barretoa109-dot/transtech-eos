-- Aprobación por WhatsApp (01/10/2026): lo que garantiza la base.
--
--     cat supabase/pruebas/plan_efectivo_e2e_inicio.sql \
--         supabase/pruebas/aprobacion_whatsapp_e2e.sql > /tmp/e2e-aprob.sql
--     npx supabase db query --linked -f /tmp/e2e-aprob.sql
--
-- (el inicio es solo `begin;`). Termina en un error a propósito, con los
-- resultados adentro: no queda nada escrito. Cuentas sintéticas.
--
-- Reproduce las MISMAS consultas que hace `lib/autonomia/resolver-aprobacion.ts`
-- (update con usuario_id y status = 'pending') y la función que consume el
-- Worker Gate, para probar: una sola transición, una sola ejecución, y que
-- nadie aprueba ni consume lo de otro.

create temp table _r (n serial, prueba text, ok boolean, detalle text);

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

create or replace function pg_temp.consumir(p_aprobacion uuid, p_comando uuid) returns text language plpgsql as $$
begin
  perform public.eos_consume_action_approval_v12(p_aprobacion, p_comando);
  return 'ok';
exception when others then
  return 'error:' || sqlerrm;
end;
$$;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  req uuid := gen_random_uuid();
  aprob uuid := gen_random_uuid();
  cmd uuid := gen_random_uuid();
  cmd_b uuid := gen_random_uuid();
  v_payload jsonb := '{"datos": {"items": [{"producto": "Balanceado", "cantidad": 3}]}}';
  filas int;
  salida text;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into auth.users (id, aud, role, email, raw_user_meta_data) values
    (a, 'authenticated', 'authenticated', 'e2e-aprob-a-' || a || '@test.invalid', '{}'),
    (b, 'authenticated', 'authenticated', 'e2e-aprob-b-' || b || '@test.invalid', '{}');

  insert into public.eos_action_approvals_v12
    (id, usuario_id, request_id, accion, requested_level, effective_level, expires_at, payload_snapshot)
  values (aprob, a, req, 'REGISTRAR_VENTA', 2, 2, now() + interval '1 hour', v_payload);

  -- 1. B (otra cuenta) intenta aprobar lo de A con la consulta del módulo: 0 filas.
  update public.eos_action_approvals_v12 set status = 'approved'
  where id = aprob and usuario_id = b and status = 'pending';
  get diagnostics filas = row_count;
  perform pg_temp.chk('otra cuenta no aprueba lo ajeno', filas = 0, filas::text);

  -- 2. A aprueba: una fila. Un segundo "SÍ" (reenvío o doble toque): 0 filas.
  update public.eos_action_approvals_v12 set status = 'approved'
  where id = aprob and usuario_id = a and status = 'pending';
  get diagnostics filas = row_count;
  perform pg_temp.chk('el primer SÍ aprueba', filas = 1, filas::text);
  update public.eos_action_approvals_v12 set status = 'approved'
  where id = aprob and usuario_id = a and status = 'pending';
  get diagnostics filas = row_count;
  perform pg_temp.chk('el segundo SÍ no vuelve a aprobar', filas = 0, filas::text);

  -- 3. Una orden de OTRA cuenta no puede consumir la aprobación de A.
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, payload, estado)
  values (cmd_b, b, req, 'REGISTRAR_VENTA', v_payload, 'recibida');
  salida := pg_temp.consumir(aprob, cmd_b);
  perform pg_temp.chk('una orden ajena no consume la aprobación', salida like 'error:%no pertenece%', salida);

  -- 4. Una orden con OTRO contenido no la consume (lo aprobado es lo que se ejecuta).
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, payload, estado)
  values (cmd, a, req, 'REGISTRAR_VENTA', '{"datos": {"items": [{"producto": "Balanceado", "cantidad": 30}]}}', 'recibida');
  salida := pg_temp.consumir(aprob, cmd);
  perform pg_temp.chk('un payload distinto del aprobado no se ejecuta', salida like 'error:%PAYLOAD_MISMATCH%', salida);

  -- 5. La orden correcta la consume UNA vez; la segunda vez, no.
  update public.eos_action_commands set payload = '{"datos": {"items": [{"producto": "Balanceado", "cantidad": 3}]}}' where id = cmd;
  salida := pg_temp.consumir(aprob, cmd);
  perform pg_temp.chk('la orden correcta consume la aprobación', salida = 'ok', salida);
  salida := pg_temp.consumir(aprob, cmd);
  perform pg_temp.chk('no se consume dos veces', salida like 'error:%no está disponible%', salida);

  -- 6. Rechazar algo ya consumido: 0 filas.
  update public.eos_action_approvals_v12 set status = 'rejected'
  where id = aprob and usuario_id = a and status = 'pending';
  get diagnostics filas = row_count;
  perform pg_temp.chk('no se rechaza lo ya consumido', filas = 0, filas::text);

  -- 7. Vencida: el consumo la marca vencida y no ejecuta.
  aprob := gen_random_uuid();
  req := gen_random_uuid();
  cmd := gen_random_uuid();
  insert into public.eos_action_approvals_v12
    (id, usuario_id, request_id, accion, requested_level, effective_level, expires_at, payload_snapshot, status, created_at)
  values (aprob, a, req, 'REGISTRAR_VENTA', 2, 2, now() - interval '1 minute', v_payload, 'approved', now() - interval '2 hours');
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, payload, estado)
  values (cmd, a, req, 'REGISTRAR_VENTA', v_payload, 'recibida');
  salida := pg_temp.consumir(aprob, cmd);
  perform pg_temp.chk('vencida no se ejecuta', salida like 'error:%venció%', salida);

  -- 8. Solo el servidor: anon y authenticated no pueden consumir.
  perform pg_temp.chk('anon y authenticated no ejecutan el consumo',
    not has_function_privilege('anon', 'public.eos_consume_action_approval_v12(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.eos_consume_action_approval_v12(uuid,uuid)', 'execute'));
end;
$$;

do $$ begin
  raise exception 'EOS_E2E_APROB %', (select json_agg(json_build_object('prueba', prueba, 'ok', ok, 'detalle', left(detalle, 160)) order by n) from _r);
end $$;
