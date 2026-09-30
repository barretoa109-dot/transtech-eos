-- v223: lo que ya está anotado no se anota otra vez, y lo que se cambia se dice.
--
-- ============================================================
-- EL CASO (29/09/2026, 17:34 a 17:45)
-- ============================================================
--
-- "Gasté 46.000 en Punto Farma con mi tarjeta Green, que por cierto ya pagué
-- el mínimo, y gané 100.000." La compra se guardó bien a las 17:34. La
-- pantalla de Tarjetas la escondía (se arregla en la app), la persona dijo
-- "no está", y cada "no está" la volvió a mandar: CINCO compras de ₲46.000
-- en la Green en once minutos. Además:
--
--   · Un gasto de ₲22.650 del 27/09 que ya estaba anotado se cargó de nuevo,
--     sacado de una captura de la propia app, con otra descripción.
--   · REGISTRAR_TARJETA, mandada con los datos que el modelo tenía en el
--     contexto, cambió el emisor ("American Express" → "Banco Basa") y movió
--     la fecha del resumen del 23/09 al 29/09. La respuesta dijo "Actualicé
--     Green" sin decir QUÉ cambió.
--   · "Ya pagué el mínimo" terminó en REGISTRAR_PAGO_DEUDA contra "Green",
--     que es una tarjeta: eso lo resuelve la v222 (el pago de una tarjeta).
--
-- ============================================================
-- QUÉ HACE ESTA MIGRACIÓN
-- ============================================================
--
-- 1. Compra con tarjeta: la misma compra (misma tarjeta, mismo comercio,
--    misma cuota, mismas cuotas, mismo día) anotada en las últimas 6 horas
--    NO se inserta otra vez: se devuelve la que ya estaba, con `ya_estaba` y
--    la hora. Dos compras iguales de verdad se anotan con `repetir: true`
--    (el mismo nombre que usa el freno de `lib/gateway/worker.ts`, v222) o
--    `otra_igual: true`.
-- 2. Movimiento personal: un movimiento igual a uno que ya está no se inserta
--    y va a `repetidos`. "Igual" es mismo tipo, monto y fecha, y además:
--      · si la fecha es anterior a hoy (se cargó de atrás, casi siempre desde
--        una captura o un resumen), con eso alcanza;
--      · si es de hoy, la descripción se tiene que parecer y el anterior tiene
--        que ser de las últimas 2 horas (más, y el pasaje de la vuelta sería
--        "el mismo" que el de la ida).
--    Los ítems de un mismo pedido no se comparan entre sí: "dos pasajes de
--    5.000" son dos. `repetir: true` anota igual.
--
--    Por qué también acá y no solo en `lib/gateway/worker.ts` (el freno de
--    la v222): ese corre en el camino de TEXTO. De las cuatro compras repetidas
--    del caso, tres entraron por n8n (mensajes con captura), que no pasa por ahí. La
--    base es el único lugar por el que pasan los dos caminos.
-- 3. Tarjeta: devuelve `cambios` (campo, antes, después) y `sin_cambios`. El
--    mínimo o el total repetidos con el mismo valor ya no mueven la fecha del
--    resumen: un resumen dictado de nuevo no es un resumen nuevo.
--
-- ============================================================
-- POR QUÉ SE PARCHEA EN SU LUGAR
-- ============================================================
--
-- Regla del proyecto (ver docs y la v160): una función que otra sesión puede
-- estar tocando se parchea leyendo `pg_get_functiondef`, con el texto anclado.
-- Si el ancla no está, se frena con error en vez de pisar. Si el parche ya
-- está (la marca `v223`), se saltea: la migración es idempotente. Los
-- retornos de carro se sacan antes de buscar las anclas: las funciones se
-- escribieron en Windows y en la base quedaron con CRLF.

do $$
declare
  v_def text;
  v_nueva text;
begin
  ------------------------------------------------------------------
  -- 1. eos_finanzas_compra_tarjeta_v153
  ------------------------------------------------------------------
  v_def := replace(pg_get_functiondef('public.eos_finanzas_compra_tarjeta_v153(uuid, uuid, jsonb)'::regprocedure), chr(13), '');

  if position('v223' in v_def) > 0 then
    raise notice 'v223: compra_tarjeta ya parcheada';
  else
    if position(E'  v_alta jsonb;\nbegin' in v_def) = 0
       or position(E'  insert into public.eos_finanzas_tarjeta_compras (' in v_def) = 0 then
      raise exception 'v223: compra_tarjeta cambió, no encuentro las anclas';
    end if;

    v_nueva := replace(v_def, E'  v_alta jsonb;\nbegin', E'  v_alta jsonb;\n  v_previa_id uuid;\n  v_previa_en timestamptz;\nbegin');

    v_nueva := replace(v_nueva, E'  insert into public.eos_finanzas_tarjeta_compras (', $parche$
  /*
   * v223: la misma compra, dicha otra vez, no se anota dos veces.
   *
   * El 29/09/2026 una compra de 46.000 quedó cinco veces en la Green: la
   * pantalla la escondía y cada "no está" la volvía a mandar. Se devuelve la
   * que ya estaba, con la hora, y la respuesta dice "ya estaba anotada".
   * Dos compras iguales de verdad vienen con otra_igual: true.
   */
  if lower(coalesce(p_datos ->> 'otra_igual', p_datos ->> 'repetir', '')) not in ('true', 'si', 'sí', '1') then
    select c.id, c.created_at into v_previa_id, v_previa_en
    from public.eos_finanzas_tarjeta_compras c
    where c.usuario_id = p_usuario_id
      and c.tarjeta_id = v_tarjeta_id
      and c.monto_cuota = v_cuota
      and c.cuotas_totales = v_cuotas
      and c.primera_cuota = v_primera
      and c.created_at > now() - interval '6 hours'
      and (
        position(lower(btrim(c.descripcion)) in lower(v_descripcion)) > 0
        or position(lower(v_descripcion) in lower(btrim(c.descripcion))) > 0
      )
    order by c.created_at desc
    limit 1;

    if v_previa_id is not null then
      return jsonb_build_object(
        'id', v_previa_id,
        'tarjeta', coalesce(v_tarjeta.nombre, v_tarjeta.emisor),
        'descripcion', v_descripcion,
        'moneda', v_tarjeta.moneda,
        'monto_cuota', v_cuota,
        'monto_total', v_total,
        'cuotas', v_cuotas,
        'cuotas_pagadas', v_pagadas,
        'primera_cuota', v_primera,
        'cuota_estimada', v_estimada,
        'tarjeta_creada', false,
        'no_es_gasto', true,
        'ya_estaba', true,
        'anotada_a_las', to_char(v_previa_en at time zone 'America/Asuncion', 'HH24:MI')
      );
    end if;
  end if;

  insert into public.eos_finanzas_tarjeta_compras ($parche$);

    execute v_nueva;
  end if;

  ------------------------------------------------------------------
  -- 2. eos_finanzas_registrar_personal_v136
  ------------------------------------------------------------------
  v_def := replace(pg_get_functiondef('public.eos_finanzas_registrar_personal_v136(uuid, uuid, jsonb)'::regprocedure), chr(13), '');

  if position('v223' in v_def) > 0 then
    raise notice 'v223: registrar_personal ya parcheada';
  else
    if position(E'  v_vuelve numeric := 0;\nbegin' in v_def) = 0
       or position(E'    insert into public.eos_movimientos_financieros (' in v_def) = 0
       or position(E'  return jsonb_build_object(\n    ''primero'', v_primero,' in v_def) = 0 then
      raise exception 'v223: registrar_personal cambió, no encuentro las anclas';
    end if;

    v_nueva := replace(v_def, E'  v_vuelve numeric := 0;\nbegin', E'  v_vuelve numeric := 0;\n  v_previa_id uuid;\n  v_previa_desc text;\n  v_previa_en timestamptz;\n  v_repetidos jsonb := ''[]''::jsonb;\n  v_hoy date := (now() at time zone ''America/Asuncion'')::date;\nbegin');

    v_nueva := replace(v_nueva, E'    insert into public.eos_movimientos_financieros (', $parche$
    /*
     * v223: lo que ya está anotado no se anota otra vez.
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

    insert into public.eos_movimientos_financieros ($parche$);

    v_nueva := replace(v_nueva, E'  return jsonb_build_object(\n    ''primero'', v_primero,', $parche$
  -- v223: si todo estaba, el "primero" es el que ya estaba (el efecto necesita un id).
  if v_primero is null and jsonb_array_length(v_repetidos) > 0 then
    v_primero := (v_repetidos -> 0 ->> 'id')::uuid;
  end if;

  return jsonb_build_object(
    'repetidos', v_repetidos,
    'primero', v_primero,$parche$);

    execute v_nueva;
  end if;

  ------------------------------------------------------------------
  -- 3. eos_finanzas_registrar_tarjeta_v153
  ------------------------------------------------------------------
  v_def := replace(pg_get_functiondef('public.eos_finanzas_registrar_tarjeta_v153(uuid, uuid, jsonb)'::regprocedure), chr(13), '');

  if position('v223' in v_def) > 0 then
    raise notice 'v223: registrar_tarjeta ya parcheada';
  else
    if position(E'  v_hoy date;\nbegin' in v_def) = 0
       or position(E'  else\n    update public.eos_finanzas_tarjetas t' in v_def) = 0
       or position(E'      ''falta_ciclo'', t.dia_cierre is null or t.dia_vencimiento is null\n    )' in v_def) = 0 then
      raise exception 'v223: registrar_tarjeta cambió, no encuentro las anclas';
    end if;

    v_nueva := replace(v_def, E'  v_hoy date;\nbegin', E'  v_hoy date;\n  v_antes jsonb;\n  v_despues jsonb;\n  v_cambios jsonb := ''[]''::jsonb;\n  v_campo text;\nbegin');

    v_nueva := replace(v_nueva, E'  else\n    update public.eos_finanzas_tarjetas t', $parche$
  else
    select to_jsonb(t) into v_antes from public.eos_finanzas_tarjetas t where t.id = v_id;

    /*
     * v223: el mismo resumen dictado de nuevo no es un resumen nuevo.
     *
     * El 29/09/2026 el modelo volvió a mandar el mínimo que ya tenía la
     * tarjeta (188.000) y eso movió la fecha del resumen del 23/09 a hoy: la
     * tarjeta pasó a decir que el resumen era de otro ciclo.
     */
    if not (p_datos ? 'resumen_al')
       and (v_minimo is null or v_minimo = (v_antes ->> 'pago_minimo')::numeric)
       and (v_total is null or v_total = (v_antes ->> 'pago_total')::numeric) then
      v_resumen_al := null;
    end if;

    update public.eos_finanzas_tarjetas t$parche$);

    v_nueva := replace(v_nueva, E'      ''falta_ciclo'', t.dia_cierre is null or t.dia_vencimiento is null\n    )', $parche$      'falta_ciclo', t.dia_cierre is null or t.dia_vencimiento is null
    ) || jsonb_build_object('cambios', v_cambios, 'sin_cambios', v_antes is not null and jsonb_array_length(v_cambios) = 0)$parche$);

    -- Los cambios se calculan justo antes del return final.
    v_nueva := replace(v_nueva, E'  return (\n    select jsonb_build_object(\n      ''id'', t.id,', $parche$
  /*
   * v223: "Actualicé Green" sin decir qué, no. Cada campo que cambió va con su
   * antes y su después, para que un dato que nadie dijo se vea en la respuesta.
   */
  if v_antes is not null then
    select to_jsonb(t) into v_despues from public.eos_finanzas_tarjetas t where t.id = v_id;
    foreach v_campo in array array['emisor', 'moneda', 'linea_total', 'saldo_utilizado', 'dia_cierre', 'dia_vencimiento', 'pago_minimo', 'pago_total', 'resumen_al']
    loop
      if (v_antes -> v_campo) is distinct from (v_despues -> v_campo) then
        v_cambios := v_cambios || jsonb_build_object(
          'campo', v_campo,
          'antes', v_antes -> v_campo,
          'despues', v_despues -> v_campo
        );
      end if;
    end loop;
  end if;

  return (
    select jsonb_build_object(
      'id', t.id,$parche$);

    if position('v_despues' in v_nueva) = 0 then
      raise exception 'v223: registrar_tarjeta, no encuentro el return final';
    end if;

    execute v_nueva;
  end if;

end;
$$;
