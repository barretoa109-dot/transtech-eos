-- CORREGIR_MOVIMIENTO: que un error de EOS deje de ser permanente.
--
-- ============================================================
-- EL ÚNICO VERBO CUYA AUSENCIA ES IRREVERSIBLE
-- ============================================================
--
-- EOS entiende "gasté 50 mil en nafta" y lo anota solo. A veces entiende
-- 800.000 donde la persona dijo 80.000 — pasa con los montos hablados, y por
-- eso la pantalla devuelve "Salió ₲ 800.000 — nafta" en el momento.
--
-- Pero hasta hoy, ver el error no alcanzaba: la única forma de arreglarlo era
-- ir a la lista de movimientos y editarlo a mano. Un sistema que se equivoca y
-- no se deja corregir hablando le enseña a la persona a no usar el chat, que
-- es exactamente donde el producto quería que estuviera.
--
-- ============================================================
-- CORRIGE, NO BORRA
-- ============================================================
--
-- Se puede cambiar el monto, la fecha y la descripción. NO se puede borrar.
--
-- No es una limitación técnica: borrar por chat es la única operación donde
-- una coincidencia equivocada destruye un dato sin dejar rastro. Corregir un
-- monto sobre la fila equivocada se ve y se vuelve a corregir; borrar la fila
-- equivocada no se ve nunca.
--
-- La pantalla de movimientos ya tiene el botón de borrar, a un clic. El prompt
-- le dice a EOS que mande ahí a quien pida borrar.
--
-- ============================================================
-- CORRIGE EL MÁS RECIENTE, Y DICE CUÁL
-- ============================================================
--
-- "Nafta" va a coincidir con varias filas: alguien carga nafta todas las
-- semanas. Exigir que desambigüe cada vez volvería el verbo inútil.
--
-- Así que corrige el MÁS RECIENTE de los últimos siete días y la confirmación
-- dice exactamente cuál tocó y qué había antes: "corregí el gasto de nafta del
-- 8 de septiembre, de 800.000 a 80.000". Si agarró el equivocado, la persona
-- lo ve en la misma respuesta.
--
-- Es el mismo mecanismo que ya usa el alta rápida: actuar, y devolver lo que
-- se entendió mientras la persona todavía se acuerda.
--
-- Siete días porque una corrección ocurre al lado del error. Más atrás, la
-- persona ya no se acuerda de qué monto era el correcto, y la pantalla —donde
-- ve la fila entera— es mejor herramienta que una frase.
--
-- ============================================================
-- SOLO LO PERSONAL
-- ============================================================
--
-- Un movimiento con `ambito = 'negocio'` lo escribió el ERP como parte de una
-- venta o una compra. Corregirle el monto acá lo dejaría distinto del
-- documento que lo generó, y el panel del negocio y la venta dirían cosas
-- diferentes sobre la misma plata. Para eso está `eos_erp_editar_venta`.

-- ============================================================
-- 1) La acción, en los tres check
-- ============================================================

alter table public.eos_action_commands
  drop constraint if exists eos_action_commands_accion_check;

alter table public.eos_action_commands
  add constraint eos_action_commands_accion_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO'
  ]));

alter table public.eos_autonomy_rules_v12
  drop constraint if exists eos_autonomy_rules_action_check;

alter table public.eos_autonomy_rules_v12
  add constraint eos_autonomy_rules_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO'
  ]));

alter table public.eos_worker_gate_audit_v15
  drop constraint if exists eos_worker_gate_audit_action_check;

alter table public.eos_worker_gate_audit_v15
  add constraint eos_worker_gate_audit_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO'
  ]));

-- ============================================================
-- 2) La función
-- ============================================================

create or replace function public.eos_finanzas_corregir_movimiento_v148(
  p_usuario_id uuid,
  p_command_id uuid,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_buscado text;
  v_monto numeric;
  v_fecha date;
  v_descripcion_nueva text;
  v_antes public.eos_movimientos_financieros%rowtype;
  v_coincidencias integer := 0;
  v_desde date;
begin
  v_buscado := nullif(btrim(coalesce(
    p_datos ->> 'descripcion', p_datos ->> 'concepto', p_datos ->> 'que', ''
  )), '');

  if v_buscado is null then
    raise exception 'EOS_ACCION_CORRECCION_SIN_REFERENCIA';
  end if;

  v_monto := nullif(regexp_replace(coalesce(
    p_datos ->> 'monto', p_datos ->> 'monto_nuevo', p_datos ->> 'importe', ''
  ), '[^0-9.]', '', 'g'), '')::numeric;

  v_fecha := case
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'fecha')::date
    else null
  end;

  v_descripcion_nueva := nullif(btrim(coalesce(p_datos ->> 'descripcion_nueva', '')), '');

  -- Sin nada que cambiar no hay corrección. Ejecutarla igual devolvería "listo"
  -- sobre una fila que quedó idéntica, que es la peor confirmación posible.
  if v_monto is null and v_fecha is null and v_descripcion_nueva is null then
    raise exception 'EOS_ACCION_CORRECCION_SIN_CAMBIO';
  end if;

  if v_monto is not null and v_monto <= 0 then
    raise exception 'EOS_ACCION_CORRECCION_MONTO_INVALIDO';
  end if;

  v_desde := ((now() at time zone 'America/Asuncion')::date) - 7;

  /*
   * El más reciente de los que coinciden, y solo de la persona.
   *
   * Un movimiento con ambito 'negocio' lo escribió el ERP dentro de una venta
   * o una compra: corregirlo acá lo dejaría distinto del documento que lo
   * generó.
   */
  select count(*) into v_coincidencias
  from public.eos_movimientos_financieros
  where usuario_id = p_usuario_id
    and ambito = 'personal'
    and fecha >= v_desde
    and lower(coalesce(descripcion, '')) like '%' || lower(v_buscado) || '%';

  if v_coincidencias = 0 then
    raise exception 'EOS_ACCION_MOVIMIENTO_NO_ENCONTRADO: %', v_buscado;
  end if;

  select * into v_antes
  from public.eos_movimientos_financieros
  where usuario_id = p_usuario_id
    and ambito = 'personal'
    and fecha >= v_desde
    and lower(coalesce(descripcion, '')) like '%' || lower(v_buscado) || '%'
  order by fecha desc, created_at desc
  limit 1;

  update public.eos_movimientos_financieros
  set monto = coalesce(v_monto, monto),
      fecha = coalesce(v_fecha, fecha),
      descripcion = coalesce(v_descripcion_nueva, descripcion),
      /*
       * Queda anotado que se corrigió, y desde dónde.
       *
       * `metadata` es el único lugar donde sobrevive el valor anterior: la
       * tabla no tiene historial. Sin esto, una corrección es indistinguible
       * de un dato que siempre fue así, y la persona que mañana revise el mes
       * no puede saber si EOS entendió mal o si gastó eso.
       */
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'corregido_el', (now() at time zone 'America/Asuncion')::date,
        'corregido_por', 'chat',
        'command_id', p_command_id,
        'monto_anterior', v_antes.monto,
        'fecha_anterior', v_antes.fecha,
        'descripcion_anterior', v_antes.descripcion
      ),
      updated_at = now()
  where id = v_antes.id;

  return jsonb_build_object(
    'id', v_antes.id,
    'tipo', v_antes.tipo,
    'moneda', v_antes.moneda,
    'antes', jsonb_build_object(
      'monto', v_antes.monto,
      'fecha', v_antes.fecha,
      'descripcion', v_antes.descripcion
    ),
    'despues', jsonb_build_object(
      'monto', coalesce(v_monto, v_antes.monto),
      'fecha', coalesce(v_fecha, v_antes.fecha),
      'descripcion', coalesce(v_descripcion_nueva, v_antes.descripcion)
    ),
    -- Cuántos coincidían. La confirmación lo dice cuando es más de uno, para
    -- que la persona sepa que se eligió el más reciente y pueda desmentirlo.
    'coincidencias', v_coincidencias
  );
end;
$function$;

revoke all on function public.eos_finanzas_corregir_movimiento_v148(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_finanzas_corregir_movimiento_v148(uuid, uuid, jsonb) to service_role;

comment on function public.eos_finanzas_corregir_movimiento_v148(uuid, uuid, jsonb) is
  'v148: corrige monto, fecha o descripción del movimiento personal más reciente que coincida, en los últimos 7 días. No borra: borrar por chat destruye un dato sin dejar rastro.';
