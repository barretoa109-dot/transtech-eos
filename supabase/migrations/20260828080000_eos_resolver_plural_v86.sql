-- Que "3 panes caseros" encuentre el "Pan casero" (v86).
--
-- ============================================================
-- LA GENTE HABLA EN PLURAL
-- ============================================================
--
-- Probando el circuito completo por chat, a "vendile 3 panes caseros a Rossana"
-- el modelo mandó el producto como "panes caseros" —tal como lo dijo el
-- usuario— y la resolución falló: el catálogo dice "Pan casero", y ni la
-- coincidencia exacta ni un LIKE de la frase entera dan con él.
--
-- Se podría pedirle al modelo que singularice. Sería frágil: el modelo va a
-- variar la redacción siempre, y cada variante nueva volvería a fallar. El
-- lugar donde esto se arregla una vez es acá.
--
-- ============================================================
-- CÓMO, SIN PERDER LA SEGURIDAD
-- ============================================================
--
-- Se agrega un último intento: partir el texto en palabras, quitarles el plural
-- y exigir que el nombre del producto las contenga a TODAS.
--
--   "panes caseros" -> pan + casero -> "Pan casero"          (una: resuelve)
--   "pan"           -> pan          -> "Pan casero", "Pan de leche"  (dos: falla)
--
-- La regla que sostiene todo esto no cambia: si hay más de un candidato, se
-- devuelve null y el ejecutor falla con su motivo. Ampliar las formas de buscar
-- no es lo mismo que empezar a adivinar.
--
-- El plural en castellano se recorta a lo bruto —"es" o "s" al final— porque
-- para nombres de productos alcanza: panes, chipas, tortillas, empanadas. Una
-- palabra que quede rara al recortarla simplemente no va a encontrar nada, que
-- es el mismo resultado que hoy.

create or replace function public.eos_singular(p_palabra text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when length(p_palabra) > 4 and right(lower(p_palabra), 2) = 'es'
      then left(p_palabra, length(p_palabra) - 2)
    when length(p_palabra) > 3 and right(lower(p_palabra), 1) = 's'
      then left(p_palabra, length(p_palabra) - 1)
    else p_palabra
  end;
$function$;

create or replace function public.eos_erp_resolver_producto(
  p_usuario_id uuid,
  p_texto text
)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id uuid;
  v_cuantos int;
  v_palabras text[];
begin
  if v_texto = '' then
    return null;
  end if;

  -- Nombre exacto: si escribieron el nombre completo, gana sin discusión.
  select p.id into v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and lower(btrim(p.nombre)) = lower(v_texto)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- Por código, que es como los nombra quien tiene muchos.
  select p.id into v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and lower(btrim(coalesce(p.codigo, ''))) = lower(v_texto)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- La frase entera contenida en el nombre, y sólo si no hay dudas.
  select count(*), (array_agg(p.id))[1]
    into v_cuantos, v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and p.nombre ilike '%' || v_texto || '%';

  if v_cuantos = 1 then
    return v_id;
  end if;

  if v_cuantos > 1 then
    -- Varios candidatos con la frase entera: eso ya es ambiguo de verdad y
    -- seguir buscando por palabras sólo agregaría más.
    return null;
  end if;

  /*
   * Último intento: todas las palabras, sin plural.
   *
   * Se exige que el nombre las contenga a TODAS, no a cualquiera. Con
   * "cualquiera", "pan de leche casero" respondería a "chipa casera" por
   * compartir una palabra.
   */
  select array_agg(public.eos_singular(w))
    into v_palabras
  from regexp_split_to_table(lower(v_texto), '\s+') as w
  where length(w) > 2;

  if v_palabras is null or cardinality(v_palabras) = 0 then
    return null;
  end if;

  select count(*), (array_agg(p.id))[1]
    into v_cuantos, v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and (
      select bool_and(lower(p.nombre) like '%' || palabra || '%')
      from unnest(v_palabras) as palabra
    );

  if v_cuantos = 1 then
    return v_id;
  end if;

  return null;
end;
$function$;

create or replace function public.eos_crm_resolver_contacto(
  p_usuario_id uuid,
  p_texto text
)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id uuid;
  v_cuantos int;
  v_palabras text[];
begin
  if v_texto = '' then
    return null;
  end if;

  select c.id into v_id
  from public.eos_crm_contactos c
  where c.usuario_id = p_usuario_id
    and c.activo
    and lower(btrim(c.nombre)) = lower(v_texto)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select count(*), (array_agg(c.id))[1]
    into v_cuantos, v_id
  from public.eos_crm_contactos c
  where c.usuario_id = p_usuario_id
    and c.activo
    and c.nombre ilike '%' || v_texto || '%';

  if v_cuantos = 1 then
    return v_id;
  end if;

  if v_cuantos > 1 then
    return null;
  end if;

  /*
   * Los nombres de personas no se pluralizan, pero sí se dicen al revés o a
   * medias: "Giménez Rossana", "Rossana G". Exigir todas las palabras cubre eso
   * sin abrir la puerta a confundir dos clientes distintos.
   */
  select array_agg(w)
    into v_palabras
  from regexp_split_to_table(lower(v_texto), '\s+') as w
  where length(w) > 2;

  if v_palabras is null or cardinality(v_palabras) = 0 then
    return null;
  end if;

  select count(*), (array_agg(c.id))[1]
    into v_cuantos, v_id
  from public.eos_crm_contactos c
  where c.usuario_id = p_usuario_id
    and c.activo
    and (
      select bool_and(lower(c.nombre) like '%' || palabra || '%')
      from unnest(v_palabras) as palabra
    );

  if v_cuantos = 1 then
    return v_id;
  end if;

  return null;
end;
$function$;

revoke all on function public.eos_singular(text) from public, anon;
revoke all on function public.eos_erp_resolver_producto(uuid, text) from public, anon, authenticated;
revoke all on function public.eos_crm_resolver_contacto(uuid, text) from public, anon, authenticated;
