-- v227: un pago de tarjeta sin monto dicho no se anota; se pregunta.
--
-- ============================================================
-- QUÉ PASÓ (caso Green, 29/09/2026, y medido el 30/09)
-- ============================================================
--
-- "Gasté 46.000 en Punto Farma con mi tarjeta Green, que por cierto ya pagué
-- el mínimo, y gané 100.000." La persona contó que YA había pagado, sin decir
-- cuánto ni cuándo, y no pidió anotar un pago. Con la v222 viva, el modelo
-- manda REGISTRAR_PAGO_DEUDA sin monto y `eos_finanzas_pagar_deuda_v139` toma
-- el pago mínimo guardado (₲188.000): baja el saldo de la tarjeta y anota una
-- salida de plata que nadie dictó. Medido con el prompt de producción el
-- 30/09: 3 de 3 veces.
--
-- El dueño fijó el criterio: "ya pagué el mínimo" no crea un pago nuevo, y no
-- aparecen importes no sustentados. Un prompt ayuda (PR #213), pero no puede
-- ser la única barrera: esta es la de la base.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- En la rama de TARJETAS de `eos_finanzas_pagar_deuda_v139` (v222): si el
-- monto no vino en el pedido, ya no se usa el mínimo guardado. Se frena con
-- EOS_ACCION_PAGO_TARJETA_SIN_MONTO y el nombre y el mínimo de la tarjeta,
-- para que la respuesta pregunte "¿pagaste el mínimo de ₲188.000? Decime
-- cuánto y lo anoto". Con el monto dicho, todo sigue igual.
--
-- Las deudas que NO son tarjetas no cambian: "pagué la cuota de Ueno" usa la
-- cuota declarada, que es un monto fijo que la persona cargó para eso.
--
-- ============================================================
-- CÓMO SE APLICA
-- ============================================================
--
-- En su lugar, desde `pg_get_functiondef`, con una sola línea de ancla (la
-- función vive con CRLF en la base: un ancla de varias líneas no calzaría).
-- Si el ancla no está una sola vez, falla sin tocar nada. Si ya está la marca,
-- avisa y sale. Sin begin/commit: `db push` la envuelve.

do $v227$
declare
  v_oid oid;
  v_def text;
  v_ancla constant text := 'v_monto := v_tarjeta.pago_minimo;';
  v_veces integer;
begin
  v_oid := 'public.eos_finanzas_pagar_deuda_v139(uuid, uuid, jsonb)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);

  if position('EOS_ACCION_PAGO_TARJETA_SIN_MONTO' in v_def) > 0 then
    raise notice 'v227: el pago de tarjeta ya pide el monto; no se toca.';
    return;
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  if v_veces <> 1 then
    raise exception 'v227: el ancla aparece % veces, no 1. No se cambió nada.', v_veces;
  end if;

  execute replace(
    v_def,
    v_ancla,
    $n$-- v227: sin monto dicho no se paga el mínimo guardado: se pregunta.
      raise exception 'EOS_ACCION_PAGO_TARJETA_SIN_MONTO: % · %', v_tarjeta.nombre, coalesce(v_tarjeta.pago_minimo::text, '');$n$
  );

  raise notice 'v227: un pago de tarjeta sin monto ahora se pregunta.';
end;
$v227$;
