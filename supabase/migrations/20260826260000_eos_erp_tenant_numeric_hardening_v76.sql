-- EOS ERP/CRM v76 — las relaciones también pertenecen al usuario
--
-- RLS protege la fila que se está escribiendo, pero una FK simple solo prueba
-- que el UUID referenciado exista. No prueba que el contacto, la oportunidad o
-- el producto sean de la misma cuenta. Como ventas y compras se registran con
-- funciones SECURITY DEFINER, confiar en RLS para esa segunda comprobación es
-- especialmente peligroso: esas funciones la omiten por diseño.
--
-- Los triggers de esta migración convierten la pertenencia en una propiedad de
-- la base, no de una ruta concreta. Así cubren por igual la UI, EOS/n8n, RPCs y
-- cualquier integración futura. Todos son BEFORE: el rechazo ocurre antes del
-- primer efecto de la fila; si un precio inválido aparece después de crear la
-- cabecera dentro de un RPC, la excepción revierte la transacción completa.

-- ============================================================
-- 1) Ningún numeric protegido puede ser infinito, NaN ni negativo
-- ============================================================
--
-- PostgreSQL admite `NaN`, `Infinity` y `-Infinity` en numeric. Las
-- comparaciones de rango no excluyen todos esos valores, por lo que cada
-- restricción los rechaza de manera explícita.
--
-- `not valid` evita que un dato histórico inesperado bloquee todo el despliegue;
-- PostgreSQL igualmente exige la regla a cada INSERT/UPDATE nuevo. Los RPC de
-- venta/compra quedan protegidos desde que termina esta migración.

alter table public.eos_erp_venta_items
  drop constraint if exists eos_erp_venta_items_precio_valido_v76;
alter table public.eos_erp_venta_items
  add constraint eos_erp_venta_items_precio_valido_v76
  check (
    cantidad not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and cantidad > 0
    and precio_unitario not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and precio_unitario >= 0
    and total not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and total >= 0
  )
  not valid;

alter table public.eos_erp_compra_items
  drop constraint if exists eos_erp_compra_items_precio_valido_v76;
alter table public.eos_erp_compra_items
  add constraint eos_erp_compra_items_precio_valido_v76
  check (
    cantidad not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and cantidad > 0
    and precio_unitario not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and precio_unitario >= 0
    and total not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and total >= 0
  )
  not valid;

-- Los RPC toman el precio del producto cuando el ítem no lo trae. Esos campos
-- son otra entrada al mismo cálculo y necesitan la misma defensa.
alter table public.eos_erp_productos
  drop constraint if exists eos_erp_productos_precios_validos_v76;
alter table public.eos_erp_productos
  add constraint eos_erp_productos_precios_validos_v76
  check (
    costo not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and costo >= 0
    and precio_venta not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and precio_venta >= 0
    -- El saldo puede ser negativo para representar faltantes de inventario.
    and stock_actual not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and stock_minimo not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and stock_minimo >= 0
  ) not valid;

alter table public.eos_erp_ventas
  drop constraint if exists eos_erp_ventas_totales_validos_v76;
alter table public.eos_erp_ventas
  add constraint eos_erp_ventas_totales_validos_v76
  check (
    subtotal not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and subtotal >= 0
    and iva_total not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and iva_total >= 0
    and total not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and total >= 0
  ) not valid;

alter table public.eos_erp_compras
  drop constraint if exists eos_erp_compras_totales_validos_v76;
alter table public.eos_erp_compras
  add constraint eos_erp_compras_totales_validos_v76
  check (
    subtotal not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and subtotal >= 0
    and iva_total not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and iva_total >= 0
    and total not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and total >= 0
  ) not valid;

alter table public.eos_crm_oportunidades
  drop constraint if exists eos_crm_oportunidades_monto_valido_v76;
alter table public.eos_crm_oportunidades
  add constraint eos_crm_oportunidades_monto_valido_v76
  check (
    monto not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and monto >= 0
  ) not valid;

-- ============================================================
-- 2) Preflight: no esconder relaciones históricas inválidas
-- ============================================================
--
-- Los triggers protegen el futuro. Una relación ajena preexistente, en cambio,
-- debe investigarse: aceptarla silenciosamente dejaría vivo exactamente el
-- aislamiento que esta migración pretende cerrar.

do $$
declare
  v_ventas bigint;
  v_compras bigint;
  v_oportunidades bigint;
  v_actividades_contacto bigint;
  v_actividades_oportunidad bigint;
  v_actividades_inconsistentes bigint;
  v_items_venta bigint;
  v_items_compra bigint;
  v_stock bigint;
begin
  select count(*) into v_ventas
  from public.eos_erp_ventas v
  join public.eos_crm_contactos c on c.id = v.contacto_id
  where c.usuario_id <> v.usuario_id;

  select count(*) into v_compras
  from public.eos_erp_compras cpr
  join public.eos_crm_contactos c on c.id = cpr.contacto_id
  where c.usuario_id <> cpr.usuario_id;

  select count(*) into v_oportunidades
  from public.eos_crm_oportunidades o
  join public.eos_crm_contactos c on c.id = o.contacto_id
  where c.usuario_id <> o.usuario_id;

  select count(*) into v_actividades_contacto
  from public.eos_crm_actividades a
  join public.eos_crm_contactos c on c.id = a.contacto_id
  where c.usuario_id <> a.usuario_id;

  select count(*) into v_actividades_oportunidad
  from public.eos_crm_actividades a
  join public.eos_crm_oportunidades o on o.id = a.oportunidad_id
  where o.usuario_id <> a.usuario_id;

  select count(*) into v_actividades_inconsistentes
  from public.eos_crm_actividades a
  join public.eos_crm_oportunidades o on o.id = a.oportunidad_id
  where a.contacto_id is not null
    and o.contacto_id is not null
    and a.contacto_id <> o.contacto_id;

  select count(*) into v_items_venta
  from public.eos_erp_venta_items i
  join public.eos_erp_ventas v on v.id = i.venta_id
  join public.eos_erp_productos p on p.id = i.producto_id
  where p.usuario_id <> v.usuario_id;

  select count(*) into v_items_compra
  from public.eos_erp_compra_items i
  join public.eos_erp_compras c on c.id = i.compra_id
  join public.eos_erp_productos p on p.id = i.producto_id
  where p.usuario_id <> c.usuario_id;

  select count(*) into v_stock
  from public.eos_erp_movimientos_stock m
  join public.eos_erp_productos p on p.id = m.producto_id
  where p.usuario_id <> m.usuario_id;

  if v_ventas + v_compras + v_oportunidades + v_actividades_contacto
     + v_actividades_oportunidad + v_actividades_inconsistentes
     + v_items_venta + v_items_compra + v_stock > 0 then
    raise exception
      'EOS_V76_RELACIONES_HISTORICAS_INVALIDAS ventas=% compras=% oportunidades=% actividades_contacto=% actividades_oportunidad=% actividades_inconsistentes=% items_venta=% items_compra=% stock=%',
      v_ventas, v_compras, v_oportunidades, v_actividades_contacto,
      v_actividades_oportunidad, v_actividades_inconsistentes,
      v_items_venta, v_items_compra, v_stock;
  end if;
end $$;

-- ============================================================
-- 3) Contactos de ventas, compras y oportunidades
-- ============================================================

create or replace function public.eos_validar_contacto_propio_v76()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contacto_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.eos_crm_contactos c
    where c.id = new.contacto_id
      and c.usuario_id = new.usuario_id
  ) then
    raise exception 'EOS_CONTACTO_AJENO';
  end if;

  return new;
end;
$$;

revoke all on function public.eos_validar_contacto_propio_v76() from public, anon, authenticated;

drop trigger if exists eos_erp_ventas_contacto_propio_v76 on public.eos_erp_ventas;
create trigger eos_erp_ventas_contacto_propio_v76
  before insert or update of usuario_id, contacto_id on public.eos_erp_ventas
  for each row execute function public.eos_validar_contacto_propio_v76();

drop trigger if exists eos_erp_compras_contacto_propio_v76 on public.eos_erp_compras;
create trigger eos_erp_compras_contacto_propio_v76
  before insert or update of usuario_id, contacto_id on public.eos_erp_compras
  for each row execute function public.eos_validar_contacto_propio_v76();

drop trigger if exists eos_crm_oportunidades_contacto_propio_v76 on public.eos_crm_oportunidades;
create trigger eos_crm_oportunidades_contacto_propio_v76
  before insert or update of usuario_id, contacto_id on public.eos_crm_oportunidades
  for each row execute function public.eos_validar_contacto_propio_v76();

-- ============================================================
-- 4) Relaciones de actividades CRM
-- ============================================================

create or replace function public.eos_validar_actividad_relaciones_v76()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contacto_oportunidad uuid;
begin
  if new.contacto_id is not null and not exists (
    select 1
    from public.eos_crm_contactos c
    where c.id = new.contacto_id
      and c.usuario_id = new.usuario_id
  ) then
    raise exception 'EOS_CONTACTO_AJENO';
  end if;

  if new.oportunidad_id is not null then
    select o.contacto_id
      into v_contacto_oportunidad
    from public.eos_crm_oportunidades o
    where o.id = new.oportunidad_id
      and o.usuario_id = new.usuario_id;

    if not found then
      raise exception 'EOS_OPORTUNIDAD_AJENA';
    end if;

    -- Si se declaran las dos relaciones, no pueden apuntar a personas
    -- distintas. Una oportunidad sin contacto sí admite una actividad con uno.
    if new.contacto_id is not null
       and v_contacto_oportunidad is not null
       and new.contacto_id <> v_contacto_oportunidad then
      raise exception 'EOS_ACTIVIDAD_RELACIONES_INCONSISTENTES';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.eos_validar_actividad_relaciones_v76() from public, anon, authenticated;

drop trigger if exists eos_crm_actividades_relaciones_v76 on public.eos_crm_actividades;
create trigger eos_crm_actividades_relaciones_v76
  before insert or update of usuario_id, contacto_id, oportunidad_id
  on public.eos_crm_actividades
  for each row execute function public.eos_validar_actividad_relaciones_v76();

-- ============================================================
-- 5) Productos de ítems y movimientos de stock
-- ============================================================

create or replace function public.eos_validar_producto_item_v76()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario_id uuid;
begin
  if new.producto_id is null then
    return new;
  end if;

  if tg_table_name = 'eos_erp_venta_items' then
    select v.usuario_id into v_usuario_id
    from public.eos_erp_ventas v
    where v.id = new.venta_id;
  elsif tg_table_name = 'eos_erp_compra_items' then
    select c.usuario_id into v_usuario_id
    from public.eos_erp_compras c
    where c.id = new.compra_id;
  else
    raise exception 'EOS_V76_TABLA_ITEM_NO_SOPORTADA';
  end if;

  if v_usuario_id is null or not exists (
    select 1 from public.eos_erp_productos p
    where p.id = new.producto_id and p.usuario_id = v_usuario_id
  ) then
    raise exception 'EOS_PRODUCTO_AJENO';
  end if;

  return new;
end;
$$;

revoke all on function public.eos_validar_producto_item_v76() from public, anon, authenticated;

drop trigger if exists eos_erp_venta_items_producto_propio_v76 on public.eos_erp_venta_items;
create trigger eos_erp_venta_items_producto_propio_v76
  before insert or update of venta_id, producto_id on public.eos_erp_venta_items
  for each row execute function public.eos_validar_producto_item_v76();

drop trigger if exists eos_erp_compra_items_producto_propio_v76 on public.eos_erp_compra_items;
create trigger eos_erp_compra_items_producto_propio_v76
  before insert or update of compra_id, producto_id on public.eos_erp_compra_items
  for each row execute function public.eos_validar_producto_item_v76();

create or replace function public.eos_validar_producto_stock_v76()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.eos_erp_productos p
    where p.id = new.producto_id and p.usuario_id = new.usuario_id
  ) then
    raise exception 'EOS_PRODUCTO_AJENO';
  end if;
  return new;
end;
$$;

revoke all on function public.eos_validar_producto_stock_v76() from public, anon, authenticated;

drop trigger if exists eos_erp_movimientos_stock_producto_propio_v76
  on public.eos_erp_movimientos_stock;
create trigger eos_erp_movimientos_stock_producto_propio_v76
  before insert or update of usuario_id, producto_id on public.eos_erp_movimientos_stock
  for each row execute function public.eos_validar_producto_stock_v76();

-- ============================================================
-- 6) Solo se puede iniciar o reutilizar un cobro de un armado cobrable
-- ============================================================
--
-- `pendiente` es una compra inicial. `vigente` es una renovación. Los estados
-- reemplazado y cancelado son deliberadamente inválidos aunque el usuario
-- conserve una URL vieja. La allowlist hace que cualquier estado futuro nazca
-- cerrado hasta decidir explícitamente qué significa para cobros.

create or replace function public.eos_validar_armado_cobrable_v76()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_armado_id uuid;
begin
  if not (coalesce(new.metadata, '{}'::jsonb) ? 'armado_id') then
    return new;
  end if;

  begin
    v_armado_id := (new.metadata ->> 'armado_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'EOS_ARMADO_ID_INVALIDO';
  end;

  if not exists (
    select 1
    from public.eos_planes_armados a
    where a.id = v_armado_id
      and a.usuario_id = new.usuario_id
      and a.estado in ('pendiente', 'vigente')
  ) then
    raise exception 'EOS_ARMADO_ESTADO_NO_COBRABLE';
  end if;

  return new;
end;
$$;

revoke all on function public.eos_validar_armado_cobrable_v76() from public, anon, authenticated;

drop trigger if exists eos_solicitudes_pago_armado_cobrable_v76 on public.solicitudes_pago;
create trigger eos_solicitudes_pago_armado_cobrable_v76
  before insert on public.solicitudes_pago
  for each row execute function public.eos_validar_armado_cobrable_v76();

-- Transferencia reutiliza una solicitud pendiente actualizando metadata en vez
-- de insertar otra. Se valida esa segunda puerta, pero NO los cambios de estado:
-- un webhook posterior a un cobro real nunca debe quedar bloqueado.
drop trigger if exists eos_solicitudes_pago_armado_reutilizable_v76 on public.solicitudes_pago;
create trigger eos_solicitudes_pago_armado_reutilizable_v76
  before update of metadata on public.solicitudes_pago
  for each row
  when (
    old.estado = 'pendiente_transferencia'
    and new.estado = 'pendiente_transferencia'
    and lower(coalesce(new.proveedor, '')) = 'transferencia'
    and (old.metadata ->> 'last_reused_at') is distinct from (new.metadata ->> 'last_reused_at')
  )
  execute function public.eos_validar_armado_cobrable_v76();

comment on function public.eos_validar_armado_cobrable_v76() is
  'Permite iniciar cobros solo para armados pendientes (alta) o vigentes (renovación).';
