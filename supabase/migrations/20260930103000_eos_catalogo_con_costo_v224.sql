-- v224: el catálogo que ve el modelo trae el COSTO de cada producto, no solo
-- si lo tiene.
--
-- ============================================================
-- QUÉ PASÓ (16/09/2026, cuenta real)
-- ============================================================
--
-- "Desglosame cada cosa para ver si hiciste bien". EOS armó el desglose, le
-- faltaron dos prendas, y sobre una de ellas dijo: "del Cjto Celeste jeans
-- tengo la venta a ₲140.000, pero no tengo a mano su costo exacto". La
-- clienta: "ya sabés el costo y a cuánto vendo".
--
-- Tenía razón a medias: el costo estaba cargado, pero `eos_contexto_negocio`
-- mandaba `sin_costo: false` —que hay costo— y no cuánto. El modelo sabía que
-- existía un número que no podía ver. Márgenes, "¿a cuánto debería vender?",
-- "¿cuánto gano con esto?": todo eso necesita el costo y tenía que pedirlo.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- Cada producto del catálogo lleva `costo` (o null). `sin_costo` queda igual,
-- para no cambiar nada de lo que ya lo lee. Medido con una cuenta real de 40
-- productos: el texto del contexto pasa de ~2.400 a ~3.200 caracteres, lejos
-- del tope de 6.000.
--
-- En su lugar, desde `pg_get_functiondef`, con un ancla que aparece una sola
-- vez: la función tiene cientos de líneas y otras sesiones la parchean.
-- Idempotente.

do $v224$
declare
  v_oid oid;
  v_def text;
  v_ancla constant text := $a$'sin_costo', t.costo is null,$a$;
  v_veces integer;
begin
  v_oid := 'public.eos_contexto_negocio(uuid)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);

  if position($m$'costo', t.costo,$m$ in v_def) > 0 then
    raise notice 'v224: el catálogo ya trae el costo; no se toca.';
    return;
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  if v_veces <> 1 then
    raise exception 'v224: el ancla aparece % veces, no 1. No se cambió nada.', v_veces;
  end if;

  execute replace(v_def, v_ancla, v_ancla || $n$
              -- v224: cuánto, no solo si hay. Sin el número, EOS decía "no
              -- tengo a mano su costo" de un costo cargado.
              'costo', t.costo,$n$);
end;
$v224$;
