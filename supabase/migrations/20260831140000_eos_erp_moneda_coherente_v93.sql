-- Que una venta o una compra no mezcle monedas (v93).
--
-- ============================================================
-- EL AGUJERO
-- ============================================================
--
-- `eos_erp_registrar_venta` y `eos_erp_registrar_compra` reciben `p_moneda`
-- del cliente y NUNCA la contrastan con la moneda de los productos que se
-- están vendiendo o comprando. La pantalla, además, la deducía del PRIMER
-- producto del catálogo — no de los que están en el documento.
--
-- Resultado: un producto con precio en USD se podía registrar dentro de una
-- venta en PYG. Y no queda ahí: la venta genera un movimiento financiero con
-- la moneda del documento, así que USD 200 entraban al panel como Gs. 200. El
-- panel financiero ya aprendió esta lección por su lado (ver el comentario de
-- `app/api/finanzas/estado`, donde sumar monedas distintas daba un número que
-- no existía en ninguna); el ERP todavía no.
--
-- Sumar dos monedas como si fueran una no es un error de presentación. Es un
-- número falso, y encima uno que el usuario no tiene forma de detectar.
--
-- ============================================================
-- POR QUÉ UN TRIGGER Y NO UN CHEQUEO DENTRO DE LA FUNCIÓN
-- ============================================================
--
-- Es la misma decisión de la v76, y por el mismo motivo, escrito entonces:
-- un chequeo dentro de `eos_erp_registrar_venta` protege ese camino y nada
-- más. El trigger cubre por igual la interfaz, el chat, los RPC, el importador
-- y cualquier integración que se agregue después.
--
-- Además evita reescribir dos funciones grandes que ya llevan tres enmiendas
-- (v78, v79, v80). Reproducirlas enteras para agregar tres líneas es la forma
-- más fácil de perder por el camino algo que costó arreglar.
--
-- ============================================================
-- QUÉ PASA CON LOS DATOS QUE YA EXISTEN
-- ============================================================
--
-- Nada. El trigger corre `before insert` sobre los ítems, así que solo mira
-- documentos nuevos. Lo ya registrado queda como está: no se toca la historia,
-- que es la regla 4 de la arquitectura ERP.
--
-- Un producto sin precio en otra moneda —la abrumadora mayoría, porque el
-- default es PYG— no nota ninguna diferencia.

create or replace function public.eos_erp_item_moneda_coherente()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_moneda_documento text;
  v_moneda_producto text;
begin
  -- Un ítem libre, sin producto del catálogo, se expresa en la moneda del
  -- documento por definición: no hay con qué contrastarlo.
  if new.producto_id is null then
    return new;
  end if;

  select moneda into v_moneda_producto
  from public.eos_erp_productos
  where id = new.producto_id;

  if not found then
    return new; -- La coherencia de tenant ya la exige la v76.
  end if;

  if tg_table_name = 'eos_erp_venta_items' then
    select moneda into v_moneda_documento
    from public.eos_erp_ventas
    where id = new.venta_id;
  else
    select moneda into v_moneda_documento
    from public.eos_erp_compras
    where id = new.compra_id;
  end if;

  if not found then
    return new;
  end if;

  if upper(btrim(v_moneda_producto)) is distinct from upper(btrim(v_moneda_documento)) then
    raise exception
      'EOS_MONEDA_INCOMPATIBLE: el producto está en % y el documento en %',
      v_moneda_producto, v_moneda_documento;
  end if;

  return new;
end;
$function$;

revoke all on function public.eos_erp_item_moneda_coherente() from public, anon, authenticated;

drop trigger if exists eos_erp_venta_items_moneda_v93 on public.eos_erp_venta_items;
create trigger eos_erp_venta_items_moneda_v93
  before insert on public.eos_erp_venta_items
  for each row execute function public.eos_erp_item_moneda_coherente();

drop trigger if exists eos_erp_compra_items_moneda_v93 on public.eos_erp_compra_items;
create trigger eos_erp_compra_items_moneda_v93
  before insert on public.eos_erp_compra_items
  for each row execute function public.eos_erp_item_moneda_coherente();
