-- Prueba de la v215: una venta a un cliente que no está agendado se registra igual.
--
-- Corre la migración y la prueba en UNA transacción que termina en un error a
-- propósito, con los resultados adentro del mensaje: no queda nada escrito.
--
--     cat supabase/pruebas/venta_cliente_nuevo_e2e_inicio.sql \
--         supabase/migrations/20260929161000_eos_venta_cliente_nuevo_v215.sql \
--         supabase/pruebas/venta_cliente_nuevo_e2e.sql > /tmp/e2e215.sql
--     npx supabase db query --linked -f /tmp/e2e215.sql
--
-- (Con la v215 ya aplicada, alcanza con el inicio y este archivo.)

create temp table _r (n serial, prueba text, ok boolean, detalle text);

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

-- La venta entera como la corre el worker: orden, autorización y ejecutor.
create or replace function pg_temp.vender(p_usuario uuid, p_datos jsonb)
returns text language plpgsql as $$
declare
  v_cmd uuid;
  v_res jsonb;
begin
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, input_fingerprint, origen, payload)
  values (gen_random_uuid(), p_usuario, gen_random_uuid(), 'REGISTRAR_VENTA', md5(random()::text), 'n8n-worker-gated-rc1',
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
  salida text;
  antes integer;
  despues integer;
  venta_contacto uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-v215-' || ua || '@test.invalid', '{}');
  insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen) values (ua, 'erp', 'activo', 'prueba');

  insert into public.eos_crm_contactos (usuario_id, nombre) values (ua, 'Marcos Benítez');
  insert into public.eos_crm_contactos (usuario_id, nombre) values (ua, 'Gladys');
  insert into public.eos_crm_contactos (usuario_id, nombre) values (ua, 'Rossana Giménez');
  insert into public.eos_crm_contactos (usuario_id, nombre) values (ua, 'Rossana Pérez');

  -- 1. Cliente nuevo: se agenda y la venta queda a su nombre.
  salida := pg_temp.vender(ua, '{"contacto": "Sheyla Ortiz", "items": [{"producto": "Pan casero", "cantidad": 2, "precio_unitario": 5000}]}');
  perform pg_temp.chk('cliente nuevo: la venta se registra', salida like 'ok:%', salida);
  perform pg_temp.chk('cliente nuevo: el resultado lo dice', salida like '%"contacto_creado": "Sheyla Ortiz"%', salida);

  select v.contacto_id into venta_contacto
  from public.eos_erp_ventas v where v.usuario_id = ua order by v.creado_en desc limit 1;
  perform pg_temp.chk('cliente nuevo: quedó agendado como cliente y la venta es suya',
    exists (select 1 from public.eos_crm_contactos c
            where c.id = venta_contacto and c.nombre = 'Sheyla Ortiz' and c.es_cliente and c.activo),
    coalesce(venta_contacto::text, 'sin contacto'));

  -- 2. Cliente que ya está: como siempre, sin crear nada.
  select count(*) into antes from public.eos_crm_contactos where usuario_id = ua;
  salida := pg_temp.vender(ua, '{"contacto": "Marcos Benítez", "items": [{"producto": "Pan casero", "cantidad": 1}]}');
  select count(*) into despues from public.eos_crm_contactos where usuario_id = ua;
  perform pg_temp.chk('cliente agendado: la venta se registra sin crear otro',
    salida like 'ok:%' and salida not like '%contacto_creado%' and antes = despues, salida);

  -- 3. Se parece a uno ("Gladys Velilla" con "Gladys"): pregunta, no duplica.
  salida := pg_temp.vender(ua, '{"contacto": "Gladys Velilla", "items": [{"producto": "Pan casero", "cantidad": 1}]}');
  select count(*) into despues from public.eos_crm_contactos where usuario_id = ua;
  perform pg_temp.chk('parecido a uno: pregunta y no crea',
    salida like 'error:%EOS_ACCION_CONTACTO_AMBIGUO%' and antes = despues, salida);

  -- 4. Dos Rossanas: pregunta cuál.
  salida := pg_temp.vender(ua, '{"contacto": "Rossana", "items": [{"producto": "Pan casero", "cantidad": 1}]}');
  perform pg_temp.chk('dos parecidos: pregunta cuál', salida like 'error:%EOS_ACCION_CONTACTO_AMBIGUO%', salida);

  -- 5. Sin cliente: consumidor final, como siempre.
  salida := pg_temp.vender(ua, '{"items": [{"producto": "Pan casero", "cantidad": 3}]}');
  perform pg_temp.chk('sin cliente: consumidor final', salida like 'ok:%' and salida not like '%contacto_creado%', salida);
end;
$$;

-- Los resultados viajan en el error, que además deshace todo.
do $$
begin
  raise exception 'EOS_E2E_V215 %', (select json_agg(json_build_object('prueba', prueba, 'ok', ok, 'detalle', left(detalle, 200)) order by n) from _r);
end;
$$;
