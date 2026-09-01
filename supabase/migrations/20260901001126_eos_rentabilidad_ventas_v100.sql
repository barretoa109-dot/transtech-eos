-- EOS ERP — costo histórico y margen real de cada venta (v100).
--
-- El precio vendido ya quedaba congelado en el ítem, pero el costo no. Usar
-- el costo actual para una venta vieja reescribe el margen cada vez que cambia
-- el proveedor. Desde esta migración cada línea conserva el costo conocido al
-- vender. Lo anterior se completa con el costo actual y queda marcado como
-- estimado para no presentarlo como una certeza contable.

alter table public.eos_erp_venta_items
  add column if not exists costo_unitario numeric(16,2),
  add column if not exists costo_estimado boolean not null default false;

update public.eos_erp_venta_items vi
set costo_unitario = p.costo,
    costo_estimado = true
from public.eos_erp_productos p
where vi.producto_id = p.id
  and vi.costo_unitario is null
  and p.costo is not null;

alter table public.eos_erp_venta_items
  drop constraint if exists eos_erp_venta_items_costo_valido_v100;
alter table public.eos_erp_venta_items
  add constraint eos_erp_venta_items_costo_valido_v100
  check (costo_unitario is null or (
    costo_unitario not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and costo_unitario >= 0
  ));

create or replace function public.eos_erp_capturar_costo_venta_v100()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.producto_id is null then
    new.costo_unitario := null;
    new.costo_estimado := false;
    return new;
  end if;

  select p.costo into new.costo_unitario
  from public.eos_erp_productos p
  where p.id = new.producto_id;

  new.costo_estimado := false;
  return new;
end;
$$;

revoke all on function public.eos_erp_capturar_costo_venta_v100()
  from public, anon, authenticated;

drop trigger if exists eos_erp_venta_item_costo_v100 on public.eos_erp_venta_items;
create trigger eos_erp_venta_item_costo_v100
  before insert on public.eos_erp_venta_items
  for each row execute function public.eos_erp_capturar_costo_venta_v100();

comment on column public.eos_erp_venta_items.costo_unitario is
  'Costo conocido del producto al registrar la venta. NULL significa que no había costo verificable.';
comment on column public.eos_erp_venta_items.costo_estimado is
  'TRUE únicamente para ventas históricas completadas con el costo actual durante la v100.';

grant select (costo_unitario, costo_estimado)
  on public.eos_erp_venta_items to authenticated, service_role;
