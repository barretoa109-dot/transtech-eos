-- Prueba de extremo a extremo del canal de WhatsApp de la empresa (v177).
--
-- NO es una migración: vive fuera de `supabase/migrations` y no se aplica. Se
-- corre CONTRA LA MIGRACIÓN, dentro de una transacción que termina en
-- `rollback`, así que no deja una sola fila ni una sola tabla nueva:
--
--     cat supabase/migrations/20260918170000_eos_whatsapp_crm_v177.sql \
--         supabase/pruebas/whatsapp_crm_e2e.sql > /tmp/e2e.sql
--     npx supabase db query --linked -f /tmp/e2e.sql
--
-- (la migración va PRIMERO: el archivo de abajo asume que ya está aplicada y
-- abre y cierra la transacción)
--
-- Devuelve una fila por comprobación. Todas tienen que dar `ok = true`.
--
-- Lo que cubre:
--   · dos empresas con EL MISMO teléfono de cliente: cada mensaje va a su fuente
--   · el cliente existente se reconoce, el desconocido se crea
--   · Meta reintenta el mismo webhook: no se duplica nada
--   · consulta de precio → oportunidad; "lo voy a pensar" → seguimiento
--   · la baja revoca y volver a escribir NO la levanta
--   · un cliente de otra empresa no puede recibir por este canal
--   · los estados de un mensaje solo avanzan
--   · la bitácora no se puede reescribir
--   · RLS: una empresa no ve las conversaciones de la otra; anon no ejecuta nada

begin;

create temp table _r (n serial, prueba text, ok boolean, detalle text) on commit drop;
grant all on _r to public;
grant usage, select on sequence _r_n_seq to public;

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  ca uuid; cb uuid;
  carlos_a uuid; carlos_b uuid;
  r jsonb; r2 jsonb;
  n integer; t text; e text;
begin
  -- Cada `auth.users` crea sola su empresa y su fila en `usuarios` (v109).
  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-a-' || ua || '@test.invalid', '{}'),
         (ub, 'authenticated', 'authenticated', 'e2e-b-' || ub || '@test.invalid', '{}');

  insert into public.eos_wa_canales (usuario_id, phone_number_id, telefono, estado)
  values (ua, 'e2e-pnid-a-' || ua, '595971000001', 'activo') returning id into ca;
  insert into public.eos_wa_canales (usuario_id, phone_number_id, telefono, estado)
  values (ub, 'e2e-pnid-b-' || ub, '595971000002', 'activo') returning id into cb;

  -- El MISMO teléfono en las dos empresas: dos clientes distintos.
  insert into public.eos_crm_contactos (usuario_id, nombre, telefono)
  values (ua, 'Carlos (empresa A)', '0981 123 456') returning id into carlos_a;
  insert into public.eos_crm_contactos (usuario_id, nombre, telefono)
  values (ub, 'Carlos (empresa B)', '+595 981 123456') returning id into carlos_b;

  perform pg_temp.chk('empresa A y B son distintas',
    public.eos_empresa_de_v109(ua) is distinct from public.eos_empresa_de_v109(ub));
  perform pg_temp.chk('el canal hereda la empresa de su dueño',
    (select empresa_id from public.eos_wa_canales where id = ca) = public.eos_empresa_de_v109(ua));

  -- 1. Un cliente existente pregunta el precio por el canal de A.
  r := public.eos_wa_recibir_v177(ca, 'wamid-1', '595981123456',
        'Estoy interesado en el plan empresarial, ¿cuánto cuesta?', 'texto', 'Carlos', now(), 'consulta_precio');

  perform pg_temp.chk('se reconoce al cliente existente (no crea otro)',
    (r->>'contacto_id')::uuid = carlos_a and (r->>'contacto_nuevo')::boolean = false, r::text);
  perform pg_temp.chk('NO toca al cliente de la otra empresa con el mismo teléfono',
    (select count(*) from public.eos_wa_mensajes where contacto_id = carlos_b) = 0
    and (select ultima_interaccion_en from public.eos_crm_contactos where id = carlos_b) is null);
  perform pg_temp.chk('crea la oportunidad del cliente',
    (select count(*) from public.eos_crm_oportunidades where contacto_id = carlos_a and etapa = 'nueva') = 1);
  perform pg_temp.chk('la conversación queda en el historial del cliente (actividad whatsapp)',
    (select count(*) from public.eos_crm_actividades where contacto_id = carlos_a and tipo = 'whatsapp') = 1);
  perform pg_temp.chk('actualiza la última interacción',
    (select ultima_interaccion_en from public.eos_crm_contactos where id = carlos_a) is not null);
  perform pg_temp.chk('escribir primero deja el consentimiento otorgado',
    (select estado from public.eos_wa_consentimientos where canal_id = ca and contacto_id = carlos_a) = 'otorgado');

  -- 2. Meta reintenta el mismo webhook.
  r2 := public.eos_wa_recibir_v177(ca, 'wamid-1', '595981123456', 'Estoy interesado...', 'texto', 'Carlos', now(), 'consulta_precio');
  perform pg_temp.chk('el mismo wamid dos veces no duplica',
    (r2->>'duplicado')::boolean = true
    and (select count(*) from public.eos_wa_mensajes where canal_id = ca and wa_message_id = 'wamid-1') = 1);
  perform pg_temp.chk('ni duplica la oportunidad ni la actividad',
    (select count(*) from public.eos_crm_oportunidades where contacto_id = carlos_a) = 1
    and (select count(*) from public.eos_crm_actividades where contacto_id = carlos_a and tipo = 'whatsapp') = 1);

  -- 3. Un número desconocido: cliente nuevo.
  r := public.eos_wa_recibir_v177(ca, 'wamid-2', '595985999888', 'Hola, ¿tienen disponible?', 'texto', 'Marta', now(), 'interes');
  perform pg_temp.chk('el desconocido se crea como cliente nuevo de WhatsApp',
    (r->>'contacto_nuevo')::boolean = true
    and (select origen from public.eos_crm_contactos where id = (r->>'contacto_id')::uuid) = 'whatsapp'
    and (select nombre from public.eos_crm_contactos where id = (r->>'contacto_id')::uuid) = 'Marta');

  -- 4. "Lo voy a pensar": seguimiento a 3 días.
  perform public.eos_wa_recibir_v177(ca, 'wamid-3', '595981123456', 'Lo voy a pensar, gracias', 'texto', 'Carlos', now(), 'lo_pensara');
  perform pg_temp.chk('"lo voy a pensar" crea un seguimiento pendiente a 3 días',
    (select count(*) from public.eos_crm_actividades
      where contacto_id = carlos_a and tipo = 'tarea' and hecha = false
        and fecha = (now() at time zone 'America/Asuncion')::date + 3) = 1);

  -- 5. Confirma la compra: negociación, sin cerrar la venta sola.
  perform public.eos_wa_recibir_v177(ca, 'wamid-4', '595981123456', 'Dale, confirmo', 'texto', 'Carlos', now(), 'confirma_compra');
  perform pg_temp.chk('confirmar la compra deja la oportunidad en negociación, no ganada',
    (select etapa from public.eos_crm_oportunidades where contacto_id = carlos_a order by creado_en desc limit 1) = 'negociacion');
  perform pg_temp.chk('y avisa al dueño que falta autorizar la venta',
    (select count(*) from public.eos_wa_eventos where contacto_id = carlos_a and evento = 'requiere_atencion_humana') = 1);
  perform pg_temp.chk('no se registró ninguna venta',
    (select count(*) from public.eos_erp_ventas where usuario_id = ua) = 0);

  -- 6. Baja.
  r := public.eos_wa_recibir_v177(ca, 'wamid-5', '595981123456', 'STOP', 'texto', 'Carlos', now(), 'baja');
  perform pg_temp.chk('la baja revoca el consentimiento',
    (r->>'opt_out')::boolean = true
    and (select estado from public.eos_wa_consentimientos where canal_id = ca and contacto_id = carlos_a) = 'revocado');
  perform pg_temp.chk('la baja queda en la bitácora del canal',
    (select count(*) from public.eos_wa_eventos where contacto_id = carlos_a and evento = 'opt_out') = 1);

  perform public.eos_wa_recibir_v177(ca, 'wamid-6', '595981123456', 'Hola de nuevo', 'texto', 'Carlos', now(), 'otro');
  perform pg_temp.chk('volver a escribir NO levanta la baja',
    (select estado from public.eos_wa_consentimientos where canal_id = ca and contacto_id = carlos_a) = 'revocado');

  perform pg_temp.chk('el contexto de envío informa "revocado"',
    public.eos_wa_contexto_envio_v177(ca, carlos_a)->>'consentimiento' = 'revocado');

  -- 7. Aislamiento del envío.
  begin
    perform public.eos_wa_registrar_saliente_v177(ca, carlos_b, 'k-ajeno', 'Hola', null, 'usuario', 'aprobada', 'en_cola', null);
    perform pg_temp.chk('un cliente de otra empresa NO puede recibir por este canal', false, 'no lanzó');
  exception when others then
    perform pg_temp.chk('un cliente de otra empresa NO puede recibir por este canal',
      sqlerrm like '%EOS_WA_CONTACTO_AJENO%', sqlerrm);
  end;

  -- 8. Saliente idempotente y estados que solo avanzan.
  r := public.eos_wa_registrar_saliente_v177(ca, carlos_a, 'k-1', 'Te escribo por lo del plan', null, 'eos_autonomo', 'ninguna', 'bloqueado', 'El cliente pidió no recibir más mensajes.');
  r2 := public.eos_wa_registrar_saliente_v177(ca, carlos_a, 'k-1', 'Te escribo por lo del plan', null, 'eos_autonomo', 'ninguna', 'bloqueado', 'El cliente pidió no recibir más mensajes.');
  perform pg_temp.chk('la misma orden saliente dos veces no duplica',
    (r2->>'duplicado')::boolean = true and r->>'mensaje_id' = r2->>'mensaje_id');
  perform pg_temp.chk('lo bloqueado queda registrado con su motivo',
    (select motivo from public.eos_wa_mensajes where id = (r->>'mensaje_id')::uuid) like '%no recibir%'
    and (select count(*) from public.eos_wa_eventos where evento = 'envio_bloqueado' and canal_id = ca) = 1);

  r := public.eos_wa_registrar_saliente_v177(ca, carlos_a, 'k-2', 'Respuesta', null, 'usuario', 'aprobada', 'en_cola', null);
  perform public.eos_wa_actualizar_estado_v177(ca, (r->>'mensaje_id')::uuid, 'wamid-out-1', 'enviado', null);
  perform public.eos_wa_actualizar_estado_v177(ca, null, 'wamid-out-1', 'leido', null);
  n := public.eos_wa_actualizar_estado_v177(ca, null, 'wamid-out-1', 'entregado', null);
  perform pg_temp.chk('un "entregado" tardío no pisa un "leído"',
    n = 0 and (select estado from public.eos_wa_mensajes where wa_message_id = 'wamid-out-1') = 'leido');

  -- 9. La bitácora no se reescribe.
  begin
    update public.eos_wa_eventos set resumen = 'reescrito' where canal_id = ca;
    perform pg_temp.chk('la bitácora rechaza UPDATE', false, 'no lanzó');
  exception when others then
    perform pg_temp.chk('la bitácora rechaza UPDATE', sqlerrm like '%append-only%', sqlerrm);
  end;
  begin
    delete from public.eos_wa_eventos where canal_id = ca;
    perform pg_temp.chk('la bitácora rechaza DELETE', false, 'no lanzó');
  exception when others then
    perform pg_temp.chk('la bitácora rechaza DELETE', sqlerrm like '%append-only%', sqlerrm);
  end;

  -- 10. Borrar un cliente no falla por tener historial en la bitácora.
  begin
    delete from public.eos_crm_contactos where id = carlos_a;
    perform pg_temp.chk('se puede borrar un cliente con historial en la bitácora', true);
  exception when others then
    perform pg_temp.chk('se puede borrar un cliente con historial en la bitácora', false, sqlerrm);
  end;

  -- Para las pruebas de RLS, que corren con otro rol.
  perform set_config('e2e.ua', ua::text, false);
  perform set_config('e2e.ub', ub::text, false);
  perform set_config('e2e.ca', ca::text, false);
end $$;

-- ---------------------------------------------------------------- RLS
-- Como la empresa B: no ve NADA del canal de la A.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('e2e.ub'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config('e2e.b_mensajes', (select count(*) from public.eos_wa_mensajes)::text, true);
select set_config('e2e.b_canales', (select count(*) from public.eos_wa_canales)::text, true);
select set_config('e2e.b_eventos', (select count(*) from public.eos_wa_eventos)::text, true);
select set_config('e2e.b_consent', (select count(*) from public.eos_wa_consentimientos)::text, true);

-- Como la A: ve lo suyo.
select set_config('request.jwt.claim.sub', current_setting('e2e.ua'), true);
select set_config('e2e.a_mensajes', (select count(*) from public.eos_wa_mensajes)::text, true);
select set_config('e2e.a_canales', (select count(*) from public.eos_wa_canales)::text, true);

-- Un usuario logueado no puede escribir en las tablas del canal.
do $$
begin
  begin
    insert into public.eos_wa_mensajes (usuario_id, canal_id, direccion, telefono, estado, origen)
    values (current_setting('e2e.ua')::uuid, current_setting('e2e.ca')::uuid, 'saliente', '595981000000', 'enviado', 'usuario');
    perform set_config('e2e.escribe', 'si', true);
  exception when others then
    perform set_config('e2e.escribe', 'no', true);
  end;
end $$;

-- authenticated no ejecuta las funciones.
do $$
begin
  begin
    perform public.eos_wa_recibir_v177(current_setting('e2e.ca')::uuid, 'x', '595981000000', 'x', 'texto', 'x', now(), 'otro');
    perform set_config('e2e.auth_ejecuta', 'si', true);
  exception when others then
    perform set_config('e2e.auth_ejecuta', 'no', true);
  end;
end $$;

reset role;

-- anon no toca ni las tablas ni las funciones.
set local role anon;
do $$
begin
  begin
    perform count(*) from public.eos_wa_mensajes;
    perform set_config('e2e.anon_tabla', 'si', true);
  exception when others then
    perform set_config('e2e.anon_tabla', 'no', true);
  end;
  begin
    perform public.eos_wa_recibir_v177(gen_random_uuid(), 'x', '595981000000', 'x', 'texto', 'x', now(), 'otro');
    perform set_config('e2e.anon_funcion', 'si', true);
  exception when others then
    perform set_config('e2e.anon_funcion', 'no', true);
  end;
end $$;
reset role;

select pg_temp.chk('RLS: la empresa B no ve NINGÚN mensaje del canal de la A', current_setting('e2e.b_mensajes')::int = 0, current_setting('e2e.b_mensajes'));
select pg_temp.chk('RLS: la empresa B no ve canales ajenos', current_setting('e2e.b_canales')::int = 1, current_setting('e2e.b_canales') || ' (solo el suyo)');
select pg_temp.chk('RLS: la empresa B no ve la bitácora ajena', current_setting('e2e.b_eventos')::int = 0, current_setting('e2e.b_eventos'));
select pg_temp.chk('RLS: la empresa B no ve consentimientos ajenos', current_setting('e2e.b_consent')::int = 0, current_setting('e2e.b_consent'));
select pg_temp.chk('RLS: la empresa A sí ve sus mensajes y su canal', current_setting('e2e.a_mensajes')::int > 0 and current_setting('e2e.a_canales')::int = 1, current_setting('e2e.a_mensajes'));
select pg_temp.chk('un usuario logueado NO escribe mensajes directo en la tabla', current_setting('e2e.escribe') = 'no');
select pg_temp.chk('un usuario logueado NO ejecuta las funciones del canal', current_setting('e2e.auth_ejecuta') = 'no');
select pg_temp.chk('anon NO lee la tabla de mensajes', current_setting('e2e.anon_tabla') = 'no');
select pg_temp.chk('anon NO ejecuta las funciones del canal', current_setting('e2e.anon_funcion') = 'no');

select n, prueba, ok, detalle from _r order by n;

rollback;
