-- Los dos casos de Sofía del 01/10/2026 (WhatsApp), del lado de la base.
--
--   · Citó "Costo final del zapato marrón mocha…" con "Registra la venta de
--     esto" y después "Vendí a 160.000 gs. Era un sobrepedido de Gladys
--     Velilla".
--   · "155.000gs" contestaba "¿A cuánto lo cobraste [el chaleco]?" y EOS le
--     cambió el costo a la gorra Lacoste.
--
-- Lo que se comprueba acá (lo del modelo y del webhook está en las pruebas de
-- TypeScript y en evals/qa):
--   1. el mensaje citado se encuentra por su id de WhatsApp, y solo en su cuenta;
--   2. la venta queda con producto, clienta, precio, costo y la nota (v231);
--   3. el mismo pedido ejecutado dos veces deja UNA venta;
--   4. vender no cambia el costo de ningún producto del catálogo;
--   5. un pedido que falla no deja nada a medias;
--   6. otra cuenta no ve ni el mensaje ni la venta.
--
-- Corre en UNA transacción que termina en error a propósito, con los
-- resultados adentro del mensaje: no queda nada escrito.
--
--     cat supabase/pruebas/plan_efectivo_e2e_inicio.sql \
--         supabase/migrations/20260930113000_eos_venta_con_nota_v231.sql \
--         supabase/pruebas/venta_citada_e2e.sql > /tmp/e2e231.sql
--     npx supabase db query --linked -f /tmp/e2e231.sql
--
-- (Con la v231 ya aplicada, alcanza con el inicio y este archivo.)

create temp table _r (n serial, prueba text, ok boolean, detalle text);
grant all on _r to authenticated;
grant all on sequence _r_n_seq to authenticated;

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

-- La venta como la corre el worker: orden, autorización y ejecutor. Devuelve
-- el id de la orden para poder volver a ejecutarla (un reintento).
create temp table _ordenes (clave text primary key, id uuid);

create or replace function pg_temp.ejecutar(p_cmd uuid)
returns text language plpgsql as $$
declare
  v_res jsonb;
  v_idem boolean;
begin
  select resultado, idempotent into v_res, v_idem from public.eos_execute_internal_effect_v64(p_cmd);
  return 'ok:' || coalesce(v_idem, false)::text || ':' || v_res::text;
exception when others then
  return 'error:' || sqlerrm;
end;
$$;

create or replace function pg_temp.vender(p_usuario uuid, p_clave text, p_datos jsonb)
returns text language plpgsql as $$
declare
  v_cmd uuid;
begin
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, input_fingerprint, origen, payload)
  values (gen_random_uuid(), p_usuario, gen_random_uuid(), 'REGISTRAR_VENTA', md5(random()::text), 'vercel-gateway-ts',
          jsonb_build_object('datos', p_datos))
  returning id into v_cmd;

  insert into public.eos_autonomy_events_v12 (usuario_id, command_id, event_type, actor)
  values (p_usuario, v_cmd, 'auto_allowed', 'service');

  insert into _ordenes values (p_clave, v_cmd);
  return pg_temp.ejecutar(v_cmd);
end;
$$;

-- Las dos cuentas: A es la de la clienta, B es cualquier otra.
do $$
declare
  ua constant uuid := '00000000-0000-4000-a000-0000000231aa';
  ub constant uuid := '00000000-0000-4000-a000-0000000231bb';
  conv_a uuid;
  conv_b uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into auth.users (id, aud, role, email, raw_user_meta_data) values
    (ua, 'authenticated', 'authenticated', 'e2e-v231-a@test.invalid', '{}'),
    (ub, 'authenticated', 'authenticated', 'e2e-v231-b@test.invalid', '{}');
  insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen) values
    (ua, 'erp', 'activo', 'prueba'), (ub, 'erp', 'activo', 'prueba');

  insert into public.eos_crm_contactos (usuario_id, nombre) values (ua, 'Gladys Velilla');

  insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, costo) values
    (ua, 'Zapatos marrón mocha', 160000, 125245.4),
    (ua, 'chaleco de encaje negro M', 155000, 119471),
    (ua, 'Gorra lacoste sobrepedido', 475000, 384657);

  insert into public.conversaciones (usuario_id, titulo) values (ua, 'WhatsApp') returning id into conv_a;
  insert into public.conversaciones (usuario_id, titulo) values (ub, 'WhatsApp') returning id into conv_b;

  -- El turno guardado como lo guarda ahora el webhook: las dos filas con las
  -- mismas columnas, y la de EOS con el id que Meta le puso al mandarla.
  insert into public.mensajes (conversacion_id, usuario_id, rol, texto, origen, metadata) values
    (conv_a, ua, 'usuario', '89.742gs costo del zapato marron mocha', 'whatsapp', '{"wa_ids": ["wamid.USUARIO-A-1"]}'),
    (conv_a, ua, 'eos', E'Costo final del zapato marrón mocha: ₲125.245,4. Sale de ₲89.742 de costo base + ₲35.503,4 de envío.', 'whatsapp', '{"wa_ids": ["wamid.ZAPATO-A"]}');
  -- B tiene su propio mensaje con OTRO id.
  insert into public.mensajes (conversacion_id, usuario_id, rol, texto, origen, metadata) values
    (conv_b, ub, 'eos', 'Mensaje de otra cuenta', 'whatsapp', '{"wa_ids": ["wamid.OTRO-B"]}');
end;
$$;

do $$
declare
  ua constant uuid := '00000000-0000-4000-a000-0000000231aa';
  ub constant uuid := '00000000-0000-4000-a000-0000000231bb';
  salida text;
  citado text;
  n_antes integer;
  n_despues integer;
  v record;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  -- 1. La cita: la misma consulta que `buscarCitado` (webhook).
  select m.texto into citado from public.mensajes m
  where m.usuario_id = ua and m.metadata @> '{"wa_ids": ["wamid.ZAPATO-A"]}'
  order by m.created_at desc limit 1;
  perform pg_temp.chk('cita: el mensaje de EOS se encuentra por su id de WhatsApp',
    citado like 'Costo final del zapato marrón mocha%', coalesce(citado, 'no se encontró'));

  select m.texto into citado from public.mensajes m
  where m.usuario_id = ub and m.metadata @> '{"wa_ids": ["wamid.ZAPATO-A"]}'
  limit 1;
  perform pg_temp.chk('cita: desde otra cuenta el mismo id no encuentra nada', citado is null, coalesce(citado, ''));

  -- 2. La venta del zapato, con la nota.
  salida := pg_temp.vender(ua, 'zapato', jsonb_build_object(
    'contacto', 'Gladys Velilla',
    'nota', 'sobrepedido',
    'items', jsonb_build_array(jsonb_build_object(
      'producto', 'zapato marrón mocha', 'cantidad', 1, 'precio_unitario', 160000, 'costo_unitario', 125245.4))));
  perform pg_temp.chk('zapato: la venta se registra', salida like 'ok:false:%', salida);

  select ve.total, ve.notas, c.nombre as clienta, i.descripcion, i.cantidad, i.precio_unitario, i.costo_unitario
  into v
  from public.eos_erp_ventas ve
  join public.eos_erp_venta_items i on i.venta_id = ve.id
  left join public.eos_crm_contactos c on c.id = ve.contacto_id
  where ve.usuario_id = ua and ve.action_command_id = (select id from _ordenes where clave = 'zapato');

  perform pg_temp.chk('zapato: producto, clienta, precio y costo, cada uno en su lugar',
    v.descripcion = 'Zapatos marrón mocha' and v.clienta = 'Gladys Velilla' and v.total = 160000
      and v.precio_unitario = 160000 and v.costo_unitario = 125245.4 and v.cantidad = 1,
    row_to_json(v)::text);
  perform pg_temp.chk('zapato: la nota "sobrepedido" quedó en la venta (v231)', v.notas = 'sobrepedido', coalesce(v.notas, 'null'));

  -- 3. Reintento: Meta reentrega el webhook y la misma orden se vuelve a ejecutar.
  select count(*) into n_antes from public.eos_erp_ventas where usuario_id = ua;
  salida := pg_temp.ejecutar((select id from _ordenes where clave = 'zapato'));
  select count(*) into n_despues from public.eos_erp_ventas where usuario_id = ua;
  perform pg_temp.chk('reintento: la misma orden no registra otra venta', n_antes = n_despues and n_despues = 1,
    format('antes %s, después %s, %s', n_antes, n_despues, left(salida, 120)));
  perform pg_temp.chk('reintento: el ejecutor dice que ya estaba', salida like 'ok:true:%', left(salida, 160));

  -- 4. El chaleco: 155.000 es el precio de venta, no un costo.
  salida := pg_temp.vender(ua, 'chaleco', jsonb_build_object(
    'contacto', 'Gladys Velilla',
    'nota', 'sobrepedido',
    'items', jsonb_build_array(jsonb_build_object(
      'producto', 'chaleco de encaje negro M', 'cantidad', 1, 'precio_unitario', 155000, 'costo_unitario', 119471))));
  perform pg_temp.chk('chaleco: la venta se registra', salida like 'ok:false:%', salida);

  select ve.total, i.precio_unitario, i.costo_unitario,
         i.precio_unitario - i.costo_unitario as diferencia,
         round((i.precio_unitario - i.costo_unitario) / i.precio_unitario * 100, 1) as margen
  into v
  from public.eos_erp_ventas ve join public.eos_erp_venta_items i on i.venta_id = ve.id
  where ve.usuario_id = ua and ve.action_command_id = (select id from _ordenes where clave = 'chaleco');
  perform pg_temp.chk('chaleco: 155.000 de venta, 119.471 de costo, diferencia 35.529 y 22,9 %',
    v.total = 155000 and v.costo_unitario = 119471 and v.diferencia = 35529 and v.margen = 22.9, row_to_json(v)::text);

  -- 5. Vender no toca el catálogo: la gorra y el chaleco conservan su costo.
  perform pg_temp.chk('catálogo: la gorra sigue con su costo (nadie pidió cambiarlo)',
    (select costo from public.eos_erp_productos where usuario_id = ua and nombre = 'Gorra lacoste sobrepedido') = 384657);
  perform pg_temp.chk('catálogo: el chaleco y el zapato conservan su costo',
    (select count(*) from public.eos_erp_productos where usuario_id = ua
       and ((nombre = 'chaleco de encaje negro M' and costo = 119471) or (nombre = 'Zapatos marrón mocha' and costo = 125245.4))) = 2);

  -- 6. Sin nota: la frase de siempre.
  salida := pg_temp.vender(ua, 'sin-nota', '{"items": [{"producto": "Zapatos marrón mocha", "cantidad": 1, "precio_unitario": 160000}]}');
  perform pg_temp.chk('sin nota: la venta lleva la frase de siempre',
    (select notas from public.eos_erp_ventas where action_command_id = (select id from _ordenes where clave = 'sin-nota'))
      = 'Cargada por EOS desde la conversación.', salida);

  -- 7. Un pedido que falla no deja nada: ni venta ni stock movido.
  select count(*) into n_antes from public.eos_erp_ventas where usuario_id = ua;
  salida := pg_temp.vender(ua, 'falla', '{"contacto": "Gladys Velilla", "items": []}');
  select count(*) into n_despues from public.eos_erp_ventas where usuario_id = ua;
  perform pg_temp.chk('falla: el error vuelve y no queda ninguna venta', salida like 'error:%' and n_antes = n_despues, salida);
end;
$$;

-- 8. Aislamiento con la sesión de B (RLS): no ve lo de A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000231bb","role":"authenticated"}', true);
select pg_temp.chk('aislamiento: B no ve las ventas de A',
  (select count(*) from public.eos_erp_ventas where usuario_id = '00000000-0000-4000-a000-0000000231aa') = 0);
select pg_temp.chk('aislamiento: B no ve los mensajes de A, ni buscando el id citado',
  (select count(*) from public.mensajes where metadata @> '{"wa_ids": ["wamid.ZAPATO-A"]}') = 0);
select pg_temp.chk('aislamiento: B no ve los productos de A',
  (select count(*) from public.eos_erp_productos where usuario_id = '00000000-0000-4000-a000-0000000231aa') = 0);
reset role;

-- Los resultados viajan en el error, que además deshace todo.
do $$
begin
  raise exception 'EOS_E2E_V231 %', (select json_agg(json_build_object('prueba', prueba, 'ok', ok, 'detalle', left(detalle, 200)) order by n) from _r);
end;
$$;
