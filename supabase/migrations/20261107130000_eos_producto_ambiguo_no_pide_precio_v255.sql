-- T-02 del plan maestro de auditoría (07/11/2026): el mensaje de producto
-- ambiguo le pedía el precio que ya le habían dado (v255).
--
-- ============================================================
-- LO QUE PASÓ EN PRODUCCIÓN
-- ============================================================
--
-- Nueve ventas de la misma clienta, en los últimos 30 días, fallaron con
-- EOS_ACCION_PRODUCTO_NO_RESUELTO. En todas el mensaje de WhatsApp YA traía
-- el precio de venta:
--
--   "Registra venta / 2 Jeans E WL / Costo 83.420 c/u / Vendo 125.000gs"
--
-- y la respuesta fue:
--
--   "No encontré... Decime cuál es exactamente, o pasame el precio de venta
--    y te lo cargo al catálogo."
--
-- —pidiéndole algo que ya había mandado. La clienta repitió el mismo mensaje
-- tres veces el mismo día (21:48, 21:49, 23:31) sin que nada cambiara.
--
-- ============================================================
-- LA CAUSA
-- ============================================================
--
-- `eos_erp_resolver_o_crear_producto` (v156) tiene dos salidas sin éxito, y
-- las dos levantaban el MISMO código:
--
--   · varios candidatos parecidos (ambiguo de verdad: "Cjto eng Celeste
--     Claro", "Cjto eng t2 Negro", "Cjto eng t3 azul M" contra "Cjto eng
--     Viol") → no se puede crear sin partir el catálogo en dos.
--   · ningún candidato y sin precio → ESE caso ya tiene su propio código,
--     EOS_ACCION_PRODUCTO_SIN_PRECIO, con el mensaje correcto.
--
-- El primer caso es el único que todavía usaba EOS_ACCION_PRODUCTO_NO_RESUELTO,
-- y a ese mensaje (pensado para cuando el precio SÍ ayuda, de la v131) nunca
-- se le sacó la frase del precio cuando dejó de aplicar: dar el precio no
-- resuelve una ambigüedad entre productos que ya existen.
--
-- ============================================================
-- LA REGLA (mismo patrón que EOS_ACCION_CONTACTO_AMBIGUO, v215)
-- ============================================================
--
-- Código propio para "se parece a más de uno": EOS_ACCION_PRODUCTO_AMBIGUO.
-- Sin la frase del precio, porque nunca ayuda acá. El código viejo queda para
-- los demás que todavía lo usan (AJUSTAR_STOCK y similares, que no crean).
--
-- Solo cambia esa rama de la función: el resto —capas de resolución, creación
-- sin control de stock, mensajes de sin-nombre y sin-precio— sigue igual.

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
   * Varios parecidos: NO se crea, se pregunta. Código propio (v255): pedirle
   * el precio no sirve de nada acá, el problema es cuál de los que ya tiene
   * es.
   *
   * Crear "conjunto verde" cuando ya hay un "Conjunto verde oliva" y un
   * "Conjunto verde militar" deja tres productos donde había dos, reparte las
   * ventas entre ellos y arruina el ranking, el stock y el margen de los tres.
   */
  if v_candidatos > 1 then
    raise exception 'EOS_ACCION_PRODUCTO_AMBIGUO: %', v_texto;
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
  'v255: resuelve un producto por nombre y, si no existe y hay precio, lo crea para que la venta no se pierda. Con varios candidatos no crea: levanta EOS_ACCION_PRODUCTO_AMBIGUO (antes PRODUCTO_NO_RESUELTO, que sugería mandar el precio sin que ayudara).';
