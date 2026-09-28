-- EOS — Una compra con tarjeta no se pierde porque la tarjeta no estaba cargada (v208)
--
-- ============================================================
-- LO QUE PASÓ (27 de septiembre de 2026, usando EOS de verdad)
-- ============================================================
--
-- "Anotalo en Personal, el pago de OpenAI ... sale de mi tarjeta de crédito
-- de Banco Basa". Banco Basa no estaba cargada: la acción terminó en
-- EOS_ACCION_TARJETA_NO_ENCONTRADA y EOS pidió los datos de la tarjeta. La
-- persona la cargó en el mensaje siguiente... y la compra no se anotó nunca:
-- nadie retomaba la acción que había fallado. "Le repito y sigue sin anotar."
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- Cuando la persona NOMBRA una tarjeta que no existe, se crea en ese momento
-- (con el nombre que dijo, sin ciclo, con `eos_finanzas_registrar_tarjeta_v153`,
-- lo mismo que usa REGISTRAR_TARJETA) y la compra se anota. El resultado lo
-- dice (`tarjeta_creada`) para que la respuesta pida el cierre y el
-- vencimiento, que es lo único que falta.
--
-- Sin nombrar ninguna y sin ninguna cargada sigue siendo un error: no hay de
-- dónde sacar un nombre.
--
-- Mismo nombre y firma que la v153: el ejecutor la llama por su nombre.
-- Partida de la definición que está en producción, no de la migración vieja.

create or replace function public.eos_finanzas_compra_tarjeta_v153(p_usuario_id uuid, p_command_id uuid, p_datos jsonb)
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
  v_creada boolean := false;
  v_alta jsonb;
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

    -- La nombró y no existe: se crea ahora (v208). Ver la cabecera.
    if v_tarjeta_id is null then
      v_alta := public.eos_finanzas_registrar_tarjeta_v153(
        p_usuario_id,
        p_command_id,
        jsonb_build_object('tarjeta', v_texto, 'emisor', v_texto)
      );
      v_tarjeta_id := nullif(v_alta ->> 'id', '')::uuid;
      v_creada := true;
    end if;

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
    -- La tarjeta no existía y se creó recién: falta su cierre y vencimiento.
    'tarjeta_creada', v_creada,
    -- Que no es un gasto de este mes es LO que hay que decir. Ver la cabecera.
    'no_es_gasto', true
  );
end;
$function$;

revoke all on function public.eos_finanzas_compra_tarjeta_v153(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_finanzas_compra_tarjeta_v153(uuid, uuid, jsonb) to service_role;
