-- Kardex valorizado: cuánto vale el stock, y cuánto valía (v108).
--
-- ============================================================
-- QUÉ FALTABA
-- ============================================================
--
-- `eos_erp_movimientos_stock` registra CUÁNTO entró y salió, nunca a cuánto.
-- Con eso se puede reconstruir la cantidad histórica pero no el valor, y el
-- valor es lo que hace falta para rotación de inventario, días de inventario y
-- capital inmovilizado de verdad.
--
-- Hoy el único costo que existe es `eos_erp_productos.costo`, que es el ÚLTIMO
-- costo conocido: se pisa con cada compra. Sirve para decidir un precio y no
-- sirve para valorizar, porque valoriza todo el stock al precio de la última
-- compra aunque nueve de diez unidades hayan entrado más baratas.
--
-- ============================================================
-- PROMEDIO MÓVIL, Y UNO SOLO
-- ============================================================
--
-- `docs/erp-profesional-arquitectura.md` pide un método de costeo definido,
-- "inicialmente promedio móvil o último costo, no ambos". Se elige promedio
-- móvil ponderado (PPP) para VALORIZAR, que es lo que un kardex significa.
--
-- Se agrega en una columna nueva en vez de pisar `costo`, y no por comodidad:
-- desde la v100 cada venta CONGELA el costo del producto en su ítem, y de ahí
-- salen todos los márgenes. Cambiar el significado de `costo` movería
-- silenciosamente márgenes ya calculados. Entonces quedan dos costos con dos
-- trabajos declarados:
--
--   · `costo`           — el último que se pagó. Para decidir precios y para
--                         congelar en la venta. NO cambia de significado.
--   · `costo_promedio`  — el promedio ponderado de lo que hay en stock. Para
--                         valorizar el inventario. Solo lo usa el kardex.
--
-- Dos números para "el costo" es exactamente la clase de cosa que confunde, y
-- por eso están nombrados distinto y documentados acá y en el código.
--
-- ============================================================
-- LO QUE NO HACE
-- ============================================================
--
-- No hay depósitos, lotes ni series: el stock sigue siendo un saldo por
-- producto. Esto valoriza ese saldo; no lo divide. Multi-depósito es otra
-- fase y necesita la frontera de empresa antes.

-- ============================================================
-- 1. El valor en cada movimiento
-- ============================================================

alter table public.eos_erp_movimientos_stock
  add column if not exists costo_unitario numeric(16, 2),
  add column if not exists valor_resultante numeric(16, 2),
  add column if not exists costo_estimado boolean not null default false;

comment on column public.eos_erp_movimientos_stock.costo_unitario is
  'v108: a cuánto entró o salió cada unidad, con IVA incluido. Null en movimientos viejos que no lo registraron.';
comment on column public.eos_erp_movimientos_stock.valor_resultante is
  'v108: cuánto valía el stock del producto DESPUÉS de este movimiento, al promedio móvil del momento.';
comment on column public.eos_erp_movimientos_stock.costo_estimado is
  'v108: true cuando el costo no se conocía y se rellenó con el del producto. Un valor estimado no se presenta como medido.';

-- ============================================================
-- 2. El promedio móvil del producto
-- ============================================================

alter table public.eos_erp_productos
  add column if not exists costo_promedio numeric(16, 2);

comment on column public.eos_erp_productos.costo_promedio is
  'v108: promedio ponderado de lo que hay en stock, para VALORIZAR. Distinto de `costo`, que es el último pagado y se usa para precios y para congelar en la venta.';

-- ============================================================
-- 3. Mantener el promedio en cada movimiento
-- ============================================================
--
-- La fórmula del PPP, en una entrada:
--
--   nuevo_promedio = (stock_previo * promedio_previo + cantidad * costo_nuevo)
--                    / (stock_previo + cantidad)
--
-- En una SALIDA el promedio no cambia: sacar mercadería no altera lo que
-- costó la que queda. Es el error clásico del PPP mal implementado y por eso
-- la salida solo recalcula el valor, nunca el promedio.
--
-- Con stock previo <= 0 el promedio anterior no significa nada (no había nada
-- que promediar), así que el costo nuevo pasa a ser el promedio entero.

create or replace function public.eos_erp_kardex_valorizar_v108()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock_previo numeric;
  v_promedio_previo numeric;
  v_costo numeric;
  v_promedio numeric;
begin
  select p.costo_promedio, p.costo
  into v_promedio_previo, v_costo
  from public.eos_erp_productos p
  where p.id = new.producto_id;

  if not found then
    return new;
  end if;

  /*
   * El stock previo se DERIVA de `saldo_resultante`, no se lee del producto.
   *
   * Este trigger corre en medio de la transacción de la venta o la compra, y
   * ahí `productos.stock_actual` puede estar ya actualizado o todavía no
   * según el orden interno de cada RPC. `saldo_resultante` viene en la propia
   * fila y dice sin ambigüedad cómo quedó el saldo DESPUÉS: restarle el
   * movimiento devuelve el de antes.
   *
   * En un ajuste no se puede inferir —`cantidad` es un delta que puede venir
   * de un conteo— y queda en null. No importa: el promedio solo se recalcula
   * en las entradas.
   */
  v_stock_previo := case
    when new.tipo = 'entrada' then coalesce(new.saldo_resultante, 0) - coalesce(new.cantidad, 0)
    when new.tipo = 'salida' then coalesce(new.saldo_resultante, 0) + coalesce(new.cantidad, 0)
    else null
  end;

  -- El costo del movimiento: el que vino, o el último conocido del producto.
  -- Cuando se rellena, se marca como estimado: un número que se dedujo no se
  -- puede presentar igual que uno que se midió.
  if new.costo_unitario is null then
    new.costo_unitario := v_costo;
    new.costo_estimado := v_costo is not null;
  end if;

  v_promedio := coalesce(v_promedio_previo, v_costo);

  if new.tipo = 'entrada' and new.costo_unitario is not null and new.cantidad > 0 then
    if v_stock_previo is not null and v_stock_previo > 0 and v_promedio_previo is not null then
      v_promedio := (v_stock_previo * v_promedio_previo + new.cantidad * new.costo_unitario)
                    / (v_stock_previo + new.cantidad);
    else
      v_promedio := new.costo_unitario;
    end if;

    update public.eos_erp_productos
    set costo_promedio = round(v_promedio, 2)
    where id = new.producto_id;
  end if;

  new.valor_resultante := case
    when v_promedio is null then null
    else round(coalesce(new.saldo_resultante, 0) * v_promedio, 2)
  end;

  return new;
end;
$$;

drop trigger if exists eos_erp_kardex_valorizar on public.eos_erp_movimientos_stock;
create trigger eos_erp_kardex_valorizar
  before insert on public.eos_erp_movimientos_stock
  for each row
  execute function public.eos_erp_kardex_valorizar_v108();

-- ============================================================
-- 4. El punto de partida
-- ============================================================
--
-- Los productos que ya tienen costo arrancan con ese mismo valor como
-- promedio: es lo único que se sabe de ellos. Los movimientos ya registrados
-- NO se rellenan hacia atrás — no hay con qué, y un valor inventado en un
-- kardex es peor que un hueco, porque el hueco se ve.

update public.eos_erp_productos
set costo_promedio = costo
where costo is not null and costo_promedio is null;

-- ============================================================
-- 5. El valor del inventario, hoy
-- ============================================================

create or replace function public.eos_erp_valor_inventario_v108(p_usuario_id uuid)
returns table (moneda text, valor numeric, productos bigint, sin_costo bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(p.moneda, 'PYG') as moneda,
    coalesce(sum(p.stock_actual * p.costo_promedio) filter (where p.costo_promedio is not null), 0) as valor,
    count(*) as productos,
    count(*) filter (where p.costo_promedio is null) as sin_costo
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and p.controla_stock
  group by coalesce(p.moneda, 'PYG');
$$;

revoke all on function public.eos_erp_valor_inventario_v108(uuid) from public, anon, authenticated;
grant execute on function public.eos_erp_valor_inventario_v108(uuid) to service_role;
