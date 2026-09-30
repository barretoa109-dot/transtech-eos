-- v223: "146473.876" son ciento cuarenta y seis mil, no ciento cuarenta y seis millones.
--
-- ============================================================
-- QUÉ PASÓ (visto el 28/09/2026, cuenta real)
-- ============================================================
--
-- Una clienta vio "-5712 % de rentabilidad" y ₲-237.667.895 de pérdida. Eran
-- dos productos con el costo mil veces más alto: ₲146.473.876 donde era
-- ₲146.474, y ₲116.382.076 donde era ₲116.382. El costo venía de pasar
-- dólares a guaraníes, con decimales ("USD 24,46 × 5.988,99 = ₲146.473,876").
--
-- `eos_leer_monto` (v150) decide por el ÚLTIMO separador: con tres dígitos
-- atrás, es de miles. Pero cuando el modelo manda el costo como NÚMERO de
-- JSON —lo normal—, `->>` lo entrega como "146473.876": un punto decimal con
-- tres decimales, que la regla lee como miles. Medido contra la función viva:
--
--     "146473.876"    -> 146473876     (debía ser 146473.876)
--     "146.473,876"   -> 146473876     (debía ser 146473.876)
--     "113.970,4797"  -> 1139704797    (debía ser 113970.4797)
--     "2,5 millones"  -> 2.5           (debía ser 2500000)
--     "320 mil"       -> 320           (debía ser 320000)
--
-- ============================================================
-- LA REGLA NUEVA
-- ============================================================
--
--   · Con punto Y coma, el último de los dos es el decimal y el otro es de
--     miles ("1.234,56", "146,473.876").
--   · Con una sola clase de separador repetida, es de miles ("1.500.000").
--   · Con UN solo separador: si atrás no quedan tres dígitos, es decimal
--     ("5,5", "300.50"). Si quedan tres, es de miles SOLO si adelante hay de
--     uno a tres dígitos ("185.000", "1,500"); con más adelante no puede ser
--     un grupo de miles, es decimal ("146473.876").
--   · "mil", "millón"/"millones" y "palo(s)" multiplican.
--
-- Todo lo que la v150 leía bien se sigue leyendo igual: lo prueban las
-- aserciones de abajo, que corren al aplicar y abortan si algo da distinto.
--
-- Solo esta migración define la función además de la v150 (verificado en el
-- repositorio y en producción el 30/09), así que se reemplaza entera.

create or replace function public.eos_leer_monto(p_texto text)
returns numeric
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_texto text;
  v_limpio text;
  v_signo integer := 1;
  v_mult numeric := 1;
  v_puntos integer;
  v_comas integer;
  v_ultimo integer;
  v_sep text;
  v_antes text;
  v_atras text;
  v_numero numeric;
begin
  if p_texto is null then
    return null;
  end if;

  v_texto := lower(btrim(p_texto));

  if v_texto like '-%' then
    v_signo := -1;
  end if;

  -- v223: las palabras que multiplican. "millones" antes que "mil".
  if v_texto ~ '(mill[oó]n|millones|\ypalos?\y)' then
    v_mult := 1000000;
  elsif v_texto ~ '[0-9]\s*mil\y' then
    v_mult := 1000;
  end if;

  v_limpio := regexp_replace(v_texto, '[^0-9.,]', '', 'g');
  v_limpio := regexp_replace(v_limpio, '^[.,]+|[.,]+$', '', 'g');

  if v_limpio = '' or v_limpio !~ '[0-9]' then
    return null;
  end if;

  v_puntos := length(v_limpio) - length(replace(v_limpio, '.', ''));
  v_comas := length(v_limpio) - length(replace(v_limpio, ',', ''));

  if v_puntos + v_comas = 0 then
    v_numero := v_limpio::numeric;

  elsif v_puntos > 0 and v_comas > 0 then
    -- Las dos clases: el último separador es el decimal.
    -- Hay de las dos, así que las dos posiciones (desde el final) son > 0.
    v_ultimo := length(v_limpio) + 1
                - least(position('.' in reverse(v_limpio)), position(',' in reverse(v_limpio)));
    v_numero := (regexp_replace(left(v_limpio, v_ultimo - 1), '[.,]', '', 'g')
                 || '.' || substr(v_limpio, v_ultimo + 1))::numeric;

  else
    v_sep := case when v_puntos > 0 then '.' else ',' end;

    if greatest(v_puntos, v_comas) > 1 then
      -- La misma clase repetida: son de miles.
      v_numero := replace(v_limpio, v_sep, '')::numeric;
    else
      v_antes := split_part(v_limpio, v_sep, 1);
      v_atras := split_part(v_limpio, v_sep, 2);

      if length(v_atras) = 3 and length(v_antes) between 1 and 3 then
        v_numero := (v_antes || v_atras)::numeric;
      else
        v_numero := (coalesce(nullif(v_antes, ''), '0') || '.' || v_atras)::numeric;
      end if;
    end if;
  end if;

  return v_signo * v_numero * v_mult;
end;
$function$;

comment on function public.eos_leer_monto(text) is
  'v223: lee un monto escrito por una persona o mandado como numero JSON. Con punto y coma, el ultimo es decimal; un solo separador con tres digitos atras es de miles solo si adelante hay de 1 a 3 digitos. mil/millon/palo multiplican. Conserva el signo.';

grant execute on function public.eos_leer_monto(text) to service_role;

-- Las aserciones: lo que la v150 ya leía bien y lo que ahora se corrige.
do $v223$
declare
  v_caso record;
  v_leido numeric;
begin
  for v_caso in
    select * from (values
      -- lo de siempre (v150)
      ('800.000', 800000::numeric), ('3.000.000', 3000000), ('1.234,56', 1234.56), ('300.50', 300.5),
      ('1,5', 1.5), ('185000', 185000), ('185.000', 185000), ('5.988,99', 5988.99), ('1.500.000', 1500000),
      ('-800000', -800000), ('₲ 350.000', 350000), ('Gs. 1.200.000', 1200000), ('1,500', 1500), ('0.5', 0.5),
      -- lo que se corrige (v223)
      ('146473.876', 146473.876), ('146.473,876', 146473.876), ('146473,876', 146473.876),
      ('113.970,4797', 113970.4797), ('146,473.876', 146473.876), ('2,5 millones', 2500000),
      ('320 mil', 320000), ('1 millón', 1000000), ('3 palos', 3000000), ('74404.2', 74404.2)
    ) as t(entrada, esperado)
  loop
    v_leido := public.eos_leer_monto(v_caso.entrada);
    if v_leido is distinct from v_caso.esperado then
      raise exception 'v223: eos_leer_monto(%) dio %, se esperaba %. No se aplicó nada.',
        v_caso.entrada, v_leido, v_caso.esperado;
    end if;
  end loop;

  if public.eos_leer_monto(null) is not null or public.eos_leer_monto('') is not null or public.eos_leer_monto('sin monto') is not null then
    raise exception 'v223: un texto sin números tiene que dar null.';
  end if;
end;
$v223$;
