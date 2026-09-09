-- El monto se lee en UN solo lugar, y sabe qué es un punto de miles.
--
-- ============================================================
-- ENCONTRADO PROBANDO OTRA COSA, EL 9 DE SEPTIEMBRE DE 2026
-- ============================================================
--
-- Once funciones vivas leen los montos que manda el chat con exactamente el
-- mismo texto:
--
--     nullif(regexp_replace(coalesce(p_datos ->> 'monto', ''),
--            '[^0-9.]', '', 'g'), '')::numeric
--
-- Esa expresión deja pasar el punto. En Paraguay el punto es el separador de
-- MILES, así que:
--
--     "800.000"    ->  Postgres lee 800.000 = OCHOCIENTOS
--     "3.000.000"  ->  error de sintaxis, la acción muere
--
-- El primero es el grave: no falla. Entra un gasto de ochocientos guaraníes
-- donde la persona dijo ochocientos mil, la confirmación dice "listo", y el
-- panel del mes queda mil veces por debajo sin una sola señal.
--
-- ============================================================
-- POR QUÉ NUNCA SE VIO, Y POR QUÉ IGUAL HAY QUE ARREGLARLO
-- ============================================================
--
-- Se revisaron los comandos reales de producción: en todos, el modelo mandó
-- el monto como NÚMERO de JSON, no como texto. Con un número, `->> 'monto'`
-- devuelve "800000" sin separadores y la expresión acierta. Por eso el
-- defecto nunca se disparó.
--
-- Pero está a un cambio de modelo o a un ajuste de prompt de dispararse, y
-- cuando lo haga no va a haber ningún error que lo delate. Un sistema cuyo
-- peor fallo es silencioso y de tres órdenes de magnitud no se deja apoyado
-- en que el proveedor siga eligiendo el mismo tipo de dato.
--
-- ============================================================
-- LA REGLA, SIN NECESIDAD DE SABER LA MONEDA
-- ============================================================
--
-- El último separador decide. Si atrás le quedan exactamente tres dígitos es
-- de miles; si le quedan uno o dos, es decimal.
--
--     800.000    -> 800000      (tres atrás: miles)
--     3.000.000  -> 3000000     (el último tiene tres atrás: todos de miles)
--     1.234,56   -> 1234.56     (dos atrás: la coma es decimal)
--     300.50     -> 300.5       (dos atrás: punto decimal, dólares)
--     1,5        -> 1.5
--
-- No hace falta preguntar la moneda: nadie escribe "1.500" para decir uno y
-- medio, y en guaraníes no hay decimales que perder. Es la misma regla que
-- ya usa `aNumero` en `lib/finanzas/extraerDeCorreo.ts` para los correos del
-- banco, ahora también del lado de la base.
--
-- ============================================================
-- EL SIGNO SE CONSERVA, Y ESO ARREGLA OTRA COSA
-- ============================================================
--
-- La expresión vieja borraba el menos junto con todo lo demás, así que un
-- "-800000" entraba como 800000 y los guardas que dicen `if v_monto <= 0
-- then raise` nunca podían dispararse: no había forma de que un monto
-- llegara negativo. Estaban escritos y no protegían nada.

create or replace function public.eos_leer_monto(p_texto text)
returns numeric
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_limpio text;
  v_signo integer := 1;
  v_punto integer;
  v_coma integer;
  v_corte integer;
  v_atras integer;
begin
  if p_texto is null then
    return null;
  end if;

  if btrim(p_texto) like '-%' then
    v_signo := -1;
  end if;

  v_limpio := regexp_replace(p_texto, '[^0-9.,]', '', 'g');

  if v_limpio = '' or v_limpio !~ '[0-9]' then
    return null;
  end if;

  -- Dónde está el último separador de cada clase, contando desde el final.
  -- `position` devuelve 0 cuando no hay, y ese caso vale -1: sin él, el
  -- separador AUSENTE ganaría el `greatest` por ser el índice más grande.
  v_punto := position('.' in reverse(v_limpio));
  v_coma := position(',' in reverse(v_limpio));

  v_corte := greatest(
    case when v_punto = 0 then -1 else length(v_limpio) - v_punto end,
    case when v_coma = 0 then -1 else length(v_limpio) - v_coma end
  );

  if v_corte < 0 then
    return v_signo * v_limpio::numeric;
  end if;

  v_atras := length(v_limpio) - v_corte - 1;

  if v_atras = 1 or v_atras = 2 then
    return v_signo * (
      regexp_replace(left(v_limpio, v_corte), '[.,]', '', 'g')
      || '.' || right(v_limpio, v_atras)
    )::numeric;
  end if;

  -- Tres dígitos atrás, o una forma que no reconocemos: todos los
  -- separadores son de miles. Es el caso paraguayo y el más común.
  return v_signo * regexp_replace(v_limpio, '[.,]', '', 'g')::numeric;
end;
$function$;

comment on function public.eos_leer_monto(text) is
  'v150: lee un monto escrito por una persona. El ultimo separador con tres digitos atras es de miles; con uno o dos, decimal. Punto de miles paraguayo incluido. Conserva el signo.';

grant execute on function public.eos_leer_monto(text) to service_role;

-- ============================================================
-- Y ahora, las once funciones que ya estaban leyendo mal
-- ============================================================
--
-- Se reescriben EN SU LUGAR desde `pg_get_functiondef`, no se transcriben:
-- entre las once hay funciones de 300 líneas y copiarlas para cambiar una
-- expresión es cómo se pierde una rama sin que nadie lo note.
--
-- El reemplazo está anclado a la expresión completa, con el `[^0-9.]`
-- adentro. Es lo que la distingue de su hermana `[^0-9]` —sin punto— que
-- lee días del mes y cantidades de cuotas y tiene que quedar como está.

do $$
declare
  v_fn record;
  v_def text;
  v_nuevo text;
  v_tocadas integer := 0;
  v_quedan integer;
  v_esperadas integer;
  v_puestas integer;
begin
  for v_fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      -- Solo funciones normales: pg_get_functiondef no sabe describir un
      -- agregado como array_agg y levanta un error si se le pide.
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%''[^0-9.]'', '''', ''g''%'
    order by p.proname
  loop
    v_def := pg_get_functiondef(v_fn.oid);

    /*
     * `[^;]*?` y no `.*?`, y es la diferencia entre reescribir la expresión y
     * borrar tres sentencias.
     *
     * El punto cruza los saltos de línea. La hermana de enteros comparte la
     * cabecera exacta —`nullif(regexp_replace(coalesce(`— y solo se
     * distingue por el cierre, así que un `.*?` que arranca en el coalesce de
     * `cuota_dia` sigue de largo por encima de su propio `'[^0-9]'` y engancha
     * el cierre de `tasa_anual` tres sentencias más abajo, llevándose puestas
     * las del medio.
     *
     * Ninguna de estas expresiones contiene un punto y coma: cada una es una
     * sentencia entera. Prohibirlo dentro del grupo es lo que impide que el
     * reemplazo salte de una a otra.
     */
    v_nuevo := regexp_replace(
      v_def,
      'nullif\(regexp_replace\(coalesce\(([^;]*?)\), ''\[\^0-9\.\]'', '''', ''g''\), ''''\)::numeric',
      'public.eos_leer_monto(coalesce(\1))',
      'g'
    );

    -- Y la comprobación de que se reemplazaron TODAS y solo esas: tantas
    -- llamadas nuevas como cierres de monto tenía la definición vieja.
    v_esperadas := array_length(string_to_array(v_def, '''[^0-9.]'''), 1) - 1;
    v_puestas := array_length(string_to_array(v_nuevo, 'public.eos_leer_monto('), 1) - 1;

    if v_puestas <> v_esperadas then
      raise exception '%(): tenía % expresiones de monto y quedaron % llamadas.',
        v_fn.proname, v_esperadas, v_puestas;
    end if;

    if v_nuevo = v_def then
      raise exception 'La expresión de monto de %() no coincidió con el patrón. No se cambió nada.', v_fn.proname;
    end if;

    -- Si una sola no se deja reescribir, la migración entera se cae y dice
    -- CUÁL y CON QUÉ TEXTO. Sin eso, "mismatched parentheses" sobre once
    -- funciones de trescientas líneas no se diagnostica.
    begin
      execute v_nuevo;
    exception when others then
      raise exception 'No se pudo reescribir %(): % | fragmento: %',
        v_fn.proname,
        sqlerrm,
        substr(v_nuevo, greatest(1, position('eos_leer_monto' in v_nuevo) - 120), 320);
    end;

    v_tocadas := v_tocadas + 1;
  end loop;

  if v_tocadas = 0 then
    raise exception 'No se encontró ninguna función con la expresión vieja. Esperaba al menos una.';
  end if;

  -- Que no haya quedado ninguna a medias.
  select count(*) into v_quedan
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%''[^0-9.]'', '''', ''g''%';

  if v_quedan > 0 then
    raise exception 'Quedaron % funciones con la expresión vieja.', v_quedan;
  end if;

  raise notice 'eos_leer_monto: % funciones ahora leen el monto en un solo lugar.', v_tocadas;
end;
$$;
