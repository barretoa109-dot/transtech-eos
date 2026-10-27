-- Un código de dos letras en el nombre no puede desaparecer del buscador (v246).
--
-- ============================================================
-- EL CASO
-- ============================================================
--
-- Una clienta real escribió por WhatsApp:
--
--   "Registra venta / 2 Jeans E WL / Costo 83.420 c/u / Vendo 125.000gs"
--
-- "Jeans E WL" no estaba en su catálogo, y el precio de venta venía en el
-- mismo mensaje: debía crearse solo. En cambio, EOS contestó "no encontré...
-- o hay más de uno que se llama parecido", que es el aviso de AMBIGÜEDAD, no
-- el de "no existe" — y ese aviso corta antes de mirar el precio
-- (`eos_erp_resolver_o_crear_producto`, v156).
--
-- La causa: `eos_tokens` (v156) descarta toda palabra de 2 letras o menos
-- ("length(w) > 2"). De "Jeans E WL" sobrevive solo "jean", y la capa
-- "palabras" del resolver busca cualquier producto que contenga "jean" en el
-- nombre: con DOS productos de jean ya en el catálogo ("Cjto Celeste jeans",
-- "Jeans tachas Negro"), ESO cuenta como ambiguo, aunque el pedido real —"E
-- WL"— no tenga nada que ver con ninguno de los dos.
--
-- ============================================================
-- POR QUÉ NO ALCANZA CON BAJAR EL LARGO A SECAS
-- ============================================================
--
-- `eos_palabra_vacia` (v156) descarta relleno del castellano ("del", "una",
-- "con", "para"...) pero NINGUNA palabra de 2 letras: confiaba en el filtro de
-- largo para sacar "de", "la", "el", "un", etc. Bajar el filtro a secas haría
-- que esas palabras empezaran a contar como parte del nombre del producto, y
-- "Jean de la casa" dejaría de encontrar "Jean casa" en el catálogo.
--
-- Mismo problema al revés con `eos_palabra_de_variante` (v156): su propio
-- comentario decía que "s", "m", "xl" "ya quedan afuera por largo" — con el
-- filtro en 2, eso deja de ser cierto, y un talle como "XL" se colaría como
-- palabra del PRODUCTO en la capa núcleo, rompiendo el caso que esa capa
-- existe para resolver (que "Remera talle XL Celeste" encuentre "Remera
-- Celeste").
--
-- Por eso los tres cambios van juntos: bajar el filtro de largo, Y sumar a
-- `eos_palabra_vacia` el relleno de 2 letras que el largo escondía, Y sumar a
-- `eos_palabra_de_variante` los talles de 2 letras ("xs", "xl") por el mismo
-- motivo.
--
-- ============================================================
-- VERIFICADO (transacción con rollback contra producción, sin aplicar nada)
-- ============================================================
--
--   eos_tokens('Jeans E WL', false)              -> {jean, wl}
--   resolver('Jeans E WL')                       -> candidatos: 0 (antes: 2)
--   eos_tokens('Jean de la casa', false)          -> {casa, jean}   (de/la afuera)
--   eos_tokens('Remera talle XL Celeste', true)   -> {celeste, remera} (xl afuera, como antes)
--   eos_tokens('Remera talle XL Celeste', false)  -> {celeste, remera, talle, xl} (sin cambios)
--   resolver('panes caseros') (caso histórico v86) -> sigue sin romperse

create or replace function public.eos_palabra_vacia(p_palabra text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(p_palabra, '') = any (array[
    'del', 'los', 'las', 'una', 'unos', 'unas', 'con', 'por', 'para',
    'que', 'como', 'este', 'esta', 'esto', 'ese', 'esa', 'eso',
    'mas', 'muy', 'sus', 'nos',
    -- Relleno de 2 letras: antes quedaba afuera solo por el largo.
    'de', 'la', 'el', 'un', 'en', 'es', 'lo', 'al', 'mi', 'tu',
    'su', 'le', 'no', 'se', 'si', 'ya', 'me'
  ]);
$function$;

create or replace function public.eos_palabra_de_variante(p_palabra text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(p_palabra, '') = any (array[
    -- Cómo se nombra una variante...
    'talle', 'talla', 'tamano', 'medida', 'numero', 'nro', 'num',
    'color', 'presentacion', 'variante', 'unidad', 'unidades',
    -- ...y los valores que puede tomar. "xs"/"xl" se agregan acá porque, con
    -- el filtro de largo en 2, ya no quedan afuera solos.
    'xs', 'xl', 'xxl', 'xxxl', 'small', 'medium', 'large'
  ]);
$function$;

/*
 * Las palabras con las que se busca, en singular y sin relleno.
 *
 * Antes exigía más de 2 letras ("jean", "wl" entraban distinto: "wl" quedaba
 * afuera). Códigos de dos letras —"WL", "E" de otra marca, lo que sea que una
 * persona use para distinguir variantes— son parte real del nombre, no
 * relleno: bajarlo a 2 los deja entrar, y lo de arriba cubre lo que ese mismo
 * cambio habría roto.
 */
create or replace function public.eos_tokens(p_texto text, p_nucleo boolean default false)
returns text[]
language sql
immutable
set search_path to ''
as $function$
  select coalesce(array_agg(t order by t), array[]::text[])
  from (
    select distinct public.eos_singular(w) as t
    from regexp_split_to_table(public.eos_normalizar(p_texto), ' ') as w
    where length(w) > 1
      and not public.eos_palabra_vacia(w)
      and (
        not p_nucleo
        or (not public.eos_palabra_de_variante(w) and w !~ '^[0-9]+$')
      )
  ) as tokens;
$function$;

revoke all on function public.eos_palabra_vacia(text) from public, anon;
revoke all on function public.eos_palabra_de_variante(text) from public, anon;
revoke all on function public.eos_tokens(text, boolean) from public, anon;
