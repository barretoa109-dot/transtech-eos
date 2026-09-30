-- v222: "pagué el mínimo de la Green" paga el resumen de la tarjeta.
--
-- ============================================================
-- QUÉ PASÓ (29/09/2026, chat real)
-- ============================================================
--
-- "Gasté 46.000 en Punto Farma con mi tarjeta Green, que por cierto ya pagué
-- el pago mínimo". El modelo mandó REGISTRAR_PAGO_DEUDA con acreedor "Green"
-- (es lo natural: pagar la tarjeta es pagar lo que se le debe) y la respuesta
-- fue "No tengo ninguna deuda con Green". La tarjeta existía, cargada con su
-- pago mínimo, pero el pago de un resumen no tenía dónde ir: el prompt
-- explica que lo que sale del bolsillo es el pago del resumen y no la compra,
-- y ninguna acción lo anotaba.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- En `eos_finanzas_pagar_deuda_v139`, justo donde fallaba por no encontrar la
-- deuda, se busca una TARJETA activa con ese nombre o ese emisor (igual y
-- después parecido, como las deudas). Si está:
--
--   · el monto es el que dijo; si no dijo, el pago mínimo del resumen; si
--     tampoco hay, se pregunta (EOS_ACCION_PAGO_SIN_MONTO), como las deudas;
--   · baja el saldo usado de la tarjeta (si se conocía);
--   · anota la salida de plata en el ámbito de la tarjeta, como gasto
--     "Pago de tarjeta — <nombre>".
--
-- Una deuda con ese nombre sigue ganando: esto solo corre donde antes había
-- un error. No hay acción nueva que dar de alta en ningún lado.
--
-- En su lugar, desde `pg_get_functiondef`, con dos anclas que tienen que
-- aparecer una sola vez. Idempotente.

do $v222$
declare
  v_oid oid;
  v_def text;
  v_nuevo text;
  v_ancla_error constant text := $a$raise exception 'EOS_ACCION_DEUDA_NO_ENCONTRADA: %', v_acreedor;$a$;
  v_veces integer;
begin
  v_oid := 'public.eos_finanzas_pagar_deuda_v139(uuid, uuid, jsonb)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);

  if position('v222: el resumen de una tarjeta' in v_def) > 0 then
    raise notice 'v222: el pago de deuda ya sabe pagar tarjetas; no se toca.';
    return;
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla_error, ''))) / length(v_ancla_error);
  if v_veces <> 1 then
    raise exception 'v222: el ancla del error aparece % veces, no 1. No se cambió nada.', v_veces;
  end if;

  -- La variable nueva, al final del declare.
  v_nuevo := regexp_replace(v_def, 'v_movimiento uuid;(\s*)begin', 'v_movimiento uuid;\1v_tarjeta public.eos_finanzas_tarjetas%rowtype;\1begin');
  if v_nuevo = v_def then
    raise exception 'v222: no encontré el final del declare; no se cambió nada.';
  end if;

  v_nuevo := replace(v_nuevo, v_ancla_error, $n$-- v222: el resumen de una tarjeta se paga igual que una cuota.
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
      v_monto := v_tarjeta.pago_minimo;
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

    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, ambito,
      action_command_id, metadata
    ) values (
      p_usuario_id, 'gasto', v_monto, coalesce(v_tarjeta.moneda, 'PYG'),
      'Pago de tarjeta — ' || v_tarjeta.nombre, 'tarjetas', v_fecha, 'chat', v_tarjeta.ambito,
      p_command_id,
      jsonb_build_object('fuente', 'worker_gate', 'tarjeta_id', v_tarjeta.id)
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
    );$n$);

  execute v_nuevo;
end;
$v222$;
