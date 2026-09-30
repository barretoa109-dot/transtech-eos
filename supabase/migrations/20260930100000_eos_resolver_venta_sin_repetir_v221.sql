-- v221: el parche del resolver de ventas quedó aplicado dos veces.
--
-- La migración "producto y cliente juntos" se renumeró en paralelo desde dos
-- sesiones (20260929192000_..._v218 y 20260929211000_..._v220). Cada una
-- buscaba su propia marca, así que la segunda no reconoció a la primera y
-- agregó la misma condición otra vez. El resultado es el mismo —un OR de dos
-- condiciones idénticas— pero es código repetido en una función que otras
-- sesiones parchean por ancla.
--
-- Se saca la copia marcada v220. El archivo v220 ahora reconoce cualquiera de
-- las dos marcas, así que una instalación desde cero no la vuelve a agregar.
--
-- En su lugar, desde `pg_get_functiondef`. Idempotente: sin la copia, avisa y
-- sale. El patrón es de mínima (`.*?` primero): en Postgres la voracidad de
-- toda la expresión la decide su primer cuantificador, y uno voraz se comería
-- también la cláusula v218 que viene después.

do $v221$
declare
  v_oid oid;
  v_def text;
  v_nuevo text;
begin
  v_oid := 'public.eos_erp_resolver_venta(uuid, text, integer)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);

  if position('v220: producto y cliente juntos' in v_def) = 0 then
    raise notice 'v221: no hay copia v220 en eos_erp_resolver_venta; no se toca.';
    return;
  end if;

  v_nuevo := regexp_replace(
    v_def,
    'or /\* v220: producto y cliente juntos \*/ v_tokens <@ \(.*?\) as t\s*?\)',
    ''
  );

  if v_nuevo = v_def
     or (length(v_nuevo) - length(replace(v_nuevo, 'producto y cliente juntos', ''))) / length('producto y cliente juntos') <> 1 then
    raise exception 'v221: no quedó exactamente una condición "producto y cliente juntos"; no se cambió nada.';
  end if;

  execute v_nuevo;
end;
$v221$;
