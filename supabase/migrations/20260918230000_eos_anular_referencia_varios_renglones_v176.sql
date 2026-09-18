-- "Anulá la compra de lechones y vitamina" no encontraba una compra que existe.
--
-- ============================================================
-- QUÉ PASÓ (medido en el chat real, 2026-09-18)
-- ============================================================
--
-- Se registró por chat una compra con dos renglones, "lechones" y "bolsas de
-- vitamina". Después se pidió anularla diciendo "la compra de lechones y
-- vitamina que hice recién", y el chat contestó:
--
--   No encontré ninguna compra tuya de los últimos siete días que coincida
--   con "lechones y vitamina".
--
-- La compra estaba, de hoy y sin anular. Lo que falla es el resolver:
-- `eos_erp_resolver_compra` (v170) y `eos_erp_resolver_venta` (v161) exigen
-- que TODAS las palabras de la referencia estén dentro de UN solo renglón
-- (`v_tokens <@ tokens(i.descripcion)` evaluado renglón por renglón). Una
-- persona nombra la compra por lo que contiene, y lo que contiene puede estar
-- repartido en varios renglones: nunca coincide con ninguno solo.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- Las palabras de la referencia se comparan contra la UNIÓN de las palabras
-- de todos los renglones del documento. Todo lo que coincidía antes (las
-- palabras dentro de un renglón) sigue coincidiendo: la unión contiene a cada
-- renglón. Lo único nuevo es que ahora también coinciden las que están
-- repartidas. No cambia nada más: ni el monto, ni el proveedor o cliente, ni
-- "la más reciente si hay varias", ni "no cae a la última si dijo algo que no
-- coincide".
--
-- ============================================================
-- CÓMO SE APLICA
-- ============================================================
--
-- Parchea las funciones EN SU LUGAR, leyendo `pg_get_functiondef`, y no las
-- regenera desde un archivo: otra sesión puede haber tocado la definición que
-- corre en producción (ver eos-base-adelantada). Si el texto esperado no está,
-- FALLA en vez de dejar algo a medias. Si el cambio ya está aplicado, avisa y
-- sale: una instalación desde cero corre v161/v170 y después esto.
--
-- El patrón se escribe con `\s+` entre tokens porque el texto guardado en la
-- base conserva los saltos de línea del archivo con que se aplicó (LF o CRLF).

do $v176$
declare
  v_oid oid;
  v_def text;
  v_nuevo text;
  v_marca constant text := 'v176: unión de renglones';
begin
  -- ---------------------------------------------------------------- compras
  v_oid := 'public.eos_erp_resolver_compra(uuid, text, integer)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);

  if position(v_marca in v_def) > 0 then
    raise notice 'v176: eos_erp_resolver_compra ya estaba parchada.';
  else
    v_nuevo := regexp_replace(
      v_def,
      'exists\s*\(\s*select\s+1\s+from\s+public\.eos_erp_compra_items\s+i\s+where\s+i\.compra_id\s*=\s*c\.id\s+and\s+v_tokens\s*<@\s*public\.eos_tokens\(coalesce\(i\.descripcion,\s*''''\),\s*true\)\s*\)',
      '/* v176: unión de renglones */ v_tokens <@ (
          select coalesce(array_agg(distinct t.palabra), ''{}''::text[])
          from public.eos_erp_compra_items i
          cross join lateral unnest(public.eos_tokens(coalesce(i.descripcion, ''''), true)) as t(palabra)
          where i.compra_id = c.id
        )'
    );

    if v_nuevo = v_def then
      raise exception 'v176: no encontré el bloque de renglones en eos_erp_resolver_compra; no se cambió nada.';
    end if;

    execute v_nuevo;
  end if;

  -- ----------------------------------------------------------------- ventas
  v_oid := 'public.eos_erp_resolver_venta(uuid, text, integer)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);

  if position(v_marca in v_def) > 0 then
    raise notice 'v176: eos_erp_resolver_venta ya estaba parchada.';
  else
    v_nuevo := regexp_replace(
      v_def,
      'exists\s*\(\s*select\s+1\s+from\s+public\.eos_erp_venta_items\s+i\s+where\s+i\.venta_id\s*=\s*v\.id\s+and\s+v_tokens\s*<@\s*public\.eos_tokens\(coalesce\(i\.descripcion,\s*''''\),\s*true\)\s*\)',
      '/* v176: unión de renglones */ v_tokens <@ (
          select coalesce(array_agg(distinct t.palabra), ''{}''::text[])
          from public.eos_erp_venta_items i
          cross join lateral unnest(public.eos_tokens(coalesce(i.descripcion, ''''), true)) as t(palabra)
          where i.venta_id = v.id
        )'
    );

    if v_nuevo = v_def then
      raise exception 'v176: no encontré el bloque de renglones en eos_erp_resolver_venta; no se cambió nada.';
    end if;

    execute v_nuevo;
  end if;
end;
$v176$;
