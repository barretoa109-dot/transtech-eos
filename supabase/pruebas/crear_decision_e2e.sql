-- CREAR_DECISION (08/10/2026, v236): la decisión explícita por chat, de punta a punta.
--
--     npx supabase db query --linked -f supabase/pruebas/crear_decision_e2e.sql
--
-- (va DESPUÉS de aplicar la v236; no necesita concatenarse con nada más).
-- Termina en un error a propósito, con los resultados adentro: no queda nada
-- escrito. Cuentas sintéticas.
--
-- Escribe con el MISMO ejecutor que usa el chat (`eos_execute_internal_effect_v64`),
-- igual que `memoria_e2e.sql`, para probar el camino completo y no solo la
-- función `eos_crm_crear_decision_v236` aislada (esa ya tiene su prueba con
-- PGlite en `lib/sql/crear-decision.test.ts`).

create temp table _r (n serial, prueba text, ok boolean, detalle text);

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

-- Una orden de CREAR_DECISION, autorizada como la deja el Worker Gate.
create or replace function pg_temp.orden(p_usuario uuid, p_datos jsonb, p_autorizada boolean default true)
returns uuid language plpgsql as $$
declare c uuid := gen_random_uuid();
begin
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, payload, estado)
  values (c, p_usuario, gen_random_uuid(), 'CREAR_DECISION', jsonb_build_object('datos', p_datos), 'recibida');
  if p_autorizada then
    insert into public.eos_autonomy_events_v12 (usuario_id, command_id, event_type, actor, detail)
    values (p_usuario, c, 'auto_allowed', 'service', '{"risk_points": 2}');
  end if;
  return c;
end;
$$;

create or replace function pg_temp.ejecutar(p_orden uuid) returns text language plpgsql as $$
declare r record;
begin
  select * into r from public.eos_execute_internal_effect_v64(p_orden);
  return 'ok:' || coalesce(r.idempotent::text, '?') || ':' || coalesce(r.resultado ->> 'id', '?');
exception when others then
  return 'error:' || sqlerrm;
end;
$$;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  o uuid;
  salida text;
  filas int;
  fila record;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  -- handle_new_user() crea la fila de public.usuarios sola: insertar las dos
  -- (como memoria_e2e.sql) chocaría con ella.
  insert into auth.users (id, aud, role, email, raw_user_meta_data) values
    (a, 'authenticated', 'authenticated', 'e2e-decision-a-' || a || '@test.invalid', '{}'),
    (b, 'authenticated', 'authenticated', 'e2e-decision-b-' || b || '@test.invalid', '{}');

  -- 1. "Decidí subir el precio del combo a 175.000" → se guarda, con las dos
  -- métricas que dijo.
  o := pg_temp.orden(a, '{
    "decision": "Subir el precio del combo familiar a 175.000 desde noviembre",
    "metrica": "precio del combo familiar",
    "valor_base": "150000",
    "valor_objetivo": "175000"
  }'::jsonb);
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('se guarda con la métrica declarada', salida like 'ok:false:%', salida);

  select * into fila from public.eos_decisions where action_command_id = o;
  perform pg_temp.chk('el usuario y la fuente son correctos',
    fila.usuario_id = a and fila.fuente = 'chat', fila.usuario_id::text || ' / ' || fila.fuente);
  perform pg_temp.chk('valor_base y valor_objetivo quedaron numéricos',
    fila.valor_base = 150000 and fila.valor_objetivo = 175000,
    fila.valor_base::text || ' / ' || fila.valor_objetivo::text);
  perform pg_temp.chk('fecha_revision cae a +14 días (trigger v179)',
    fila.fecha_revision = (fila.fecha_decision at time zone 'America/Asuncion')::date + 14,
    fila.fecha_revision::text);

  -- 2. Reintento de la misma orden: no duplica.
  salida := pg_temp.ejecutar(o);
  select count(*) into filas from public.eos_decisions where action_command_id = o;
  perform pg_temp.chk('un reintento no duplica', salida like 'ok:true:%' and filas = 1, salida || ' / ' || filas);

  -- 3. Sin texto de decisión: falla, no escribe nada.
  o := pg_temp.orden(a, '{"titulo": "Sin contenido"}'::jsonb);
  salida := pg_temp.ejecutar(o);
  select count(*) into filas from public.eos_decisions where action_command_id = o;
  perform pg_temp.chk('sin decision, falla y no crea fila',
    salida like 'error:%EOS_ACCION_DECISION_SIN_TEXTO%' and filas = 0, salida);

  -- 4. Sin autorización del Worker Gate: no se escribe.
  o := pg_temp.orden(a, '{"decision": "Decisión sin permiso"}'::jsonb, false);
  salida := pg_temp.ejecutar(o);
  perform pg_temp.chk('sin autorización no se escribe', salida like 'error:%NOT_AUTHORIZED%', salida);

  -- 5. Otra persona no ve la decisión de A: ni el conteo directo, ni con su sesión.
  select count(*) into filas from public.eos_decisions where usuario_id = b;
  perform pg_temp.chk('B no tiene ninguna decisión propia todavía', filas = 0, filas::text);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into filas from public.eos_decisions;
  reset role;
  perform pg_temp.chk('con su sesión, B no lee las decisiones de A', filas = 0, filas::text);
end;
$$;

do $$ begin
  raise exception 'EOS_E2E_CREAR_DECISION %', (select json_agg(json_build_object('prueba', prueba, 'ok', ok, 'detalle', left(detalle, 160)) order by n) from _r);
end $$;
