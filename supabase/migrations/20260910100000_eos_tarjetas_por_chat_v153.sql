-- REGISTRAR_TARJETA y REGISTRAR_COMPRA_TARJETA.
--
-- ============================================================
-- LA VERTICAL SE CONSTRUYÓ ENTERA Y NO SE PODÍA HABLAR CON ELLA
-- ============================================================
--
-- Las tarjetas entraron el 8 de septiembre: las tablas, el cálculo de
-- vencimientos, la utilización, la antigüedad del resumen y su pantalla. Todo
-- se carga a mano.
--
-- Es la vertical donde más duele, porque el dato que cambia es MENSUAL —el
-- resumen— y el que se olvida es INSTANTÁNEO: la compra en cuotas se hace en
-- la caja de un negocio, con el teléfono en la mano, y si no se anota en ese
-- momento no se anota nunca. Justo el caso para el que existe un chat.
--
-- ============================================================
-- LO QUE SALE DEL BOLSILLO ES EL PAGO DEL RESUMEN, NO LA COMPRA
-- ============================================================
--
-- Es la regla central de `lib/finanzas/tarjetas.ts` y la razón por la que
-- estos verbos son delicados: comprar con tarjeta NO es un gasto del mes.
--
-- Si "compré la heladera en 6 cuotas de 500 mil" entrara como movimiento
-- personal, la persona vería 3.000.000 de gasto el día de la compra, y
-- después vería otra vez los 500.000 cada mes al pagar el resumen. La misma
-- plata contada siete veces.
--
-- Por eso esta función escribe SOLO en `eos_finanzas_tarjeta_compras`, que no
-- toca la línea de tiempo del panel: lo que la toca son los vencimientos que
-- `obligacionesDe` deriva de las cuotas.
--
-- ============================================================
-- LA CUOTA, CUANDO SOLO DIERON EL TOTAL
-- ============================================================
--
-- "La heladera me salió 3 millones en 6 cuotas" no dice cuánto es la cuota, y
-- con intereses no es el total dividido seis.
--
-- Se divide igual —es mejor que no anotar nada— pero la función devuelve
-- `cuota_estimada: true` y la confirmación lo dice con esas palabras, para
-- que la persona pueda desmentirla. Una cuota estimada presentada como dato
-- se ve idéntica a una real, y sobre ella se decide si se llega a fin de mes.

-- ============================================================
-- 1) Las dos acciones, en los tres check
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
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA'
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
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA'
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
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA'
  ]));

-- ============================================================
-- 2) De qué comando vino cada cosa
-- ============================================================

alter table public.eos_finanzas_tarjetas
  add column if not exists action_command_id uuid;

alter table public.eos_finanzas_tarjeta_compras
  add column if not exists action_command_id uuid;

create index if not exists eos_tarjetas_command_idx
  on public.eos_finanzas_tarjetas (action_command_id)
  where action_command_id is not null;

create index if not exists eos_tarjeta_compras_command_idx
  on public.eos_finanzas_tarjeta_compras (action_command_id)
  where action_command_id is not null;

-- ============================================================
-- 3) Encontrar la tarjeta como la llama la persona
-- ============================================================
--
-- "la Visa", "la del Itaú", "la azul". El nombre que le puso gana sobre el
-- emisor, porque es el que va a usar hablando.

create or replace function public.eos_finanzas_buscar_tarjeta_v153(
  p_usuario_id uuid,
  p_texto text
)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select t.id
  from public.eos_finanzas_tarjetas t
  where t.usuario_id = p_usuario_id
    and t.ambito = 'personal'
    and t.activa
    and p_texto is not null
    and (
      lower(coalesce(t.nombre, '')) = lower(btrim(p_texto))
      or lower(t.emisor) = lower(btrim(p_texto))
      or lower(coalesce(t.nombre, '')) like '%' || lower(btrim(p_texto)) || '%'
      or lower(t.emisor) like '%' || lower(btrim(p_texto)) || '%'
    )
  order by
    (lower(coalesce(t.nombre, '')) = lower(btrim(p_texto))) desc,
    (lower(t.emisor) = lower(btrim(p_texto))) desc,
    t.created_at
  limit 1;
$function$;

revoke all on function public.eos_finanzas_buscar_tarjeta_v153(uuid, text) from public, anon, authenticated;
grant execute on function public.eos_finanzas_buscar_tarjeta_v153(uuid, text) to service_role;

-- ============================================================
-- 4) Dar de alta o corregir una tarjeta, y su resumen
-- ============================================================
--
-- Crea o corrige sola, como `REGISTRAR_DEUDA`: si ya existe, actualiza lo que
-- le manden y no toca el resto. Preguntar "¿es nueva?" es trabajo que la
-- persona no tiene por qué hacer, y la respuesta se puede deducir.

create or replace function public.eos_finanzas_registrar_tarjeta_v153(
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
  v_texto text;
  v_emisor text;
  v_id uuid;
  v_creada boolean := false;
  v_linea numeric;
  v_saldo numeric;
  v_minimo numeric;
  v_total numeric;
  v_cierre smallint;
  v_vence smallint;
  v_moneda text;
  v_resumen_al date;
  v_hoy date;
begin
  v_hoy := (now() at time zone 'America/Asuncion')::date;

  v_texto := nullif(btrim(coalesce(
    p_datos ->> 'tarjeta', p_datos ->> 'nombre', p_datos ->> 'emisor', ''
  )), '');

  if v_texto is null then
    raise exception 'EOS_ACCION_TARJETA_SIN_NOMBRE';
  end if;

  v_id := public.eos_finanzas_buscar_tarjeta_v153(p_usuario_id, v_texto);

  v_linea := public.eos_leer_monto(coalesce(
    p_datos ->> 'linea', p_datos ->> 'linea_total', p_datos ->> 'limite', ''
  ));
  v_saldo := public.eos_leer_monto(coalesce(
    p_datos ->> 'saldo', p_datos ->> 'saldo_utilizado', p_datos ->> 'usado', ''
  ));
  v_minimo := public.eos_leer_monto(coalesce(
    p_datos ->> 'pago_minimo', p_datos ->> 'minimo', ''
  ));
  v_total := public.eos_leer_monto(coalesce(
    p_datos ->> 'pago_total', p_datos ->> 'resumen', p_datos ->> 'total', ''
  ));

  v_cierre := nullif(regexp_replace(coalesce(
    p_datos ->> 'dia_cierre', p_datos ->> 'cierre', ''
  ), '[^0-9]', '', 'g'), '')::smallint;
  if v_cierre is not null and (v_cierre < 1 or v_cierre > 31) then v_cierre := null; end if;

  v_vence := nullif(regexp_replace(coalesce(
    p_datos ->> 'dia_vencimiento', p_datos ->> 'vencimiento', p_datos ->> 'vence', ''
  ), '[^0-9]', '', 'g'), '')::smallint;
  if v_vence is not null and (v_vence < 1 or v_vence > 31) then v_vence := null; end if;

  v_moneda := upper(nullif(btrim(coalesce(p_datos ->> 'moneda', '')), ''));
  if v_moneda is null or length(v_moneda) <> 3 then v_moneda := null; end if;

  /*
   * El resumen lleva SU fecha, siempre.
   *
   * Sin ella, el del mes pasado se lee como el de éste y alguien paga el
   * mínimo de un ciclo que ya cerró. Si mandaron un pago y no la fecha, se usa
   * hoy: es cuando la persona lo está mirando.
   */
  if v_minimo is not null or v_total is not null then
    v_resumen_al := case
      when coalesce(p_datos ->> 'resumen_al', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (p_datos ->> 'resumen_al')::date
      else v_hoy
    end;
    if v_resumen_al > v_hoy then v_resumen_al := v_hoy; end if;
  end if;

  if v_id is null then
    v_emisor := nullif(btrim(coalesce(p_datos ->> 'emisor', '')), '');

    insert into public.eos_finanzas_tarjetas (
      usuario_id, ambito, emisor, nombre, moneda,
      linea_total, saldo_utilizado, saldo_al,
      dia_cierre, dia_vencimiento,
      pago_minimo, pago_total, resumen_al,
      activa, action_command_id
    ) values (
      p_usuario_id, 'personal',
      left(coalesce(v_emisor, v_texto), 80),
      left(v_texto, 80),
      coalesce(v_moneda, 'PYG'),
      v_linea, v_saldo,
      case when v_saldo is not null then v_hoy else null end,
      v_cierre, v_vence,
      v_minimo, v_total, v_resumen_al,
      true, p_command_id
    )
    returning id into v_id;

    v_creada := true;
  else
    update public.eos_finanzas_tarjetas t
    set emisor = coalesce(nullif(btrim(coalesce(p_datos ->> 'emisor', '')), ''), t.emisor),
        moneda = coalesce(v_moneda, t.moneda),
        linea_total = coalesce(v_linea, t.linea_total),
        saldo_utilizado = coalesce(v_saldo, t.saldo_utilizado),
        saldo_al = case when v_saldo is not null then v_hoy else t.saldo_al end,
        dia_cierre = coalesce(v_cierre, t.dia_cierre),
        dia_vencimiento = coalesce(v_vence, t.dia_vencimiento),
        pago_minimo = coalesce(v_minimo, t.pago_minimo),
        pago_total = coalesce(v_total, t.pago_total),
        resumen_al = coalesce(v_resumen_al, t.resumen_al),
        action_command_id = p_command_id,
        updated_at = now()
    where t.id = v_id;
  end if;

  return (
    select jsonb_build_object(
      'id', t.id,
      'tarjeta', coalesce(t.nombre, t.emisor),
      'emisor', t.emisor,
      'moneda', t.moneda,
      'creada', v_creada,
      'linea', t.linea_total,
      'saldo', t.saldo_utilizado,
      'dia_cierre', t.dia_cierre,
      'dia_vencimiento', t.dia_vencimiento,
      'pago_minimo', t.pago_minimo,
      'pago_total', t.pago_total,
      'resumen_al', t.resumen_al,
      -- Lo que todavía falta para que EOS pueda decir algo útil de ella. Es
      -- la diferencia entre "no sé" y "no me lo contaste".
      'falta_ciclo', t.dia_cierre is null or t.dia_vencimiento is null
    )
    from public.eos_finanzas_tarjetas t where t.id = v_id
  );
end;
$function$;

revoke all on function public.eos_finanzas_registrar_tarjeta_v153(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_finanzas_registrar_tarjeta_v153(uuid, uuid, jsonb) to service_role;

-- ============================================================
-- 5) Una compra en cuotas
-- ============================================================

create or replace function public.eos_finanzas_compra_tarjeta_v153(
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
  v_texto text;
  v_tarjeta_id uuid;
  v_tarjeta public.eos_finanzas_tarjetas%rowtype;
  v_descripcion text;
  v_total numeric;
  v_cuota numeric;
  v_cuotas smallint;
  v_pagadas smallint;
  v_primera date;
  v_estimada boolean := false;
  v_id uuid;
  v_cuantas integer;
begin
  v_descripcion := nullif(btrim(coalesce(
    p_datos ->> 'descripcion', p_datos ->> 'concepto', p_datos ->> 'que', ''
  )), '');

  if v_descripcion is null then
    raise exception 'EOS_ACCION_TARJETA_COMPRA_SIN_DESCRIPCION';
  end if;

  v_texto := nullif(btrim(coalesce(p_datos ->> 'tarjeta', p_datos ->> 'emisor', '')), '');

  /*
   * Sin decir cuál, se usa la única que tenga. Con dos o más, se pregunta:
   * una compra en la tarjeta equivocada corre los vencimientos al ciclo que
   * no es, y el calendario del mes queda mal sin que se note.
   */
  if v_texto is null then
    select count(*) into v_cuantas
    from public.eos_finanzas_tarjetas t
    where t.usuario_id = p_usuario_id and t.ambito = 'personal' and t.activa;

    if v_cuantas = 0 then
      raise exception 'EOS_ACCION_TARJETA_NO_ENCONTRADA: (ninguna cargada)';
    end if;

    if v_cuantas > 1 then
      raise exception 'EOS_ACCION_TARJETA_CUAL';
    end if;

    select t.id into v_tarjeta_id
    from public.eos_finanzas_tarjetas t
    where t.usuario_id = p_usuario_id and t.ambito = 'personal' and t.activa
    limit 1;
  else
    v_tarjeta_id := public.eos_finanzas_buscar_tarjeta_v153(p_usuario_id, v_texto);

    if v_tarjeta_id is null then
      raise exception 'EOS_ACCION_TARJETA_NO_ENCONTRADA: %', v_texto;
    end if;
  end if;

  select * into v_tarjeta from public.eos_finanzas_tarjetas where id = v_tarjeta_id;

  v_cuotas := nullif(regexp_replace(coalesce(
    p_datos ->> 'cuotas', p_datos ->> 'cuotas_totales', ''
  ), '[^0-9]', '', 'g'), '')::smallint;

  -- Sin cuotas es una compra de un pago: entra igual, con cuotas = 1.
  if v_cuotas is null or v_cuotas < 1 then v_cuotas := 1; end if;
  if v_cuotas > 120 then
    raise exception 'EOS_ACCION_TARJETA_CUOTAS_IRREALES: %', v_cuotas;
  end if;

  v_total := public.eos_leer_monto(coalesce(
    p_datos ->> 'monto_total', p_datos ->> 'total', p_datos ->> 'precio', ''
  ));
  v_cuota := public.eos_leer_monto(coalesce(
    p_datos ->> 'monto_cuota', p_datos ->> 'cuota', ''
  ));

  if v_cuota is null and v_total is null then
    raise exception 'EOS_ACCION_TARJETA_COMPRA_SIN_MONTO: %', v_descripcion;
  end if;

  /*
   * Con el total y sin la cuota, se divide — y se DICE que es estimada.
   *
   * Con intereses la cuota real es mayor que el total sobre las cuotas, y una
   * cuota estimada se ve idéntica a una real: sobre ella se decide si se
   * llega a fin de mes. La confirmación lo aclara con esas palabras.
   */
  if v_cuota is null then
    v_cuota := round(v_total / v_cuotas, 2);
    v_estimada := v_cuotas > 1;
  end if;

  if v_cuota <= 0 then
    raise exception 'EOS_ACCION_TARJETA_COMPRA_SIN_MONTO: %', v_descripcion;
  end if;

  v_pagadas := nullif(regexp_replace(coalesce(p_datos ->> 'cuotas_pagadas', ''), '[^0-9]', '', 'g'), '')::smallint;
  if v_pagadas is null or v_pagadas < 0 then v_pagadas := 0; end if;
  if v_pagadas > v_cuotas then v_pagadas := v_cuotas; end if;

  v_primera := case
    when coalesce(p_datos ->> 'primera_cuota', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (p_datos ->> 'primera_cuota')::date
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (p_datos ->> 'fecha')::date
    else (now() at time zone 'America/Asuncion')::date
  end;

  insert into public.eos_finanzas_tarjeta_compras (
    usuario_id, tarjeta_id, descripcion, moneda,
    monto_total, monto_cuota, cuotas_totales, cuotas_pagadas,
    primera_cuota, action_command_id
  ) values (
    p_usuario_id, v_tarjeta_id, left(v_descripcion, 200), v_tarjeta.moneda,
    v_total, v_cuota, v_cuotas, v_pagadas,
    v_primera, p_command_id
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'tarjeta', coalesce(v_tarjeta.nombre, v_tarjeta.emisor),
    'descripcion', v_descripcion,
    'moneda', v_tarjeta.moneda,
    'monto_cuota', v_cuota,
    'monto_total', v_total,
    'cuotas', v_cuotas,
    'cuotas_pagadas', v_pagadas,
    'primera_cuota', v_primera,
    'cuota_estimada', v_estimada,
    -- Que no es un gasto de este mes es LO que hay que decir. Ver la cabecera.
    'no_es_gasto', true
  );
end;
$function$;

revoke all on function public.eos_finanzas_compra_tarjeta_v153(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_finanzas_compra_tarjeta_v153(uuid, uuid, jsonb) to service_role;

comment on function public.eos_finanzas_registrar_tarjeta_v153(uuid, uuid, jsonb) is
  'v153: da de alta o corrige una tarjeta personal desde el chat, incluido el resumen del mes con su fecha.';

comment on function public.eos_finanzas_compra_tarjeta_v153(uuid, uuid, jsonb) is
  'v153: anota una compra en cuotas. NO escribe en eos_movimientos_financieros: lo que sale del bolsillo es el pago del resumen, no la compra.';
