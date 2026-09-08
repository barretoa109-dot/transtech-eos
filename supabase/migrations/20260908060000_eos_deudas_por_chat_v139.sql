-- Declarar una deuda y pagar una cuota, hablando.
--
-- ============================================================
-- POR QUÉ ESTO Y NO OTRA TARJETA
-- ============================================================
--
-- El centro de deudas quedó completo del lado del cálculo: orden de pago con
-- su motivo, capacidad mensual real, qué negociar, dónde poner el excedente,
-- en cuántos meses se sale. Todo eso necesita UNA cosa para existir: que las
-- deudas estén cargadas.
--
-- Y hasta hoy la única forma de cargarlas era el formulario. A alguien
-- endeudado —que es exactamente a quien esto tiene que servir— se le pedía
-- sentarse a llenar campos por cada acreedor antes de recibir nada a cambio.
-- Es el anti-patrón que la doctrina de finanzas descarta con todas las letras:
-- convierte al usuario en el empleado de EOS, y justo en el momento en que
-- menos ganas tiene.
--
-- Dicho de otro modo: el motor más útil del producto estaba detrás de la
-- barrera de entrada más alta.
--
-- ============================================================
-- REGISTRAR_DEUDA CREA O ACTUALIZA, Y NO PREGUNTA CUÁL
-- ============================================================
--
-- "Debo 8 millones a Financiera Ueno, pago 800 mil el 10" y, tres semanas
-- después, "me quedan 7,2 millones con Ueno" son la misma deuda. Obligar al
-- usuario a saber si está creando o editando es pedirle que conozca el modelo
-- de datos. Se resuelve por acreedor: si ya existe, se actualizan los campos
-- que vinieron y NADA más.
--
-- Devuelve el antes y el después de cada campo, como la v133 con los
-- productos, para que la confirmación diga "de 8.000.000 a 7.200.000" y un
-- error de dictado se vea en el momento.
--
-- ============================================================
-- PAGAR UNA CUOTA ES DOS COSAS A LA VEZ
-- ============================================================
--
-- Baja el saldo de la deuda Y es plata que salió. Registrar solo lo primero
-- deja el mes con un gasto invisible —el disponible real diría que hay plata
-- que ya no está— y registrar solo lo segundo deja la deuda eterna.
--
-- Por eso `REGISTRAR_PAGO_DEUDA` hace las dos: descuenta del saldo, suma una
-- cuota pagada, y deja el movimiento personal correspondiente. Es el único
-- lugar del sistema donde una acción escribe en dos tablas a propósito, y la
-- confirmación lo dice.
--
-- Si el saldo llega a cero, la deuda queda 'saldada' y deja de proyectarse.

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
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA'
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
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA'
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
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA'
  ]));

alter table public.eos_finanzas_deudas
  add column if not exists action_command_id uuid
    references public.eos_action_commands (id) on delete set null;

create index if not exists eos_deudas_action_command_idx
  on public.eos_finanzas_deudas (action_command_id)
  where action_command_id is not null;

-- ============================================================
-- Declarar o corregir una deuda
-- ============================================================

create or replace function public.eos_finanzas_registrar_deuda_v139(
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
  v_acreedor text;
  v_tipo text;
  v_moneda text;
  v_saldo numeric;
  v_cuota numeric;
  v_dia integer;
  v_totales integer;
  v_pagadas integer;
  v_tasa numeric;
  v_vence date;
  v_preocupa boolean;
  v_antes public.eos_finanzas_deudas%rowtype;
  v_id uuid;
  v_cambios jsonb := '{}'::jsonb;
  v_creada boolean := false;
begin
  v_acreedor := nullif(btrim(coalesce(p_datos ->> 'acreedor', p_datos ->> 'quien', p_datos ->> 'nombre', '')), '');

  if v_acreedor is null then
    raise exception 'EOS_ACCION_DEUDA_SIN_ACREEDOR';
  end if;

  v_saldo := nullif(regexp_replace(coalesce(
    p_datos ->> 'saldo', p_datos ->> 'saldo_declarado', p_datos ->> 'monto', ''
  ), '[^0-9.]', '', 'g'), '')::numeric;

  v_cuota := nullif(regexp_replace(coalesce(
    p_datos ->> 'cuota_monto', p_datos ->> 'cuota', ''
  ), '[^0-9.]', '', 'g'), '')::numeric;

  v_dia := nullif(regexp_replace(coalesce(
    p_datos ->> 'cuota_dia', p_datos ->> 'dia', ''
  ), '[^0-9]', '', 'g'), '')::integer;
  if v_dia is not null and (v_dia < 1 or v_dia > 31) then v_dia := null; end if;

  v_totales := nullif(regexp_replace(coalesce(p_datos ->> 'cuotas_totales', ''), '[^0-9]', '', 'g'), '')::integer;
  v_pagadas := nullif(regexp_replace(coalesce(p_datos ->> 'cuotas_pagadas', ''), '[^0-9]', '', 'g'), '')::integer;

  -- La tasa NO se infiere ni se estima nunca: o la dijo el usuario, o no está.
  -- Una tasa inventada se ve idéntica a una real y sobre ella se decide.
  v_tasa := nullif(regexp_replace(coalesce(p_datos ->> 'tasa_anual', p_datos ->> 'tasa', ''), '[^0-9.]', '', 'g'), '')::numeric;
  if v_tasa is not null and (v_tasa <= 0 or v_tasa > 9999) then v_tasa := null; end if;

  v_vence := case
    when coalesce(p_datos ->> 'vence_el', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'vence_el')::date
    else null
  end;

  v_tipo := lower(nullif(btrim(coalesce(p_datos ->> 'tipo', '')), ''));
  if v_tipo is null or v_tipo not in ('prestamo', 'tarjeta', 'proveedor', 'familiar', 'impuesto', 'otro') then
    v_tipo := null;
  end if;

  v_moneda := upper(nullif(btrim(coalesce(p_datos ->> 'moneda', '')), ''));
  if v_moneda is null or length(v_moneda) <> 3 then v_moneda := null; end if;

  v_preocupa := case when (p_datos ->> 'preocupa') in ('true', 'si', 'sí') then true else null end;

  -- ¿Ya existe? Por acreedor, que es como la nombra la persona.
  select * into v_antes
  from public.eos_finanzas_deudas
  where usuario_id = p_usuario_id
    and estado <> 'saldada'
    and lower(acreedor) = lower(v_acreedor)
  limit 1;

  if v_antes.id is null then
    select * into v_antes
    from public.eos_finanzas_deudas
    where usuario_id = p_usuario_id
      and estado <> 'saldada'
      and lower(acreedor) like '%' || lower(v_acreedor) || '%'
    limit 1;
  end if;

  if v_antes.id is null then
    -- Nueva: el saldo es obligatorio. Una deuda sin saldo no se puede ordenar,
    -- ni proyectar, ni negociar: no sirve para nada de lo que este centro hace.
    if v_saldo is null or v_saldo < 0 then
      raise exception 'EOS_ACCION_DEUDA_SIN_SALDO: %', v_acreedor;
    end if;

    -- La base exige cuota y día juntos o ninguno de los dos.
    if v_cuota is not null and v_dia is null then v_cuota := null; end if;
    if v_dia is not null and v_cuota is null then v_dia := null; end if;

    insert into public.eos_finanzas_deudas (
      usuario_id, acreedor, tipo, moneda, saldo_declarado, saldo_declarado_el,
      cuota_monto, cuota_dia, cuotas_totales, cuotas_pagadas,
      tasa_anual, vence_el, estado, preocupa, action_command_id
    ) values (
      p_usuario_id, left(v_acreedor, 120), coalesce(v_tipo, 'otro'), coalesce(v_moneda, 'PYG'),
      v_saldo, (now() at time zone 'America/Asuncion')::date,
      v_cuota, v_dia, v_totales, coalesce(v_pagadas, 0),
      v_tasa, v_vence, 'al_dia', coalesce(v_preocupa, false), p_command_id
    )
    returning id into v_id;

    v_creada := true;
  else
    v_id := v_antes.id;

    if v_saldo is not null and v_saldo is distinct from v_antes.saldo_declarado then
      v_cambios := v_cambios || jsonb_build_object('saldo',
        jsonb_build_object('antes', v_antes.saldo_declarado, 'despues', v_saldo));
    end if;

    if v_cuota is not null and v_cuota is distinct from v_antes.cuota_monto then
      v_cambios := v_cambios || jsonb_build_object('cuota',
        jsonb_build_object('antes', v_antes.cuota_monto, 'despues', v_cuota));
    end if;

    if v_tasa is not null and v_tasa is distinct from v_antes.tasa_anual then
      v_cambios := v_cambios || jsonb_build_object('tasa',
        jsonb_build_object('antes', v_antes.tasa_anual, 'despues', v_tasa));
    end if;

    update public.eos_finanzas_deudas
    set saldo_declarado = coalesce(v_saldo, saldo_declarado),
        saldo_declarado_el = case when v_saldo is null then saldo_declarado_el
                                  else (now() at time zone 'America/Asuncion')::date end,
        cuota_monto = coalesce(v_cuota, cuota_monto),
        cuota_dia = coalesce(v_dia, cuota_dia),
        cuotas_totales = coalesce(v_totales, cuotas_totales),
        cuotas_pagadas = coalesce(v_pagadas, cuotas_pagadas),
        tasa_anual = coalesce(v_tasa, tasa_anual),
        vence_el = coalesce(v_vence, vence_el),
        tipo = coalesce(v_tipo, tipo),
        preocupa = coalesce(v_preocupa, preocupa),
        updated_at = now()
    where id = v_id;
  end if;

  return jsonb_build_object(
    'primero', v_id,
    'acreedor', coalesce(v_antes.acreedor, v_acreedor),
    'creada', v_creada,
    'saldo', coalesce(v_saldo, v_antes.saldo_declarado),
    'moneda', coalesce(v_moneda, v_antes.moneda, 'PYG'),
    'cuota', coalesce(v_cuota, v_antes.cuota_monto),
    'cuota_dia', coalesce(v_dia, v_antes.cuota_dia),
    'sin_cuota', coalesce(v_cuota, v_antes.cuota_monto) is null,
    'cambios', v_cambios
  );
end;
$function$;

revoke all on function public.eos_finanzas_registrar_deuda_v139(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_finanzas_registrar_deuda_v139(uuid, uuid, jsonb) to service_role;

comment on function public.eos_finanzas_registrar_deuda_v139(uuid, uuid, jsonb) is
  'v139: declara o corrige una deuda desde el chat, resolviendo por acreedor. Nunca infiere la tasa.';

-- ============================================================
-- Pagar una cuota: baja la deuda y sale la plata
-- ============================================================

create or replace function public.eos_finanzas_pagar_deuda_v139(
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
  v_acreedor text;
  v_monto numeric;
  v_fecha date;
  v_deuda public.eos_finanzas_deudas%rowtype;
  v_nuevo numeric;
  v_saldada boolean := false;
  v_movimiento uuid;
begin
  v_acreedor := nullif(btrim(coalesce(p_datos ->> 'acreedor', p_datos ->> 'quien', p_datos ->> 'nombre', '')), '');

  if v_acreedor is null then
    raise exception 'EOS_ACCION_DEUDA_SIN_ACREEDOR';
  end if;

  select * into v_deuda
  from public.eos_finanzas_deudas
  where usuario_id = p_usuario_id
    and estado <> 'saldada'
    and lower(acreedor) = lower(v_acreedor)
  limit 1;

  if v_deuda.id is null then
    select * into v_deuda
    from public.eos_finanzas_deudas
    where usuario_id = p_usuario_id
      and estado <> 'saldada'
      and lower(acreedor) like '%' || lower(v_acreedor) || '%'
    limit 1;
  end if;

  if v_deuda.id is null then
    raise exception 'EOS_ACCION_DEUDA_NO_ENCONTRADA: %', v_acreedor;
  end if;

  v_monto := nullif(regexp_replace(coalesce(
    p_datos ->> 'monto', p_datos ->> 'importe', ''
  ), '[^0-9.]', '', 'g'), '')::numeric;

  -- Sin monto se asume la cuota declarada, que es lo que casi siempre se paga.
  -- Si tampoco hay cuota, se pregunta: descontar un número inventado del saldo
  -- de una deuda es de los errores más caros que puede cometer el sistema.
  if v_monto is null or v_monto <= 0 then
    v_monto := v_deuda.cuota_monto;
  end if;

  if v_monto is null or v_monto <= 0 then
    raise exception 'EOS_ACCION_PAGO_SIN_MONTO: %', v_deuda.acreedor;
  end if;

  v_nuevo := greatest(0, v_deuda.saldo_declarado - v_monto);
  v_saldada := v_nuevo = 0;

  v_fecha := case
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'fecha')::date
    else (now() at time zone 'America/Asuncion')::date
  end;

  update public.eos_finanzas_deudas
  set saldo_declarado = v_nuevo,
      saldo_declarado_el = v_fecha,
      cuotas_pagadas = cuotas_pagadas + 1,
      estado = case when v_saldada then 'saldada' else estado end,
      updated_at = now()
  where id = v_deuda.id;

  -- Y la plata que salió. Sin esto el disponible real diría que hay plata que
  -- ya no está: la deuda bajó y el mes no se enteró.
  insert into public.eos_movimientos_financieros (
    usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, ambito,
    action_command_id, metadata
  ) values (
    p_usuario_id, 'gasto', v_monto, v_deuda.moneda,
    'Pago de deuda — ' || v_deuda.acreedor, 'deudas', v_fecha, 'chat', 'personal',
    p_command_id,
    jsonb_build_object('fuente', 'worker_gate', 'deuda_id', v_deuda.id)
  )
  returning id into v_movimiento;

  return jsonb_build_object(
    'primero', v_movimiento,
    'acreedor', v_deuda.acreedor,
    'pagado', v_monto,
    'moneda', v_deuda.moneda,
    'saldo_antes', v_deuda.saldo_declarado,
    'saldo_despues', v_nuevo,
    'saldada', v_saldada,
    'cuotas_pagadas', v_deuda.cuotas_pagadas + 1,
    'cuotas_totales', v_deuda.cuotas_totales
  );
end;
$function$;

revoke all on function public.eos_finanzas_pagar_deuda_v139(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_finanzas_pagar_deuda_v139(uuid, uuid, jsonb) to service_role;

comment on function public.eos_finanzas_pagar_deuda_v139(uuid, uuid, jsonb) is
  'v139: paga una cuota. Baja el saldo, suma la cuota pagada Y deja el gasto personal: las dos cosas o ninguna.';
