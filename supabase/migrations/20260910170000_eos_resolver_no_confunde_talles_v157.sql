-- Que el talle M no resuelva al talle S (v157).
--
-- ============================================================
-- LO ENCONTRÓ LA VERIFICACIÓN, NO UN USUARIO
-- ============================================================
--
-- La v156 hizo que "conjunto verde oliva talle S" encontrara el producto,
-- ignorando las palabras que describen la variante. Probándola contra el
-- catálogo real apareció el precio de esa decisión:
--
--   catálogo:  "Conjunto verde oliva de Zivah talle S"
--              "Conjunto verde oliva M"
--
--   consulta:  "Conjunto verde oliva de Zivah talle M"
--   resultado: el talle S.
--
-- La letra del talle tiene una o dos letras, así que el tokenizador la
-- descarta por corta —igual que "de" o "la"— y lo único que quedaba para
-- comparar era "conjunto verde oliva zivah talle", que sólo está en el
-- producto equivocado.
--
-- Vender el talle M descontando el stock del S es exactamente el error que
-- toda la cadena de resolución existe para no cometer: stock equivocado,
-- precio equivocado, y ninguna señal de que pasó.
--
-- ============================================================
-- LA REGLA
-- ============================================================
--
-- El talle no se usa para BUSCAR —eso es lo que arregló la v156— pero sí para
-- DESCARTAR:
--
--   si la consulta dice un talle Y el producto dice otro, ese producto no es.
--
-- Las dos condiciones son necesarias. Si la consulta no menciona talle, no
-- hay nada que descartar. Si el producto no lo tiene en el nombre, tampoco:
-- puede ser el único que existe y estar catalogado sin la letra.
--
-- Con eso, además, "el verde oliva S" —que antes daba dos candidatos y no
-- resolvía nada— ahora resuelve solo.

-- ============================================================
-- 1) Qué talle dice un texto
-- ============================================================
--
-- Dos formas de decirlo, y las dos se leen:
--
--   · después de la palabra que lo nombra: "talle S", "talla 38", "tamaño XL"
--   · o al final, que es como se escriben los nombres del catálogo:
--     "Conjunto verde oliva M", "Cnjto volados rosa P"
--
-- Las letras son las que se usan acá: XS a XXXL, y P/M/G, que es la
-- nomenclatura de la ropa en Paraguay y Brasil. Un número suelto al final NO
-- cuenta como talle —"Cjto rojo t2" no es un talle 2— porque los códigos
-- internos terminan en número más seguido que los talles.

create or replace function public.eos_talle(p_texto text)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_palabras text[];
  v_n int;
  i int;
  v_ultima text;
begin
  v_palabras := regexp_split_to_array(public.eos_normalizar(p_texto), ' ');
  v_n := coalesce(cardinality(v_palabras), 0);

  if v_n = 0 then
    return '';
  end if;

  -- Nombrado: "talle S", "talla 38". Gana sobre la letra del final, porque es
  -- explícito.
  for i in 1..v_n - 1 loop
    if v_palabras[i] in ('talle', 'talla', 'tamano', 'medida') then
      return v_palabras[i + 1];
    end if;
  end loop;

  -- O la letra del final, que es como se nombran los productos del catálogo.
  v_ultima := v_palabras[v_n];

  if v_ultima in ('xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', 'p', 'g', 'gg') then
    return v_ultima;
  end if;

  return '';
end;
$function$;

revoke all on function public.eos_talle(text) from public, anon;

/**
 * ¿Este producto puede ser el que se está pidiendo, mirando el talle?
 *
 * Sí cuando alguno de los dos no lo menciona. No cuando los dos lo mencionan y
 * son distintos.
 */
create or replace function public.eos_talle_compatible(p_consulta text, p_nombre text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select
    public.eos_talle(p_consulta) = ''
    or public.eos_talle(p_nombre) = ''
    or public.eos_talle(p_consulta) = public.eos_talle(p_nombre);
$function$;

revoke all on function public.eos_talle_compatible(text, text) from public, anon;

-- ============================================================
-- 2) El resolver, con el talle como filtro
-- ============================================================
--
-- Se repite entera desde la v156 con una condición más en las capas 3 a 6.
--
-- Las capas 1 y 2 —nombre exacto y código— NO la llevan a propósito: si
-- alguien escribió el nombre completo tal cual está guardado, ya dijo cuál es,
-- y un filtro encima sólo podría contradecirlo.

create or replace function public.eos_erp_resolver_producto_detalle(
  p_usuario_id uuid,
  p_texto text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_norm text := public.eos_normalizar(p_texto);
  v_id uuid;
  v_cuantos int;
  v_tokens text[];
  v_nucleo text[];
  v_mejor numeric := 0;
  v_segundo numeric := 0;
  v_mejor_id uuid;
begin
  if v_norm = '' then
    return jsonb_build_object('producto_id', null, 'candidatos', 0, 'capa', 'vacio');
  end if;

  -- Capa 1: el nombre exacto, ya normalizado. Gana sin discusión.
  select count(*), (array_agg(p.id))[1]
    into v_cuantos, v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and public.eos_normalizar(p.nombre) = v_norm;

  if v_cuantos = 1 then
    return jsonb_build_object('producto_id', v_id, 'candidatos', 1, 'capa', 'nombre');
  end if;

  if v_cuantos > 1 then
    return jsonb_build_object('producto_id', null, 'candidatos', v_cuantos, 'capa', 'nombre');
  end if;

  -- Capa 2: por código, que es como los nombra quien tiene muchos.
  select count(*), (array_agg(p.id))[1]
    into v_cuantos, v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and coalesce(p.codigo, '') <> ''
    and public.eos_normalizar(p.codigo) = v_norm;

  if v_cuantos = 1 then
    return jsonb_build_object('producto_id', v_id, 'candidatos', 1, 'capa', 'codigo');
  end if;

  -- Capa 3: la frase entera contenida en el nombre.
  select count(*), (array_agg(p.id))[1]
    into v_cuantos, v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and public.eos_talle_compatible(p_texto, p.nombre)
    and public.eos_normalizar(p.nombre) like '%' || v_norm || '%';

  if v_cuantos = 1 then
    return jsonb_build_object('producto_id', v_id, 'candidatos', 1, 'capa', 'frase');
  end if;

  if v_cuantos > 1 then
    -- Varios con la frase entera: eso ya es ambiguo de verdad, y seguir
    -- buscando por palabras sólo agregaría más.
    return jsonb_build_object('producto_id', null, 'candidatos', v_cuantos, 'capa', 'frase');
  end if;

  -- Capa 4: todas las palabras, en singular, cada una igual a una del nombre.
  v_tokens := public.eos_tokens(p_texto, false);

  if cardinality(v_tokens) > 0 then
    select count(*), (array_agg(p.id))[1]
      into v_cuantos, v_id
    from public.eos_erp_productos p
    where p.usuario_id = p_usuario_id
      and p.activo
      and public.eos_talle_compatible(p_texto, p.nombre)
      and v_tokens <@ public.eos_tokens(p.nombre, false);

    if v_cuantos = 1 then
      return jsonb_build_object('producto_id', v_id, 'candidatos', 1, 'capa', 'palabras');
    end if;

    if v_cuantos > 1 then
      return jsonb_build_object('producto_id', null, 'candidatos', v_cuantos, 'capa', 'palabras');
    end if;
  end if;

  -- Capa 5: lo mismo, sin lo que describe una variante. ACÁ entra el talle.
  v_nucleo := public.eos_tokens(p_texto, true);

  if cardinality(v_nucleo) = 0 then
    return jsonb_build_object('producto_id', null, 'candidatos', 0, 'capa', 'sin_palabras');
  end if;

  select count(*), (array_agg(p.id))[1]
    into v_cuantos, v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and public.eos_talle_compatible(p_texto, p.nombre)
    and v_nucleo <@ public.eos_tokens(p.nombre, true);

  if v_cuantos = 1 then
    return jsonb_build_object('producto_id', v_id, 'candidatos', 1, 'capa', 'nucleo');
  end if;

  if v_cuantos > 1 then
    return jsonb_build_object('producto_id', null, 'candidatos', v_cuantos, 'capa', 'nucleo');
  end if;

  /*
   * Capa 6: por puntaje, y con la puerta bien angosta.
   *
   * Es para cuando la persona agrega una palabra que el catálogo no tiene:
   * dice "conjunto verde oliva de Zivah talle M" y el producto se llama
   * "Conjunto verde oliva M". Sin esto hay que escribir el nombre tal cual
   * está guardado, que es lo que este producto existe para no pedir.
   *
   * Tres condiciones juntas, y las tres hacen falta:
   *
   *   · al menos DOS palabras en común — con una sola, "conjunto" elegiría
   *     cualquier conjunto del catálogo;
   *   · 60% o más de lo que dijo la persona;
   *   · y el segundo mejor 20 puntos por debajo. Si dos productos empatan,
   *     no hay respuesta correcta: hay que preguntar.
   */
  with puntajes as (
    select
      p.id,
      (
        select count(*)::numeric
        from unnest(v_nucleo) as t
        where t = any (public.eos_tokens(p.nombre, true))
      ) as comunes
    from public.eos_erp_productos p
    where p.usuario_id = p_usuario_id
      and p.activo
      and public.eos_talle_compatible(p_texto, p.nombre)
  ),
  ordenados as (
    select id, comunes, comunes / cardinality(v_nucleo) as puntaje
    from puntajes
    where comunes >= 2
    order by comunes desc, id
  )
  select
    (array_agg(id))[1],
    coalesce((array_agg(puntaje))[1], 0),
    coalesce((array_agg(puntaje))[2], 0)
    into v_mejor_id, v_mejor, v_segundo
  from ordenados;

  if v_mejor_id is not null and v_mejor >= 0.6 and v_segundo <= v_mejor - 0.2 then
    return jsonb_build_object('producto_id', v_mejor_id, 'candidatos', 1, 'capa', 'puntaje');
  end if;

  return jsonb_build_object(
    'producto_id', null,
    'candidatos', case when v_mejor_id is null then 0 else 2 end,
    'capa', 'puntaje'
  );
end;
$function$;

revoke all on function public.eos_erp_resolver_producto_detalle(uuid, text) from public, anon, authenticated;
grant execute on function public.eos_erp_resolver_producto_detalle(uuid, text) to service_role;

comment on function public.eos_erp_resolver_producto_detalle(uuid, text) is
  'v157: resuelve un producto por nombre, ignorando el talle para BUSCAR y usándolo para DESCARTAR. Ver la cabecera de la v157.';
