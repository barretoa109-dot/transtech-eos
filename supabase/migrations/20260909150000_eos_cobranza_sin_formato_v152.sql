-- Dos correcciones sobre la v151, encontradas probándola contra producción.
--
-- ============================================================
-- 1. LA BASE NO FORMATEA PLATA. NUNCA.
-- ============================================================
--
-- El mensaje de "eso es más de lo que te debe" salía así:
--
--     EOS_COBRANZA_EXCEDE: 60,000.
--
-- `to_char(..., 'FM999G999G999G999D99')` usa el locale del servidor, que
-- agrupa con coma y separa decimales con punto. En Paraguay es exactamente al
-- revés: sesenta mil se escribe 60.000. El error le mostraba a la persona su
-- propia plata con el formato de otro país, y encima con un punto suelto al
-- final que es el separador decimal vacío.
--
-- El formato de la plata vive en UN solo lugar —`lib/finanzas/formato.ts`— y
-- este proyecto ya pagó cuatro fugas de esa regla. Así que la base deja de
-- formatear: manda `MONEDA|numero` y la traducción del error, que ya existe y
-- ya sabe de monedas, lo escribe.
--
-- ============================================================
-- 2. EL PREFIJO NO ERA DECORATIVO
-- ============================================================
--
-- Hay una prueba que exige que TODA excepción `EOS_ACCION_*` de las
-- migraciones tenga su traducción. Los códigos nuevos se llamaban
-- `EOS_COBRANZA_*` y quedaban afuera del barrido: se podían olvidar sin que
-- nada avisara, y volverían a caer en el 500 genérico con "no pude" y nada
-- más.
--
-- `EOS_ACCION_` no es un adorno: significa "regla de negocio que la persona
-- puede resolver", y es lo que separa un 422 con instrucciones de un 500 que
-- es una alarma. Las seis pasan a llamarse `EOS_ACCION_COBRO_*`, que además
-- dice mejor lo que son: la función sirve para cobrar y para pagar.

create or replace function public.eos_erp_cobranza_por_chat_v151(
  p_usuario_id uuid,
  p_command_id uuid,
  p_datos jsonb,
  p_es_venta boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_nombre text;
  v_contacto_id uuid;
  v_monto numeric;
  v_fecha date;
  v_moneda text;
  v_todo boolean;
  v_pendientes jsonb := '[]'::jsonb;
  v_doc record;
  v_total_pendiente numeric := 0;
  v_monedas text[];
  v_cuantos integer := 0;
  v_aplicado numeric := 0;
  v_este numeric;
  v_tocados jsonb := '[]'::jsonb;
  v_primero uuid;
  v_lista text;
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  v_nombre := nullif(btrim(coalesce(
    p_datos ->> 'contacto', p_datos ->> 'cliente', p_datos ->> 'proveedor',
    p_datos ->> 'nombre', ''
  )), '');

  if v_nombre is null then
    raise exception 'EOS_ACCION_COBRO_SIN_CONTACTO';
  end if;

  v_contacto_id := public.eos_crm_resolver_contacto(p_usuario_id, v_nombre);

  if v_contacto_id is null then
    raise exception 'EOS_ACCION_CONTACTO_NO_RESUELTO: %', v_nombre;
  end if;

  v_monto := public.eos_leer_monto(coalesce(
    p_datos ->> 'monto', p_datos ->> 'importe', p_datos ->> 'total', ''
  ));

  if v_monto is not null and v_monto <= 0 then
    raise exception 'EOS_ACCION_COBRO_MONTO_INVALIDO';
  end if;

  v_fecha := case
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'fecha')::date
    else public.eos_hoy_py()
  end;

  v_moneda := upper(nullif(btrim(coalesce(p_datos ->> 'moneda', '')), ''));
  if v_moneda is not null and length(v_moneda) <> 3 then v_moneda := null; end if;

  v_todo := coalesce((p_datos ->> 'todo')::boolean, false);

  -- ---------------------------------------------------------------
  -- Lo que está pendiente, de la más vieja a la más nueva
  -- ---------------------------------------------------------------
  if p_es_venta then
    select coalesce(jsonb_agg(x order by x ->> 'fecha', x ->> 'id'), '[]'::jsonb)
    into v_pendientes
    from (
      select jsonb_build_object(
        'id', v.id, 'fecha', v.fecha, 'total', v.total, 'moneda', v.moneda,
        'saldo', public.eos_erp_saldo_documento_v107(v.id, null)
      ) as x
      from public.eos_erp_ventas v
      where v.usuario_id = p_usuario_id
        and v.contacto_id = v_contacto_id
        and v.estado <> 'anulada'
        and public.eos_erp_saldo_documento_v107(v.id, null) > 0
    ) t;
  else
    select coalesce(jsonb_agg(x order by x ->> 'fecha', x ->> 'id'), '[]'::jsonb)
    into v_pendientes
    from (
      select jsonb_build_object(
        'id', c.id, 'fecha', c.fecha, 'total', c.total, 'moneda', c.moneda,
        'saldo', public.eos_erp_saldo_documento_v107(null, c.id)
      ) as x
      from public.eos_erp_compras c
      where c.usuario_id = p_usuario_id
        and c.contacto_id = v_contacto_id
        and c.estado <> 'anulada'
        and public.eos_erp_saldo_documento_v107(null, c.id) > 0
    ) t;
  end if;

  if jsonb_array_length(v_pendientes) = 0 then
    raise exception 'EOS_ACCION_COBRO_SIN_PENDIENTES: %', v_nombre;
  end if;

  /*
   * Nunca se suman monedas.
   *
   * Un cliente puede deber en guaraníes y en dólares. Sumar los dos saldos da
   * un número que no significa nada, y acá ese número decidiría cuánto se
   * cobra. Si no dijeron la moneda y hay más de una, se pregunta.
   */
  select array_agg(distinct d ->> 'moneda') into v_monedas
  from jsonb_array_elements(v_pendientes) d;

  if v_moneda is null then
    if array_length(v_monedas, 1) > 1 then
      raise exception 'EOS_ACCION_COBRO_VARIAS_MONEDAS: %', array_to_string(v_monedas, ', ');
    end if;
    v_moneda := v_monedas[1];
  end if;

  select coalesce(jsonb_agg(d order by d ->> 'fecha', d ->> 'id'), '[]'::jsonb)
  into v_pendientes
  from jsonb_array_elements(v_pendientes) d
  where d ->> 'moneda' = v_moneda;

  if jsonb_array_length(v_pendientes) = 0 then
    raise exception 'EOS_ACCION_COBRO_SIN_PENDIENTES: %', v_nombre;
  end if;

  v_cuantos := jsonb_array_length(v_pendientes);

  select sum((d ->> 'saldo')::numeric) into v_total_pendiente
  from jsonb_array_elements(v_pendientes) d;

  -- ---------------------------------------------------------------
  -- Cuánto se aplica
  -- ---------------------------------------------------------------
  if v_monto is null then
    if v_todo or v_cuantos = 1 then
      v_monto := v_total_pendiente;
    else
      /*
       * Con varias pendientes y sin monto NO se elige.
       *
       * "Me pagó la factura" de alguien que tiene tres es una frase
       * incompleta, y completarla por él deja escrito un ingreso que sí
       * ocurrió contra el documento que no era. Se devuelven las tres con su
       * fecha y su importe: contesta con una y listo.
       */
      select string_agg((d ->> 'fecha') || ':' || (d ->> 'saldo'), ';' order by d ->> 'fecha')
      into v_lista
      from jsonb_array_elements(v_pendientes) d;

      raise exception 'EOS_ACCION_COBRO_VARIOS_PENDIENTES: %|%', v_moneda, v_lista;
    end if;
  end if;

  /*
   * De más, nunca.
   *
   * Un monto mayor a lo que se debe es casi siempre un cero de más al
   * escribir. Dejarlo pasar produce un saldo a favor que no se parece a un
   * error: se parece a un anticipo, y nadie lo revisa.
   */
  if v_monto > v_total_pendiente then
    raise exception 'EOS_ACCION_COBRO_EXCEDE: %|%', v_moneda, v_total_pendiente;
  end if;

  -- ---------------------------------------------------------------
  -- La más vieja primero
  -- ---------------------------------------------------------------
  for v_doc in
    select
      (d ->> 'id')::uuid as id,
      (d ->> 'fecha')::date as fecha,
      (d ->> 'saldo')::numeric as saldo
    from jsonb_array_elements(v_pendientes) d
    order by d ->> 'fecha', d ->> 'id'
  loop
    exit when v_aplicado >= v_monto;

    v_este := least(v_doc.saldo, v_monto - v_aplicado);
    if v_este <= 0 then continue; end if;

    perform public.eos_erp_registrar_cobranza_v107(
      p_usuario_id,
      case when p_es_venta then v_doc.id else null end,
      case when p_es_venta then null else v_doc.id end,
      v_este,
      v_fecha,
      'Registrado por EOS desde la conversación.'
    );

    -- La marca de idempotencia, sobre el movimiento que se acaba de crear.
    update public.eos_erp_cuenta_movimientos_v107 m
    set action_command_id = p_command_id
    where m.usuario_id = p_usuario_id
      and m.action_command_id is null
      and ((p_es_venta and m.venta_id = v_doc.id) or (not p_es_venta and m.compra_id = v_doc.id))
      and m.monto = v_este
      and m.fecha = v_fecha;

    v_aplicado := v_aplicado + v_este;

    if v_primero is null then v_primero := v_doc.id; end if;

    v_tocados := v_tocados || jsonb_build_array(jsonb_build_object(
      'id', v_doc.id,
      'fecha', v_doc.fecha,
      'aplicado', v_este,
      'saldaba', v_este >= v_doc.saldo
    ));
  end loop;

  return jsonb_build_object(
    'id', v_primero,
    'es_venta', p_es_venta,
    'contacto', v_nombre,
    'moneda', v_moneda,
    'aplicado', v_aplicado,
    'documentos', v_tocados,
    'cerrados', (
      select count(*) from jsonb_array_elements(v_tocados) d where (d ->> 'saldaba')::boolean
    ),
    -- Lo que queda debiendo DESPUÉS de este cobro. Es el dato que la persona
    -- necesita en la misma frase: si cobró parcial, cuánto falta.
    'resta', v_total_pendiente - v_aplicado,
    'pendientes_antes', v_cuantos
  );
end;
$function$;

revoke all on function public.eos_erp_cobranza_por_chat_v151(uuid, uuid, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.eos_erp_cobranza_por_chat_v151(uuid, uuid, jsonb, boolean)
  to service_role;

comment on function public.eos_erp_cobranza_por_chat_v151(uuid, uuid, jsonb, boolean) is
  'v151: cobra una venta o paga una compra desde el chat, resolviendo el contacto por nombre. Imputa de la mas vieja a la mas nueva, nunca suma monedas distintas y nunca cobra mas de lo que se debe. Con varias pendientes y sin monto, pregunta.';
