-- Cuenta real en el chat personal (PR C de la secuencia, sobre el schema
-- de la v240): REGISTRAR_MOVIMIENTO_PERSONAL y REGISTRAR_PAGO_DEUDA (que ya
-- cubre el pago de tarjeta, v222) pasan a aceptar `cuenta` opcional y
-- resolverla con `eos_resolver_cuenta_v240`.
--
-- Igual que en la ficha de alta rápida: opcional, nunca obligatorio. Sin
-- `cuenta` dicha, el movimiento se guarda igual, sin cuenta asignada.
--
-- El pago de tarjeta de empresa (`ambito='negocio'`) queda FUERA a
-- propósito: `eos_finanzas_tarjetas` no tiene `empresa_id`, así que resolver
-- una `eos_empresa_cajas_v120` desde ahí requeriría primero resolver a qué
-- empresa pertenece ese usuario — un problema aparte, no de esta migración.
-- Para ese caso, `cuenta_id`/`caja_id` quedan en NULL, como cualquier
-- movimiento sin cuenta asignada.
--
-- Cuerpo completo tomado de la definición viva en producción
-- (`pg_get_functiondef`), con el agregado mínimo: no se reescribe nada de
-- lo que ya hacían (dedup de la v226, pago mínimo de la v227, etc.).

CREATE OR REPLACE FUNCTION public.eos_finanzas_registrar_personal_v136(p_usuario_id uuid, p_command_id uuid, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item jsonb;
  v_lista jsonb;
  v_tipo text;
  v_pedido text;
  v_monto numeric;
  v_descripcion text;
  v_fecha date;
  v_moneda text;
  v_id uuid;
  v_primero uuid;
  v_hechos jsonb := '[]'::jsonb;
  v_cuantos integer := 0;
  v_entra numeric := 0;
  v_sale numeric := 0;
  v_vuelve numeric := 0;
  v_previa_id uuid;
  v_previa_desc text;
  v_previa_en timestamptz;
  v_repetidos jsonb := '[]'::jsonb;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_cuenta_nombre text;
  v_cuenta_id uuid;
begin
  v_lista := case
    when jsonb_typeof(p_datos -> 'movimientos') = 'array' then p_datos -> 'movimientos'
    when jsonb_typeof(p_datos -> 'items') = 'array' then p_datos -> 'items'
    else jsonb_build_array(p_datos)
  end;

  if jsonb_array_length(v_lista) = 0 then
    raise exception 'EOS_ACCION_PERSONAL_SIN_DATOS';
  end if;

  for v_item in select * from jsonb_array_elements(v_lista)
  loop
    v_cuantos := v_cuantos + 1;
    if v_cuantos > 15 then
      raise exception 'EOS_ACCION_PERSONAL_DEMASIADOS';
    end if;

    v_descripcion := nullif(btrim(coalesce(
      v_item ->> 'descripcion', v_item ->> 'concepto', v_item ->> 'detalle', ''
    )), '');

    if v_descripcion is null then
      raise exception 'EOS_ACCION_PERSONAL_SIN_DESCRIPCION';
    end if;

    v_monto := public.eos_leer_monto(coalesce(
      v_item ->> 'monto', v_item ->> 'importe', v_item ->> 'total', ''
    ));

    if v_monto is null or v_monto <= 0 then
      raise exception 'EOS_ACCION_PERSONAL_SIN_MONTO: %', v_descripcion;
    end if;

    -- El tipo no se adivina de la descripción. "Cobré" e "invertí" se parecen
    -- lo suficiente como para que una heurística acá se equivoque de signo, y
    -- un gasto contado como ingreso mueve el disponible real al doble en la
    -- dirección equivocada.
    v_pedido := lower(coalesce(v_item ->> 'tipo', ''));

    v_tipo := case
      when v_pedido = 'ingreso' then 'ingreso'
      -- Devolución, reembolso, reintegro: la plata había salido y volvió. Se
      -- guarda como gasto NEGATIVO para que reste del gasto de su categoría en
      -- vez de inflar los ingresos del mes.
      when v_pedido in ('devolucion', 'devolución', 'reembolso', 'reintegro') then 'devolucion'
      else 'gasto'
    end;

    v_fecha := case
      when coalesce(v_item ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_item ->> 'fecha')::date
      else (now() at time zone 'America/Asuncion')::date
    end;

    v_moneda := upper(nullif(btrim(coalesce(v_item ->> 'moneda', '')), ''));
    if v_moneda is null or length(v_moneda) <> 3 then v_moneda := 'PYG'; end if;

    -- Cuenta: por ítem si lo dice, si no la del pedido entero ("pagué todo
    -- con la Visa"); ninguna de las dos es obligatoria. Resuelve igual que
    -- DECLARAR_SALDO: exacta gana, con más de una parecida pregunta.
    v_cuenta_nombre := nullif(btrim(coalesce(v_item ->> 'cuenta', p_datos ->> 'cuenta', '')), '');
    v_cuenta_id := case
      when v_cuenta_nombre is not null
        then public.eos_resolver_cuenta_v240(p_usuario_id, v_cuenta_nombre, v_moneda)
      else null
    end;


    /*
     * v226: lo que ya está anotado no se anota otra vez.
     *
     * El 29/09/2026 un gasto de 22.650 del 27/09 se cargó de nuevo, leído de
     * una captura de la misma app y con otra descripción. Cargado de atrás,
     * mismo tipo, monto y fecha alcanza para decir que es el mismo. De hoy,
     * además tiene que parecerse la descripción y ser de las últimas 2 horas.
     * Los ítems de este mismo pedido no cuentan: "dos pasajes de 5.000" son dos.
     */
    v_previa_id := null;
    if lower(coalesce(v_item ->> 'otra_igual', v_item ->> 'repetir', p_datos ->> 'otra_igual', p_datos ->> 'repetir', '')) not in ('true', 'si', 'sí', '1') then
      select m.id, m.descripcion, m.created_at into v_previa_id, v_previa_desc, v_previa_en
      from public.eos_movimientos_financieros m
      where m.usuario_id = p_usuario_id
        and m.ambito = 'personal'
        and m.tipo = case when v_tipo = 'ingreso' then 'ingreso' else 'gasto' end
        and m.monto = case when v_tipo = 'devolucion' then -v_monto else v_monto end
        and m.fecha = v_fecha
        and m.action_command_id is distinct from p_command_id
        and (
          v_fecha < v_hoy
          or (
            m.created_at > now() - interval '2 hours'
            and (
              position(lower(btrim(m.descripcion)) in lower(v_descripcion)) > 0
              or position(lower(v_descripcion) in lower(btrim(m.descripcion))) > 0
            )
          )
        )
      order by m.created_at desc
      limit 1;
    end if;

    if v_previa_id is not null then
      v_repetidos := v_repetidos || jsonb_build_object(
        'id', v_previa_id,
        'tipo', v_tipo,
        'monto', v_monto,
        'moneda', v_moneda,
        'descripcion', v_descripcion,
        'fecha', v_fecha,
        'como', v_previa_desc,
        'anotado_el', to_char(v_previa_en at time zone 'America/Asuncion', 'DD/MM HH24:MI')
      );
      continue;
    end if;

    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, fecha, origen, ambito,
      action_command_id, metadata, cuenta_id
    ) values (
      p_usuario_id,
      case when v_tipo = 'ingreso' then 'ingreso' else 'gasto' end,
      case when v_tipo = 'devolucion' then -v_monto else v_monto end,
      v_moneda,
      -- El prefijo solo si no lo dijo ya el modelo: "Devolución — Devolución
      -- de camisa" es lo que sale de agregarlo sin mirar, y se lee como un
      -- error del sistema.
      left(case
        when v_tipo = 'devolucion' and lower(v_descripcion) not like '%devoluci%'
          and lower(v_descripcion) not like '%reembols%'
          and lower(v_descripcion) not like '%reintegr%'
        then 'Devolución — ' || v_descripcion
        else v_descripcion
      end, 300),
      v_fecha,
      'chat', 'personal', p_command_id,
      jsonb_build_object('fuente', 'worker_gate', 'action_command_id', p_command_id)
        || case when v_tipo = 'devolucion' then jsonb_build_object('devolucion', true) else '{}'::jsonb end,
      v_cuenta_id
    )
    returning id into v_id;

    if v_primero is null then v_primero := v_id; end if;

    if v_tipo = 'ingreso' then v_entra := v_entra + v_monto;
    elsif v_tipo = 'devolucion' then v_vuelve := v_vuelve + v_monto;
    else v_sale := v_sale + v_monto;
    end if;

    v_hechos := v_hechos || jsonb_build_object(
      'id', v_id,
      'tipo', v_tipo,
      'monto', v_monto,
      'moneda', v_moneda,
      'descripcion', v_descripcion,
      'fecha', v_fecha
    );
  end loop;


  -- v226: si todo estaba, el "primero" es el que ya estaba (el efecto necesita un id).
  if v_primero is null and jsonb_array_length(v_repetidos) > 0 then
    v_primero := (v_repetidos -> 0 ->> 'id')::uuid;
  end if;

  return jsonb_build_object(
    'repetidos', v_repetidos,
    'primero', v_primero,
    'movimientos', v_hechos,
    'entro', v_entra,
    'salio', v_sale,
    'volvio', v_vuelve
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.eos_finanzas_pagar_deuda_v139(p_usuario_id uuid, p_command_id uuid, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_acreedor text;
  v_monto numeric;
  v_fecha date;
  v_deuda public.eos_finanzas_deudas%rowtype;
  v_nuevo numeric;
  v_saldada boolean := false;
  v_movimiento uuid;
  v_tarjeta public.eos_finanzas_tarjetas%rowtype;
  v_cuenta_nombre text;
  v_cuenta_id uuid;
begin
  v_acreedor := nullif(btrim(coalesce(p_datos ->> 'acreedor', p_datos ->> 'quien', p_datos ->> 'nombre', '')), '');

  if v_acreedor is null then
    raise exception 'EOS_ACCION_DEUDA_SIN_ACREEDOR';
  end if;

  -- Cuenta: de dónde salió el pago. Opcional en los dos caminos de abajo
  -- (deuda o tarjeta); se resuelve donde ya se sabe la moneda de cada uno.
  v_cuenta_nombre := nullif(btrim(coalesce(p_datos ->> 'cuenta', '')), '');

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
    -- v222: el resumen de una tarjeta se paga igual que una cuota.
    select * into v_tarjeta
    from public.eos_finanzas_tarjetas t
    where t.usuario_id = p_usuario_id
      and t.activa
      and (lower(t.nombre) = lower(v_acreedor) or lower(coalesce(t.emisor, '')) = lower(v_acreedor))
    order by t.updated_at desc
    limit 1;

    if v_tarjeta.id is null then
      select * into v_tarjeta
      from public.eos_finanzas_tarjetas t
      where t.usuario_id = p_usuario_id
        and t.activa
        and (lower(t.nombre) like '%' || lower(v_acreedor) || '%'
             or lower(coalesce(t.emisor, '')) like '%' || lower(v_acreedor) || '%')
      order by t.updated_at desc
      limit 1;
    end if;

    if v_tarjeta.id is null then
      raise exception 'EOS_ACCION_DEUDA_NO_ENCONTRADA: %', v_acreedor;
    end if;

    v_monto := public.eos_leer_monto(coalesce(p_datos ->> 'monto', p_datos ->> 'importe', ''));
    if v_monto is null or v_monto <= 0 then
      -- v227: sin monto dicho no se paga el mínimo guardado: se pregunta.
      raise exception 'EOS_ACCION_PAGO_TARJETA_SIN_MONTO: % · %', v_tarjeta.nombre, coalesce(v_tarjeta.pago_minimo::text, '');
    end if;
    if v_monto is null or v_monto <= 0 then
      raise exception 'EOS_ACCION_PAGO_SIN_MONTO: %', v_tarjeta.nombre;
    end if;

    v_fecha := case
      when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'fecha')::date
      else (now() at time zone 'America/Asuncion')::date
    end;

    v_nuevo := case when v_tarjeta.saldo_utilizado is null then null
                    else greatest(0, v_tarjeta.saldo_utilizado - v_monto) end;

    update public.eos_finanzas_tarjetas
    set saldo_utilizado = v_nuevo,
        saldo_al = case when v_nuevo is null then saldo_al else v_fecha end,
        updated_at = now()
    where id = v_tarjeta.id;

    -- Sólo del lado personal: una tarjeta de negocio no tiene con qué
    -- resolver una eos_empresa_cajas_v120 desde acá (no hay empresa_id en
    -- esta tabla). Queda sin cuenta asignada, como cualquier movimiento sin
    -- cuenta — no es un error, es un caso fuera de este alcance.
    v_cuenta_id := case
      when v_cuenta_nombre is not null and v_tarjeta.ambito = 'personal'
        then public.eos_resolver_cuenta_v240(p_usuario_id, v_cuenta_nombre, coalesce(v_tarjeta.moneda, 'PYG'))
      else null
    end;

    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, ambito,
      action_command_id, metadata, cuenta_id
    ) values (
      p_usuario_id, 'gasto', v_monto, coalesce(v_tarjeta.moneda, 'PYG'),
      'Pago de tarjeta — ' || v_tarjeta.nombre, 'tarjetas', v_fecha, 'chat', v_tarjeta.ambito,
      p_command_id,
      jsonb_build_object('fuente', 'worker_gate', 'tarjeta_id', v_tarjeta.id),
      v_cuenta_id
    )
    returning id into v_movimiento;

    return jsonb_build_object(
      'primero', v_movimiento,
      'es_tarjeta', true,
      'tarjeta', v_tarjeta.nombre,
      'pagado', v_monto,
      'moneda', coalesce(v_tarjeta.moneda, 'PYG'),
      'saldo_antes', v_tarjeta.saldo_utilizado,
      'saldo_despues', v_nuevo
    );
  end if;

  v_monto := public.eos_leer_monto(coalesce(
    p_datos ->> 'monto', p_datos ->> 'importe', ''
  ));

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

  v_cuenta_id := case
    when v_cuenta_nombre is not null
      then public.eos_resolver_cuenta_v240(p_usuario_id, v_cuenta_nombre, v_deuda.moneda)
    else null
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
    action_command_id, metadata, cuenta_id
  ) values (
    p_usuario_id, 'gasto', v_monto, v_deuda.moneda,
    'Pago de deuda — ' || v_deuda.acreedor, 'deudas', v_fecha, 'chat', 'personal',
    p_command_id,
    jsonb_build_object('fuente', 'worker_gate', 'deuda_id', v_deuda.id),
    v_cuenta_id
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
