-- Memoria entre turnos (01/10/2026): se escribe, se recupera, se corrige y es de una sola persona.
--
--     cat supabase/pruebas/plan_efectivo_e2e_inicio.sql \
--         supabase/pruebas/memoria_e2e.sql > /tmp/e2e-memoria.sql
--     npx supabase db query --linked -f /tmp/e2e-memoria.sql
--
-- (el inicio es solo `begin;`). Termina en un error a propósito, con los
-- resultados adentro: no queda nada escrito. Cuentas sintéticas.
--
-- Escribe con el MISMO ejecutor que usa el chat (`eos_execute_internal_effect_v64`)
-- y lee con la MISMA consulta que arma el contexto del turno siguiente
-- (`lib/eos/procesar-mensaje.ts`: eos_memory por usuario_id y estado activo).

create temp table _r (n serial, prueba text, ok boolean, detalle text);

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

-- Una orden de GUARDAR_MEMORIA autorizada, como la deja el Worker Gate.
create or replace function pg_temp.orden(p_usuario uuid, p_datos jsonb, p_autorizada boolean default true)
returns uuid language plpgsql as $$
declare c uuid := gen_random_uuid();
begin
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, payload, estado)
  values (c, p_usuario, gen_random_uuid(), 'GUARDAR_MEMORIA', jsonb_build_object('datos', p_datos), 'recibida');
  if p_autorizada then
    insert into public.eos_autonomy_events_v12 (usuario_id, command_id, event_type, actor, detail)
    values (p_usuario, c, 'auto_allowed', 'service', '{"risk_points": 1}');
  end if;
  return c;
end;
$$;

create or replace function pg_temp.ejecutar(p_orden uuid) returns text language plpgsql as $$
declare r record;
begin
  select * into r from public.eos_execute_internal_effect_v64(p_orden);
  return 'ok:' || coalesce(r.idempotent::text, '?');
exception when others then
  return 'error:' || sqlerrm;
end;
$$;

-- La lectura del turno siguiente, tal cual la hace procesar-mensaje.ts.
create or replace function pg_temp.contexto(p_usuario uuid) returns text language sql as $$
  select coalesce(string_agg(titulo || ': ' || contenido, ' | ' order by importancia desc, updated_at desc), '')
  from public.eos_memory where usuario_id = p_usuario and estado = 'activo';
$$;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  o uuid;
  salida text;
  ctx text;
  filas int;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into auth.users (id, aud, role, email, raw_user_meta_data) values
    (a, 'authenticated', 'authenticated', 'e2e-mem-a-' || a || '@test.invalid', '{}'),
    (b, 'authenticated', 'authenticated', 'e2e-mem-b-' || b || '@test.invalid', '{}');

  -- 1. Turno 1: "para mí los préstamos van primero" → se guarda (importancia en texto, como la manda el modelo).
  o := pg_temp.orden(a, '{"titulo": "Prioridad de pagos", "contenido": "Los préstamos del celular y de la moto van primero.", "importancia": "alta"}');
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('se guarda aunque importancia venga como texto', salida = 'ok:false', salida);

  -- 2. Turno siguiente: el contexto la trae.
  ctx := pg_temp.contexto(a);
  perform pg_temp.chk('el turno siguiente la recupera', ctx like '%préstamos del celular y de la moto van primero%', ctx);

  -- 3. Reintento de la misma orden: no duplica.
  salida := pg_temp.ejecutar(o);
  select count(*) into filas from public.eos_memory where usuario_id = a;
  perform pg_temp.chk('un reintento no duplica', salida = 'ok:true' and filas = 1, salida || ' / ' || filas);

  -- 4. Corrección: "no, ahora la moto va primero" → misma memoria, dato nuevo, el viejo queda.
  o := pg_temp.orden(a, '{"titulo": "Prioridad de pagos", "contenido": "Ahora el préstamo de la moto va primero."}');
  salida := pg_temp.ejecutar(o);
  select count(*) into filas from public.eos_memory where usuario_id = a;
  ctx := pg_temp.contexto(a);
  perform pg_temp.chk('la corrección reemplaza el dato sin duplicar', filas = 1 and ctx like '%moto va primero%' and ctx not like '%celular y de la moto%', ctx);
  perform pg_temp.chk('el dato anterior queda guardado',
    exists (select 1 from public.eos_memory where usuario_id = a and metadata ->> 'contenido_anterior' like '%celular y de la moto%'));

  -- 5. Otra persona no la ve: ni con la consulta del servidor ni con su sesión.
  perform pg_temp.chk('el contexto de otra persona no la trae', pg_temp.contexto(b) = '', pg_temp.contexto(b));
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into filas from public.eos_memory;
  reset role;
  perform pg_temp.chk('con su sesión, otra persona no lee memorias ajenas', filas = 0, filas::text);

  -- 6. Una orden sin autorización del Worker Gate no escribe.
  o := pg_temp.orden(a, '{"titulo": "Sin permiso", "contenido": "no"}', false);
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('sin autorización no se escribe', salida like 'error:%NOT_AUTHORIZED%', salida);

  -- 7. Una memoria archivada por la persona no vuelve al contexto ni se revive.
  update public.eos_memory set estado = 'archivado' where usuario_id = a;
  o := pg_temp.orden(a, '{"titulo": "Prioridad de pagos", "contenido": "Nueva observación."}');
  salida := pg_temp.ejecutar(o);
  select count(*) into filas from public.eos_memory where usuario_id = a and estado = 'activo';
  perform pg_temp.chk('lo archivado no se revive: se crea una memoria nueva y activa', filas = 1 and pg_temp.contexto(a) like '%Nueva observación%', salida || ' / ' || filas);
end;
$$;

do $$ begin
  raise exception 'EOS_E2E_MEMORIA %', (select json_agg(json_build_object('prueba', prueba, 'ok', ok, 'detalle', left(detalle, 160)) order by n) from _r);
end $$;
