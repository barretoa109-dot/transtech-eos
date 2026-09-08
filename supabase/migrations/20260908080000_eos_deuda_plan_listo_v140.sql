-- La confirmación de una deuda prometía una pantalla que podía estar vacía.
--
-- Al probar el recorrido completo apareció: se registran dos deudas por chat,
-- EOS contesta "la ves en Personal, con el orden en que conviene pagar" — y
-- esa tarjeta no se muestra si la persona no cargó su Constitución Financiera,
-- porque el plan necesita saber cuánto entra y cuánto se va en vivir para
-- calcular la capacidad de pago.
--
-- Es la misma familia de error que se viene sacando todo el día: una
-- confirmación que afirma algo que no es. Acá la afirmación era sobre dónde
-- mirar.
--
-- La función devuelve `plan_listo` y la frase se adapta. No se baja el
-- requisito ni se arma un plan con supuestos: una capacidad de pago calculada
-- sobre un historial vacío diría que no alcanza para nada, que es peor que no
-- decir nada.

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
  v_hay_politica boolean;
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

  -- ¿Puede EOS armar el plan de pago con esto?
  --
  -- El plan necesita la Constitución Financiera para saber cuánto entra y
  -- cuánto se va en vivir. Sin ella la tarjeta del plan no se muestra, y
  -- decirle a alguien "la ves en Personal con el orden en que conviene pagar"
  -- cuando ahí no va a haber nada es prometer una pantalla vacía. Se devuelve
  -- el dato para que la confirmación diga la verdad.
  select exists (
    select 1 from public.eos_finanzas_politica p where p.usuario_id = p_usuario_id
  ) into v_hay_politica;

  return jsonb_build_object(
    'primero', v_id,
    'plan_listo', v_hay_politica,
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

comment on function public.eos_finanzas_registrar_deuda_v139(uuid, uuid, jsonb) is
  'v140: además dice si EOS ya puede armar el plan de pago, para que la confirmación no mande a una pantalla vacía.';
