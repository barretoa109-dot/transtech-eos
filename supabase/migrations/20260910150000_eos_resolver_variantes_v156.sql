-- Que "conjunto verde oliva talle S" encuentre el conjunto verde oliva (v156).
--
-- ============================================================
-- LO QUE PASÓ, CON FECHA
-- ============================================================
--
-- El 9 de septiembre de 2026 una usuaria escribió:
--
--   "Vendí un conjunto verde oliva talle S a 185.000gs"
--
-- EOS entendió perfecto —producto, cantidad, precio, contado— y no registró
-- nada. `eos_erp_resolver_producto` devolvió null, el ejecutor levantó
-- EOS_ACCION_PRODUCTO_NO_RESUELTO y la venta se descartó entera.
--
-- Dos causas, las dos de esta migración:
--
--   1. El resolver de la v86 exige que el nombre del producto contenga TODAS
--      las palabras de más de dos letras. "talle" es una de ellas, y ningún
--      catálogo tiene un producto llamado "talle". Con eso, cualquier frase
--      que mencione el talle, la talla, el color o el número no puede
--      resolverse nunca, aunque el producto esté ahí.
--
--   2. El producto no estaba en el catálogo. La usuaria le había pedido a EOS
--      que "guardara" los costos y márgenes de sus conjuntos, y eso terminó
--      en memoria y no en productos. Cuando vendió uno, la venta murió por
--      falta de una fila que EOS podía crear con lo que ella acababa de
--      decirle: el precio.
--
-- ============================================================
-- AMPLIAR CÓMO SE BUSCA NO ES EMPEZAR A ADIVINAR
-- ============================================================
--
-- La regla que sostiene todo esto no cambia: si hay más de un candidato, se
-- devuelve null y el ejecutor falla con su motivo. Vender el producto
-- equivocado descuenta el stock equivocado y cobra el precio equivocado.
--
-- Lo que cambia es que ahora se busca como habla la gente:
--
--   · sin acentos y sin importar mayúsculas ni puntuación
--   · en singular, palabra por palabra
--   · ignorando lo que describe una VARIANTE y no el producto: talle, talla,
--     tamaño, color, número, y sus valores (S, M, XL, 38)
--   · y, como último recurso, por puntaje: si de tres palabras el producto
--     tiene dos y ningún otro se le acerca, es ese
--
-- ============================================================
-- Y SI NO EXISTE, SE CREA — CUANDO SE SABE EL PRECIO
-- ============================================================
--
-- `eos_erp_resolver_o_crear_producto` es la ejecución parcial: con el precio
-- que la persona acaba de decir alcanza para crear el producto y registrar la
-- venta. Lo único que queda pendiente es el COSTO, y sin costo no hay margen
-- — pero la venta existe, que es lo que importaba.
--
-- Nunca crea a ciegas:
--
--   · si hay candidatos y son varios, NO crea: pregunta cuál. Crear un
--     "conjunto verde" nuevo cuando ya hay dos parecidos parte el catálogo en
--     dos y arruina los informes.
--   · si no hay ninguno y tampoco hay precio, NO crea: pide el precio. Un
--     producto sin precio hace que la primera venta se registre en cero.
--
-- El producto nuevo entra SIN control de stock, a propósito: nadie dijo
-- cuántos hay, y poner cero haría que la venta lo deje en -1 y que el panel
-- avise de una falta que nadie comprobó. Cuando la persona los cuente
-- —"hay 40"— AJUSTAR_STOCK prende el control solo, que es lo que también
-- arregla esta migración más abajo.

-- ============================================================
-- 1) Normalizar: acentos, mayúsculas, puntuación
-- ============================================================

create or replace function public.eos_sin_acentos(p_texto text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select translate(
    coalesce(p_texto, ''),
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
    'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
  );
$function$;

/*
 * Todo a minúscula, sin acentos, y cualquier cosa que no sea letra o número
 * convertida en un espacio.
 *
 * Eso hace que "Conjunto Verde-Oliva", "conjunto verde oliva" y "CONJUNTO
 * VERDE OLIVA!" sean el mismo texto. Antes eran tres, y el nombre exacto —el
 * camino que resuelve sin discusión— fallaba por una mayúscula.
 */
create or replace function public.eos_normalizar(p_texto text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(public.eos_sin_acentos(coalesce(p_texto, ''))),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$function$;

/*
 * Las palabras que no distinguen a un producto de otro: las de relleno del
 * castellano.
 */
create or replace function public.eos_palabra_vacia(p_palabra text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(p_palabra, '') = any (array[
    'del', 'los', 'las', 'una', 'unos', 'unas', 'con', 'por', 'para',
    'que', 'como', 'este', 'esta', 'esto', 'ese', 'esa', 'eso',
    'mas', 'muy', 'sus', 'nos'
  ]);
$function$;

/*
 * Y las que describen una VARIANTE, no el producto.
 *
 * "Talle" no es parte del nombre de nada: es la forma de decir cuál de las
 * variantes. Exigirla —que es lo que hacía la v86— vuelve imposible resolver
 * cualquier frase que la mencione.
 */
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
    -- ...y los valores que puede tomar. Las de una y dos letras (s, m, xl)
    -- ya quedan afuera por largo; estas son las que sobreviven.
    'xxl', 'xxxl', 'small', 'medium', 'large'
  ]);
$function$;

/*
 * Las palabras con las que se busca, en singular y sin relleno.
 *
 * `p_nucleo` saca además lo que describe una variante y los números sueltos.
 * Es la diferencia entre "conjunto verde oliva talle s" —cuatro palabras, y
 * una imposible de encontrar— y "conjunto verde oliva" —tres, y las tres
 * están en el catálogo—.
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
    where length(w) > 2
      and not public.eos_palabra_vacia(w)
      and (
        not p_nucleo
        or (not public.eos_palabra_de_variante(w) and w !~ '^[0-9]+$')
      )
  ) as tokens;
$function$;

revoke all on function public.eos_sin_acentos(text) from public, anon;
revoke all on function public.eos_normalizar(text) from public, anon;
revoke all on function public.eos_palabra_vacia(text) from public, anon;
revoke all on function public.eos_palabra_de_variante(text) from public, anon;
revoke all on function public.eos_tokens(text, boolean) from public, anon;

-- ============================================================
-- 2) Resolver un producto, y saber POR QUÉ cuando no se puede
-- ============================================================
--
-- Devuelve `{producto_id, candidatos, capa}`. `candidatos` es lo que separa
-- las dos formas de fallar, que necesitan respuestas opuestas:
--
--   candidatos = 0  → no existe. Con el precio se puede crear.
--   candidatos > 1  → hay varios parecidos. Hay que preguntar cuál, y NO se
--                     puede crear uno nuevo sin partir el catálogo en dos.
--
-- Sin esta distinción, "vendí 3 panes" con "Pan casero" y "Pan de leche" en
-- el catálogo terminaría creando un tercer producto llamado "panes".

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
   * dice "conjunto verde oliva" y el producto se llama "Verde oliva". Sin
   * esto hay que escribir el nombre tal cual está guardado, que es
   * exactamente lo que este producto existe para no pedir.
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

/*
 * La firma de siempre, para los diez lugares que ya la llaman.
 *
 * Cambiar la que existe rompería `eos_erp_crear_productos_v131`, la compra, el
 * ajuste de stock y el ejecutor entero. Esta envuelve a la nueva y devuelve
 * exactamente lo que devolvía: el id, o null cuando no se puede estar seguro.
 */
create or replace function public.eos_erp_resolver_producto(
  p_usuario_id uuid,
  p_texto text
)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select nullif(
    public.eos_erp_resolver_producto_detalle(p_usuario_id, p_texto) ->> 'producto_id',
    ''
  )::uuid;
$function$;

revoke all on function public.eos_erp_resolver_producto_detalle(uuid, text) from public, anon, authenticated;
revoke all on function public.eos_erp_resolver_producto(uuid, text) from public, anon, authenticated;
grant execute on function public.eos_erp_resolver_producto_detalle(uuid, text) to service_role;
grant execute on function public.eos_erp_resolver_producto(uuid, text) to service_role;

-- ============================================================
-- 3) Los contactos, con la misma normalización
-- ============================================================
--
-- Los nombres de personas no se pluralizan, pero sí se escriben al revés, a
-- medias y con o sin tilde: "Giménez Rossana", "rossana gimenez", "Rossana G".
-- Lo que arregla acá es lo mismo: "Rossana" no encontraba a "Rossana Giménez"
-- si alguien la escribía sin tilde en el nombre del contacto.

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
  v_norm text := public.eos_normalizar(p_texto);
  v_id uuid;
  v_cuantos int;
  v_tokens text[];
begin
  if v_norm = '' then
    return null;
  end if;

  select count(*), (array_agg(c.id))[1]
    into v_cuantos, v_id
  from public.eos_crm_contactos c
  where c.usuario_id = p_usuario_id
    and c.activo
    and public.eos_normalizar(c.nombre) = v_norm;

  if v_cuantos = 1 then
    return v_id;
  end if;

  if v_cuantos > 1 then
    return null;
  end if;

  select count(*), (array_agg(c.id))[1]
    into v_cuantos, v_id
  from public.eos_crm_contactos c
  where c.usuario_id = p_usuario_id
    and c.activo
    and public.eos_normalizar(c.nombre) like '%' || v_norm || '%';

  if v_cuantos = 1 then
    return v_id;
  end if;

  if v_cuantos > 1 then
    return null;
  end if;

  -- Todas las palabras, en cualquier orden. Cubre "Giménez Rossana" sin abrir
  -- la puerta a confundir dos clientes distintos: con dos candidatos, null.
  v_tokens := public.eos_tokens(p_texto, false);

  if cardinality(v_tokens) = 0 then
    return null;
  end if;

  select count(*), (array_agg(c.id))[1]
    into v_cuantos, v_id
  from public.eos_crm_contactos c
  where c.usuario_id = p_usuario_id
    and c.activo
    and v_tokens <@ public.eos_tokens(c.nombre, false);

  if v_cuantos = 1 then
    return v_id;
  end if;

  return null;
end;
$function$;

revoke all on function public.eos_crm_resolver_contacto(uuid, text) from public, anon, authenticated;
grant execute on function public.eos_crm_resolver_contacto(uuid, text) to service_role;

-- ============================================================
-- 4) Resolver o crear: la ejecución parcial
-- ============================================================

create or replace function public.eos_erp_resolver_o_crear_producto(
  p_usuario_id uuid,
  p_command_id uuid,
  p_texto text,
  p_precio numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_detalle jsonb;
  v_id uuid;
  v_candidatos int;
  v_costo numeric;
  v_nombre text;
  v_precio numeric := p_precio;
begin
  if v_texto = '' then
    raise exception 'EOS_ACCION_PRODUCTO_SIN_NOMBRE';
  end if;

  v_detalle := public.eos_erp_resolver_producto_detalle(p_usuario_id, v_texto);
  v_id := nullif(v_detalle ->> 'producto_id', '')::uuid;
  v_candidatos := coalesce((v_detalle ->> 'candidatos')::int, 0);

  if v_id is not null then
    select p.costo, p.nombre into v_costo, v_nombre
    from public.eos_erp_productos p
    where p.id = v_id;

    return jsonb_build_object(
      'producto_id', v_id,
      'creado', false,
      'nombre', v_nombre,
      'costo_pendiente', v_costo is null
    );
  end if;

  /*
   * Varios parecidos: NO se crea, se pregunta.
   *
   * Crear "conjunto verde" cuando ya hay un "Conjunto verde oliva" y un
   * "Conjunto verde militar" deja tres productos donde había dos, reparte las
   * ventas entre ellos y arruina el ranking, el stock y el margen de los tres.
   */
  if v_candidatos > 1 then
    raise exception 'EOS_ACCION_PRODUCTO_NO_RESUELTO: %', v_texto;
  end if;

  if v_precio is null or v_precio <= 0 then
    raise exception 'EOS_ACCION_PRODUCTO_SIN_PRECIO: %', v_texto;
  end if;

  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  insert into public.eos_erp_productos (
    usuario_id, nombre, precio_venta, costo, moneda, iva,
    controla_stock, stock_actual, stock_minimo, activo, action_command_id
  ) values (
    p_usuario_id,
    left(v_texto, 160),
    v_precio,
    null,
    'PYG',
    10,
    -- Sin control de stock: nadie dijo cuántos hay. Ver la cabecera.
    false,
    0,
    0,
    true,
    p_command_id
  )
  returning id, nombre into v_id, v_nombre;

  return jsonb_build_object(
    'producto_id', v_id,
    'creado', true,
    'nombre', v_nombre,
    'precio_venta', v_precio,
    'costo_pendiente', true
  );
end;
$function$;

revoke all on function public.eos_erp_resolver_o_crear_producto(uuid, uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.eos_erp_resolver_o_crear_producto(uuid, uuid, text, numeric)
  to service_role;

comment on function public.eos_erp_resolver_o_crear_producto(uuid, uuid, text, numeric) is
  'v156: resuelve un producto por nombre y, si no existe y hay precio, lo crea para que la venta no se pierda. Con varios candidatos no crea: pregunta.';

-- ============================================================
-- 5) Contar por primera vez prende el control de stock
-- ============================================================
--
-- `eos_erp_ajustar_stock` fallaba con EOS_PRODUCTO_SIN_STOCK sobre un producto
-- que no lleva inventario. Para un servicio está bien; para un producto que
-- entró por una venta —que ahora nace sin control, porque nadie sabía cuántos
-- había— era un callejón sin salida: la persona decía "hay 40" y EOS contestaba
-- que ese producto no lleva stock, sin forma de arreglarlo desde el chat.
--
-- CONTAR es exactamente el momento en que se aprende el stock. Así que un
-- conteo (`stock_contado`) lo prende y deja el número contado.
--
-- Un `delta` sigue fallando, y tiene que seguir fallando: "se rompieron 3"
-- sobre un producto del que nadie sabe cuántos hay no da 40, da -3.

drop function if exists public.eos_erp_ajustar_stock(uuid, uuid, numeric, numeric, text, uuid);

create or replace function public.eos_erp_ajustar_stock(
  p_usuario_id uuid,
  p_producto_id uuid,
  p_stock_contado numeric default null,
  p_delta numeric default null,
  p_motivo text default null,
  p_action_command_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_producto public.eos_erp_productos%rowtype;
  v_diferencia numeric(16,3);
  v_saldo numeric(16,3);
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_fecha date := (now() at time zone 'America/Asuncion')::date;
  v_prendio boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if (p_stock_contado is null) = (p_delta is null) then
    raise exception 'EOS_AJUSTE_MODO_INVALIDO';
  end if;

  if v_motivo is null then
    raise exception 'EOS_AJUSTE_MOTIVO_REQUERIDO';
  end if;

  v_motivo := left(v_motivo, 500);

  if p_stock_contado in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or p_delta in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
    raise exception 'EOS_AJUSTE_NUMERO_INVALIDO';
  end if;

  if p_stock_contado is not null and p_stock_contado < 0 then
    raise exception 'EOS_AJUSTE_CONTEO_NEGATIVO';
  end if;

  select * into v_producto
  from public.eos_erp_productos
  where id = p_producto_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_PRODUCTO_NO_EXISTE';
  end if;

  if not v_producto.controla_stock then
    -- Contar es aprender el stock: se prende el control y se sigue. Restar de
    -- un inventario que nadie llevó, no.
    if p_stock_contado is null then
      raise exception 'EOS_PRODUCTO_SIN_STOCK';
    end if;

    update public.eos_erp_productos
    set controla_stock = true,
        actualizado_en = now()
    where id = v_producto.id;

    v_producto.controla_stock := true;
    v_prendio := true;
  end if;

  v_diferencia := case
    when p_stock_contado is not null then p_stock_contado - v_producto.stock_actual
    else p_delta
  end;

  -- Contar y que dé lo mismo no es un error, pero tampoco un movimiento.
  if v_diferencia = 0 then
    return jsonb_build_object(
      'ok', true,
      'sin_cambios', true,
      'control_prendido', v_prendio,
      'producto_id', v_producto.id,
      'stock_actual', v_producto.stock_actual
    );
  end if;

  update public.eos_erp_productos
  set stock_actual = stock_actual + v_diferencia,
      actualizado_en = now()
  where id = v_producto.id
  returning stock_actual into v_saldo;

  insert into public.eos_erp_movimientos_stock (
    usuario_id, producto_id, tipo, cantidad, saldo_resultante,
    motivo, referencia_tipo, referencia_id, fecha, action_command_id
  ) values (
    p_usuario_id, v_producto.id, 'ajuste', v_diferencia, v_saldo,
    v_motivo,
    case when p_stock_contado is not null then 'inventario' else 'manual' end,
    null, v_fecha
  , p_action_command_id
  );

  return jsonb_build_object(
    'ok', true,
    'sin_cambios', false,
    'control_prendido', v_prendio,
    'movimiento_id', (
      select m.id from public.eos_erp_movimientos_stock m
      where m.producto_id = v_producto.id
      order by m.creado_en desc
      limit 1
    ),
    'producto_id', v_producto.id,
    'stock_anterior', v_producto.stock_actual,
    'stock_actual', v_saldo,
    'diferencia', v_diferencia
  );
end;
$function$;

revoke all on function public.eos_erp_ajustar_stock(uuid, uuid, numeric, numeric, text, uuid)
  from public, anon, authenticated;
grant execute on function public.eos_erp_ajustar_stock(uuid, uuid, numeric, numeric, text, uuid)
  to service_role;

-- ============================================================
-- 6) Crear no es editar, pero un costo que falta no es editar
-- ============================================================
--
-- Lo que pasó, en el chat de una usuaria el 9 de septiembre de 2026:
--
--   "Voy a registrar la venta de los 2 conjuntos verde oliva de Zivah, talle S
--    y talle M, a ₲ 185.000 cada uno. También dejo sus costos para que el
--    margen salga bien: ₲ 142.442,46 y ₲ 142.382,59."
--
-- Y la respuesta del sistema:
--
--   "Cargué «Conjunto verde oliva de Zivah talle S» en tu catálogo.
--    «Conjunto verde oliva de Zivah talle M» ya estaba y no le toqué el precio."
--
-- El talle M ya existía SIN COSTO. La usuaria acababa de decir cuánto le
-- cuesta, y ese número se descartó por una regla que existe para otra cosa.
--
-- La regla "crear no es editar" protege el PRECIO: cambiarlo en silencio
-- cambia el margen de todo lo que se venda después. Un costo que está en NULL
-- no tiene nada que proteger: no hay ningún número que pisar, no hay ningún
-- margen calculado a partir de él, y sin costo el panel de rentabilidad no
-- puede decir absolutamente nada de ese producto.
--
-- Entonces: si el producto ya existe y NO tiene costo, se le pone el que vino.
-- Si YA tiene uno, no se toca — para eso está ACTUALIZAR_PRODUCTO, que
-- devuelve el antes y el después. El precio nunca se toca acá.

create or replace function public.eos_erp_crear_productos_v131(
  p_usuario_id uuid,
  p_command_id uuid,
  p_productos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item jsonb;
  v_nombre text;
  v_precio numeric;
  v_costo numeric;
  v_stock numeric;
  v_iva integer;
  v_moneda text;
  v_existente uuid;
  v_costo_actual numeric;
  v_id uuid;
  v_primero uuid;
  v_creados jsonb := '[]'::jsonb;
  v_repetidos jsonb := '[]'::jsonb;
  v_costos jsonb := '[]'::jsonb;
  v_cuantos integer := 0;
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  if jsonb_typeof(p_productos) <> 'array' or jsonb_array_length(p_productos) = 0 then
    raise exception 'EOS_ACCION_PRODUCTO_SIN_DATOS';
  end if;

  for v_item in select * from jsonb_array_elements(p_productos)
  loop
    v_cuantos := v_cuantos + 1;

    -- Un tope por tanda: diez es un catálogo dictado de corrido, cien es un
    -- modelo en un bucle. Lo grande se importa por planilla, que además
    -- muestra la vista previa antes de escribir.
    if v_cuantos > 10 then
      raise exception 'EOS_ACCION_PRODUCTO_DEMASIADOS';
    end if;

    v_nombre := nullif(btrim(coalesce(v_item ->> 'nombre', v_item ->> 'producto', '')), '');

    if v_nombre is null then
      raise exception 'EOS_ACCION_PRODUCTO_SIN_NOMBRE';
    end if;

    /*
     * `eos_leer_monto` y no la expresión de la v131.
     *
     * Con esa expresión el punto sobrevive, y en Paraguay el punto es el
     * separador de MILES: "142.442,46" entraba como 142,442 — ciento cuarenta
     * y dos guaraníes de costo, y un margen del 99,9% que nadie relaciona con
     * este momento. Es el mismo error que la v150 arregló en otras once
     * funciones; ésta se había quedado afuera.
     */
    v_precio := public.eos_leer_monto(coalesce(v_item ->> 'precio_venta', v_item ->> 'precio'));
    v_costo := public.eos_leer_monto(v_item ->> 'costo');

    v_existente := public.eos_erp_resolver_producto(p_usuario_id, v_nombre);

    if v_existente is not null then
      v_repetidos := v_repetidos || to_jsonb(v_nombre);
      if v_primero is null then v_primero := v_existente; end if;

      -- El costo que faltaba. Ver la cabecera de esta sección.
      if v_costo is not null and v_costo >= 0 then
        select p.costo into v_costo_actual
        from public.eos_erp_productos p
        where p.id = v_existente;

        if v_costo_actual is null then
          update public.eos_erp_productos
          set costo = v_costo,
              actualizado_en = now()
          where id = v_existente;

          v_costos := v_costos || jsonb_build_array(
            jsonb_build_object('nombre', v_nombre, 'costo', v_costo)
          );
        end if;
      end if;

      continue;
    end if;

    if v_precio is null or v_precio <= 0 then
      raise exception 'EOS_ACCION_PRODUCTO_SIN_PRECIO: %', v_nombre;
    end if;

    v_stock := coalesce(public.eos_leer_monto(coalesce(v_item ->> 'stock', v_item ->> 'stock_actual')), 0);

    -- El IVA de Paraguay: 10 salvo que digan otra cosa. `0` es exenta, y hay
    -- que poder decirlo: la usuaria tenía un producto exento en su catálogo.
    v_iva := coalesce(nullif(regexp_replace(coalesce(v_item ->> 'iva', ''), '[^0-9]', '', 'g'), '')::integer, 10);
    if v_iva not in (0, 5, 10) then v_iva := 10; end if;

    v_moneda := upper(nullif(btrim(coalesce(v_item ->> 'moneda', '')), ''));
    if v_moneda is null or length(v_moneda) <> 3 then v_moneda := 'PYG'; end if;

    insert into public.eos_erp_productos (
      usuario_id, nombre, precio_venta, costo, moneda, iva,
      controla_stock, stock_actual, stock_minimo, activo, action_command_id
    ) values (
      p_usuario_id,
      left(v_nombre, 160),
      v_precio,
      v_costo,
      v_moneda,
      v_iva,
      true,
      v_stock,
      0,
      true,
      p_command_id
    )
    returning id into v_id;

    if v_primero is null then v_primero := v_id; end if;
    v_creados := v_creados || jsonb_build_object('id', v_id, 'nombre', v_nombre, 'precio_venta', v_precio);
  end loop;

  if v_primero is null then
    raise exception 'EOS_ACCION_PRODUCTO_SIN_DATOS';
  end if;

  return jsonb_build_object(
    'primero', v_primero,
    'creados', v_creados,
    'ya_existian', v_repetidos,
    'costos_puestos', v_costos
  );
end;
$function$;

revoke all on function public.eos_erp_crear_productos_v131(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_erp_crear_productos_v131(uuid, uuid, jsonb) to service_role;

comment on function public.eos_erp_crear_productos_v131(uuid, uuid, jsonb) is
  'v156: crea una tanda de productos desde el chat. No pisa precio ni costo ya cargado, pero COMPLETA un costo que faltaba. Ver la cabecera de la v156.';
