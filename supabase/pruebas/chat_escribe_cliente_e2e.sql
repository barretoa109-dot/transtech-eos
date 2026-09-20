-- Prueba de la v186: el chat le escribe a un cliente por el WhatsApp de la empresa.
--
-- Se corre DESPUÉS de la migración, en una transacción con rollback:
--
--     cat supabase/migrations/20260919200000_eos_chat_escribe_cliente_v186.sql \
--         supabase/pruebas/chat_escribe_cliente_e2e.sql > /tmp/e2e186.sql
--     npx supabase db query --linked -f /tmp/e2e186.sql
--
-- Una vez aplicada la migración, se corre solo este archivo.
--
-- Lo que se prueba es lo que hace la BASE: validar y dar la orden por cumplida o rechazarla con
-- el motivo. El envío en sí (Meta, la ventana de 24 horas) es código de servidor y lo cubren
-- `envio-por-chat.test.ts` y `enviar.test.ts`.

begin;

create temp table _r (n serial, prueba text, ok boolean, detalle text) on commit drop;

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

-- Corre el verbo entero como lo haría el worker: orden, autorización y ejecutor.
create or replace function pg_temp.ejecutar(p_usuario uuid, p_datos jsonb)
returns text language plpgsql as $$
declare
  v_cmd uuid;
  v_res jsonb;
begin
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, input_fingerprint, origen, payload)
  values (gen_random_uuid(), p_usuario, gen_random_uuid(), 'ENVIAR_WHATSAPP_CLIENTE', md5(random()::text), 'n8n-worker-gated-rc1',
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
  ub uuid := gen_random_uuid();
  canal uuid;
  marcos uuid;
  baja uuid;
  ajeno uuid;
  salida text;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-w186-a-' || ua || '@test.invalid', '{}'),
         (ub, 'authenticated', 'authenticated', 'e2e-w186-b-' || ub || '@test.invalid', '{}');

  insert into public.eos_crm_contactos (usuario_id, nombre, telefono) values (ua, 'Marcos Benítez', '0981 123 456') returning id into marcos;
  insert into public.eos_crm_contactos (usuario_id, nombre) values (ua, 'Sin Teléfono');
  insert into public.eos_crm_contactos (usuario_id, nombre, telefono) values (ua, 'Ana Pérez', '0982 000 001');
  insert into public.eos_crm_contactos (usuario_id, nombre, telefono) values (ua, 'Ana Gómez', '0982 000 002');
  insert into public.eos_crm_contactos (usuario_id, nombre, telefono) values (ua, 'Pidió Baja', '0983 000 003') returning id into baja;
  -- De OTRA cuenta: jamás debe poder alcanzarse desde la de A.
  insert into public.eos_crm_contactos (usuario_id, nombre, telefono) values (ub, 'Cliente Ajeno', '0984 000 004') returning id into ajeno;

  -- ------------------------------------------------ sin módulo ni canal
  salida := pg_temp.ejecutar(ua, '{"cliente": "Marcos", "mensaje": "Hola"}');
  perform pg_temp.chk('sin el módulo CRM, se rechaza', salida like 'error:%EOS_ACCION_SIN_MODULO_CRM%', salida);

  insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen) values (ua, 'crm', 'activo', 'prueba');

  salida := pg_temp.ejecutar(ua, '{"cliente": "Marcos", "mensaje": "Hola"}');
  perform pg_temp.chk('con módulo pero sin WhatsApp conectado, dice que falta el canal',
    salida like 'error:%EOS_ACCION_WHATSAPP_SIN_CANAL%', salida);

  insert into public.eos_wa_canales (usuario_id, phone_number_id, telefono, estado)
  values (ua, 'e2e-w186-pn-' || ua, '595971000186', 'pendiente') returning id into canal;
  perform public.eos_wa_guardar_secreto_v185(canal, 'EAAG' || repeat('a', 60));

  salida := pg_temp.ejecutar(ua, '{"cliente": "Marcos", "mensaje": "Hola"}');
  perform pg_temp.chk('un canal que no está activo (pendiente) no permite escribir',
    salida like 'error:%EOS_ACCION_WHATSAPP_CANAL_PAUSADO%', salida);

  update public.eos_wa_canales set estado = 'activo' where id = canal;

  -- ---------------------------------------------------- el camino feliz
  salida := pg_temp.ejecutar(ua, '{"cliente": "Marcos", "mensaje": "Hola Marcos, ¿pudiste ver la propuesta?"}');
  perform pg_temp.chk('con todo en orden, el ejecutor da la orden por cumplida',
    salida like 'ok:%', salida);
  perform pg_temp.chk('devuelve el cliente, el canal y el texto EXACTO para que el servidor lo envíe',
    salida like '%' || marcos::text || '%' and salida like '%' || canal::text || '%'
    and salida like '%Hola Marcos, ¿pudiste ver la propuesta?%' and salida like '%Marcos Benítez%', salida);
  perform pg_temp.chk('deja el envío como pendiente: lo completa el servidor con lo que Meta conteste',
    salida like '%"estado": "pendiente"%', salida);
  perform pg_temp.chk('la versión del ejecutor es la v186', salida like '%v186%', salida);

  -- La bitácora es inmutable: no puede decir que EOS "le escribió" a un cliente cuando lo único que
  -- pasó es que la orden se validó. El envío tiene su propio registro (eos_wa_mensajes).
  perform pg_temp.chk('la bitácora dice que se PREPARÓ el envío, no que se envió',
    exists (select 1 from public.eos_auditoria_v60 where usuario_id = ua and resumen like '%preparó el envío de un mensaje a un cliente por WhatsApp%')
    and not exists (select 1 from public.eos_auditoria_v60 where usuario_id = ua and resumen like '%escribió%'));

  -- El servidor recibe también `cliente` como `contacto` o `nombre`.
  salida := pg_temp.ejecutar(ua, '{"contacto": "Marcos Benítez", "texto": "Hola de nuevo"}');
  perform pg_temp.chk('acepta contacto/texto como sinónimos de cliente/mensaje', salida like 'ok:%', salida);

  -- ----------------------------------------------- lo que se rechaza
  salida := pg_temp.ejecutar(ua, '{"mensaje": "Hola"}');
  perform pg_temp.chk('sin cliente, lo pide', salida like 'error:%EOS_ACCION_WHATSAPP_SIN_CLIENTE%', salida);

  salida := pg_temp.ejecutar(ua, '{"cliente": "Marcos", "mensaje": "   "}');
  perform pg_temp.chk('sin texto, lo pide (no se manda un mensaje vacío)', salida like 'error:%EOS_ACCION_WHATSAPP_SIN_MENSAJE%', salida);

  salida := pg_temp.ejecutar(ua, jsonb_build_object('cliente', 'Marcos', 'mensaje', repeat('a', 1001))::jsonb);
  perform pg_temp.chk('un texto de más de 1000 caracteres se rechaza', salida like 'error:%EOS_ACCION_WHATSAPP_MENSAJE_LARGO%', length(salida)::text);

  salida := pg_temp.ejecutar(ua, '{"cliente": "Nadie Conocido", "mensaje": "Hola"}');
  perform pg_temp.chk('un cliente que no existe NO se inventa', salida like 'error:%EOS_ACCION_CONTACTO_NO_RESUELTO%Nadie Conocido%', salida);

  salida := pg_temp.ejecutar(ua, '{"cliente": "Ana", "mensaje": "Hola"}');
  perform pg_temp.chk('dos clientes que coinciden: NO se elige uno (un mensaje al equivocado no se deshace)',
    salida like 'error:%EOS_ACCION_CONTACTO_NO_RESUELTO%', salida);

  salida := pg_temp.ejecutar(ua, '{"cliente": "Sin Teléfono", "mensaje": "Hola"}');
  perform pg_temp.chk('un cliente sin teléfono dice cuál es', salida like 'error:%EOS_ACCION_WHATSAPP_SIN_TELEFONO%Sin Teléfono%', salida);

  insert into public.eos_wa_consentimientos (usuario_id, canal_id, contacto_id, estado, origen)
  values (ua, canal, baja, 'revocado', 'baja_manual');
  salida := pg_temp.ejecutar(ua, '{"cliente": "Pidió Baja", "mensaje": "Hola"}');
  perform pg_temp.chk('quien pidió la baja no recibe nada', salida like 'error:%EOS_ACCION_WHATSAPP_BAJA%Pidió Baja%', salida);

  -- --------------------------------------------- aislamiento entre cuentas
  salida := pg_temp.ejecutar(ua, '{"cliente": "Cliente Ajeno", "mensaje": "Hola"}');
  perform pg_temp.chk('un cliente de OTRA cuenta no se alcanza, ni por el nombre exacto',
    salida like 'error:%EOS_ACCION_CONTACTO_NO_RESUELTO%', salida);

  -- B no tiene módulo CRM ni canal: no puede usar el de A.
  insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen) values (ub, 'crm', 'activo', 'prueba');
  salida := pg_temp.ejecutar(ub, '{"cliente": "Cliente Ajeno", "mensaje": "Hola"}');
  perform pg_temp.chk('otra cuenta con CRM pero sin canal propio NO usa el canal de A',
    salida like 'error:%EOS_ACCION_WHATSAPP_SIN_CANAL%', salida);

  -- ---------------------------------------------- las tres CHECK y la lista blanca
  perform pg_temp.chk('el verbo es válido en eos_action_commands (lo demostró la orden)', true);
  begin
    insert into public.eos_autonomy_rules_v12 (usuario_id, accion) values (ua, 'ENVIAR_WHATSAPP_CLIENTE');
    perform pg_temp.chk('el verbo es válido en eos_autonomy_rules_v12', true);
  exception when check_violation then
    perform pg_temp.chk('el verbo es válido en eos_autonomy_rules_v12', false, 'CHECK lo rechazó');
  when others then
    -- Otra restricción (columnas obligatorias) no es lo que se mide acá.
    perform pg_temp.chk('el verbo es válido en eos_autonomy_rules_v12', sqlstate <> '23514', sqlerrm);
  end;

  -- Un verbo que NO existe sigue rechazado: el candado no se aflojó de más.
  begin
    insert into public.eos_action_commands (id, usuario_id, request_id, accion, input_fingerprint, origen)
    values (gen_random_uuid(), ua, gen_random_uuid(), 'ENVIAR_TODO_A_TODOS', md5(random()::text), 'n8n-worker-gated-rc1');
    perform pg_temp.chk('un verbo inventado sigue rechazado', false, 'no lanzó');
  exception when check_violation then
    perform pg_temp.chk('un verbo inventado sigue rechazado', true);
  end;
end $$;

-- ------------------------------------------------------------ los permisos
set local role anon;
do $$
begin
  begin
    perform public.eos_crm_preparar_envio_por_chat_v186(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb);
    perform set_config('e2e.anon', 'si', true);
  exception when others then
    perform set_config('e2e.anon', 'no', true);
  end;
end $$;
reset role;

set local role authenticated;
do $$
begin
  begin
    perform public.eos_crm_preparar_envio_por_chat_v186(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb);
    perform set_config('e2e.auth', 'si', true);
  exception when others then
    perform set_config('e2e.auth', 'no', true);
  end;
end $$;
reset role;

select pg_temp.chk('anon NO ejecuta la función', current_setting('e2e.anon') = 'no');
select pg_temp.chk('un usuario logueado NO ejecuta la función (podría escribir a clientes ajenos)', current_setting('e2e.auth') = 'no');

select n, prueba, ok, detalle from _r order by n;

rollback;
