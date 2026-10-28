-- Prueba de integración para una base local migrada. Todo queda en ROLLBACK.
--
-- Los dos verbos que docs/autonomia/verbos.md marcaba como "NO EXISTE",
-- probados de punta a punta por el ejecutor REAL (eos_execute_internal_effect_v64),
-- no llamando a las funciones sueltas: así queda cubierta también la
-- autorización, la idempotencia y el merge del resultado final.
begin;

do $test$
declare
  v_usuario uuid := gen_random_uuid();
  v_cmd_retiro uuid := gen_random_uuid();
  v_cmd_anular uuid := gen_random_uuid();
  v_resultado record;
  v_mov_negocio public.eos_movimientos_financieros%rowtype;
  v_mov_personal public.eos_movimientos_financieros%rowtype;
begin
  insert into auth.users (id, email) values (v_usuario, 'eos-verbos-v248-' || v_usuario::text || '@test.local');

  -- ====== REGISTRAR_RETIRO_PERSONAL: el movimiento de dos lados ======
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, payload)
  values (v_cmd_retiro, v_usuario, gen_random_uuid(), 'REGISTRAR_RETIRO_PERSONAL',
          jsonb_build_object('datos', jsonb_build_object('monto', '1.500.000', 'descripcion', 'retiro de prueba')));

  insert into public.eos_autonomy_events_v12 (usuario_id, command_id, event_type)
  values (v_usuario, v_cmd_retiro, 'auto_allowed');

  select * into v_resultado from public.eos_execute_internal_effect_v64(v_cmd_retiro);

  if v_resultado.estado <> 'completada' then
    raise exception 'TEST_V248_RETIRO_NO_COMPLETO: %', v_resultado.estado;
  end if;

  select * into v_mov_negocio from public.eos_movimientos_financieros
  where action_command_id = v_cmd_retiro and ambito = 'negocio';
  select * into v_mov_personal from public.eos_movimientos_financieros
  where action_command_id = v_cmd_retiro and ambito = 'personal';

  if v_mov_negocio.monto <> 1500000 or v_mov_negocio.tipo <> 'gasto' then
    raise exception 'TEST_V248_RETIRO_LADO_NEGOCIO_MAL: tipo=% monto=%', v_mov_negocio.tipo, v_mov_negocio.monto;
  end if;
  if v_mov_personal.monto <> 1500000 or v_mov_personal.tipo <> 'ingreso' then
    raise exception 'TEST_V248_RETIRO_LADO_PERSONAL_MAL: tipo=% monto=%', v_mov_personal.tipo, v_mov_personal.monto;
  end if;

  -- Un reintento (mismo command_id) es idempotente: no agrega una tercera fila.
  select * into v_resultado from public.eos_execute_internal_effect_v64(v_cmd_retiro);
  if v_resultado.idempotent is not true then
    raise exception 'TEST_V248_RETIRO_REINTENTO_NO_IDEMPOTENTE';
  end if;
  if (select count(*) from public.eos_movimientos_financieros where action_command_id = v_cmd_retiro) <> 2 then
    raise exception 'TEST_V248_RETIRO_REINTENTO_DUPLICO_FILAS';
  end if;

  -- ====== ANULAR_MOVIMIENTO: gasto -> contrapartida, idempotente ======
  insert into public.eos_movimientos_financieros (usuario_id, tipo, monto, moneda, descripcion, fecha, origen, ambito)
  values (v_usuario, 'gasto', 45000, 'PYG', 'almuerzo', (now() at time zone 'America/Asuncion')::date, 'chat', 'personal');

  insert into public.eos_action_commands (id, usuario_id, request_id, accion, payload)
  values (v_cmd_anular, v_usuario, gen_random_uuid(), 'ANULAR_MOVIMIENTO',
          jsonb_build_object('datos', jsonb_build_object('descripcion', 'almuerzo')));

  insert into public.eos_autonomy_events_v12 (usuario_id, command_id, event_type)
  values (v_usuario, v_cmd_anular, 'auto_allowed');

  select * into v_resultado from public.eos_execute_internal_effect_v64(v_cmd_anular);

  if v_resultado.estado <> 'completada' then
    raise exception 'TEST_V248_ANULAR_NO_COMPLETO: %', v_resultado.estado;
  end if;
  if (v_resultado.resultado ->> 'monto_anulado')::numeric <> 45000 then
    raise exception 'TEST_V248_ANULAR_MONTO_MAL: %', v_resultado.resultado;
  end if;

  -- El gasto original NO cambia de monto (no puede ir a 0): queda intacto,
  -- marcado en metadata, y lo que netea a cero es la contrapartida.
  if (select monto from public.eos_movimientos_financieros
      where usuario_id = v_usuario and descripcion = 'almuerzo' and not (metadata ? 'anula_movimiento_id')) <> 45000 then
    raise exception 'TEST_V248_ANULAR_TOCO_LA_FILA_ORIGINAL';
  end if;

  -- Solo los gastos PERSONALES: el retiro de arriba también escribió un
  -- gasto (del lado 'negocio'), que no tiene nada que ver con esta cuenta.
  if (select coalesce(sum(monto), 1) from public.eos_movimientos_financieros
      where usuario_id = v_usuario and tipo = 'gasto' and ambito = 'personal') <> 0 then
    raise exception 'TEST_V248_ANULAR_NO_NETEA_A_CERO';
  end if;

  -- Un reintento es idempotente: no agrega una segunda contrapartida.
  select * into v_resultado from public.eos_execute_internal_effect_v64(v_cmd_anular);
  if v_resultado.idempotent is not true then
    raise exception 'TEST_V248_ANULAR_REINTENTO_NO_IDEMPOTENTE';
  end if;
  if (select count(*) from public.eos_movimientos_financieros
      where usuario_id = v_usuario and tipo = 'gasto' and monto = -45000) <> 1 then
    raise exception 'TEST_V248_ANULAR_REINTENTO_DUPLICO_CONTRAPARTIDA';
  end if;
end;
$test$;

rollback;
