-- Crear productos por chat: un producto sin precio ya no tumba a los demás.
--
-- ============================================================
-- QUÉ PASABA
-- ============================================================
--
-- `eos_erp_crear_productos_v131` recorre la lista y, ante el primer producto sin
-- precio de venta, hace `raise exception 'EOS_ACCION_PRODUCTO_SIN_PRECIO'`. La
-- excepción revierte la tanda ENTERA: si la persona dicta seis productos y a uno
-- le falta el precio, no se carga ninguno. Y sin una salida limpia, el modelo cae
-- en GUARDAR_MEMORIA, que nunca falla y suena a hecho: el catálogo queda vacío y
-- la persona cree que EOS le borró los datos (2026-09-18).
--
-- El precio sigue siendo obligatorio, y con razón: un producto sin precio hace que
-- la primera venta se registre en cero y ensucia el margen del mes. Lo que cambia
-- es qué pasa con el resto de la lista.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
--   * Un producto NUEVO sin precio se saltea, se anota en `sin_precio` y el resto
--     de la lista se carga. El resultado trae `sin_precio: [nombres]` para que la
--     respuesta le pida a la persona, por nombre, lo que falta.
--   * Si NO se pudo cargar nada por falta de precio, sigue fallando con
--     EOS_ACCION_PRODUCTO_SIN_PRECIO, igual que antes: el mensaje de error que ya
--     conoce la aplicación ("Me falta a cuánto vendés X") no cambia.
--   * Un producto que YA existe se trata como antes, con o sin precio: no se toca.
--
-- ============================================================
-- CÓMO SE APLICA
-- ============================================================
--
-- Parchea la función EN SU LUGAR leyendo `pg_get_functiondef`, no la regenera
-- desde un archivo (ver eos-base-adelantada). Cada reemplazo exige encontrar su
-- texto; si alguno falta, FALLA sin dejar nada a medias. Idempotente: si la marca
-- `v181` ya está, avisa y sale. Los patrones usan `\s+` porque la base conserva
-- los saltos de línea (LF o CRLF) del archivo con que se aplicó.

do $v181$
declare
  v_def text;
  v_nuevo text;
  v_marca constant text := 'v181: producto sin precio';
begin
  v_def := pg_get_functiondef('public.eos_erp_crear_productos_v131(uuid, uuid, jsonb)'::regprocedure);

  if position(v_marca in v_def) > 0 then
    raise notice 'v181: eos_erp_crear_productos_v131 ya estaba parchada.';
    return;
  end if;

  v_nuevo := v_def;

  -- 1) La variable donde se juntan los que quedan sin cargar.
  v_nuevo := regexp_replace(
    v_nuevo,
    '(v_costos\s+jsonb\s*:=\s*''\[\]''::jsonb;)',
    E'\\1\n  v_sin_precio jsonb := ''[]''::jsonb;'
  );

  if v_nuevo = v_def then
    raise exception 'v181: no encontré la declaración de v_costos; no se cambió nada.';
  end if;

  -- 2) Sin precio: se anota y se sigue con el próximo, en vez de abortar.
  v_def := v_nuevo;
  v_nuevo := regexp_replace(
    v_nuevo,
    'if\s+v_precio\s+is\s+null\s+or\s+v_precio\s*<=\s*0\s+then\s+raise\s+exception\s+''EOS_ACCION_PRODUCTO_SIN_PRECIO:\s*%'',\s*v_nombre;\s+end\s+if;',
    'if v_precio is null or v_precio <= 0 then
      /* v181: producto sin precio se saltea; el resto de la lista se carga */
      v_sin_precio := v_sin_precio || to_jsonb(v_nombre);
      continue;
    end if;'
  );

  if v_nuevo = v_def then
    raise exception 'v181: no encontré el raise de SIN_PRECIO; no se cambió nada.';
  end if;

  -- 3) Si no se cargó NADA por falta de precio, falla como siempre.
  v_def := v_nuevo;
  v_nuevo := regexp_replace(
    v_nuevo,
    'if\s+v_primero\s+is\s+null\s+then\s+raise\s+exception\s+''EOS_ACCION_PRODUCTO_SIN_DATOS'';\s+end\s+if;',
    'if v_primero is null then
    if jsonb_array_length(v_sin_precio) > 0 then
      raise exception ''EOS_ACCION_PRODUCTO_SIN_PRECIO: %'', v_sin_precio ->> 0;
    end if;
    raise exception ''EOS_ACCION_PRODUCTO_SIN_DATOS'';
  end if;'
  );

  if v_nuevo = v_def then
    raise exception 'v181: no encontré el cierre de la función; no se cambió nada.';
  end if;

  -- 4) El resultado cuenta qué quedó sin cargar.
  v_def := v_nuevo;
  v_nuevo := regexp_replace(
    v_nuevo,
    '''costos_puestos'',\s*v_costos\s*\)',
    '''costos_puestos'', v_costos,
    ''sin_precio'', v_sin_precio
  )'
  );

  if v_nuevo = v_def then
    raise exception 'v181: no encontré el retorno de la función; no se cambió nada.';
  end if;

  execute v_nuevo;
end;
$v181$;
