-- EOS — ERP y CRM para el que factura desde el celular
--
-- ============================================================
-- PARA QUIÉN ES ESTO
-- ============================================================
--
-- No es un ERP de manual. El usuario lo pidió para "emprendedores y PYMEs, para
-- que todo lo tengan dentro de nuestro ecosistema", y esa gente no tiene un
-- departamento de sistemas: tiene un cuaderno, un WhatsApp lleno de pedidos y
-- una carpeta de facturas. Todo lo de acá está pensado para reemplazar ESO, no
-- para competir con SAP.
--
-- De ahí tres decisiones que se notan en el modelo:
--
--  1. **Un cliente y un proveedor son la misma tabla.** En una PYME paraguaya
--     la misma persona te compra y te vende. Dos tablas obligarían a cargarla
--     dos veces y a que se desincronicen los datos.
--  2. **El stock es opcional por producto.** Quien vende servicios no tiene
--     stock, y obligarlo a llevar uno lo hace abandonar el módulo en la primera
--     semana.
--  3. **Una venta que se cobra cae en Finanzas.** Si la venta vive en una tabla
--     y la plata en otra, el panel financiero vuelve a mentir — que es
--     exactamente el problema que EOS existe para no causar.
--
-- ============================================================
-- POR QUÉ EL IVA VA CALCULADO Y NO SUMADO
-- ============================================================
--
-- En Paraguay los precios se dicen CON IVA INCLUIDO. "Cinco mil guaraníes" son
-- cinco mil que paga el cliente, y de ahí adentro salen 454 de IVA al 10%. El
-- error clásico es guardarlo al revés —sumarle el 10% al precio— y facturar un
-- 10% de más. Por eso `precio_venta` es SIEMPRE el precio final y el impuesto
-- se deriva: iva10 = total / 11, iva5 = total / 21.

-- ============================================================
-- 1) CRM — la gente
-- ============================================================

create table if not exists public.eos_crm_contactos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  tipo text not null default 'persona' check (tipo in ('persona', 'empresa')),
  nombre text not null check (length(btrim(nombre)) between 1 and 160),

  -- El RUC con su dígito verificador separado, como lo pide la SET. Sin RUC no
  -- se puede facturar electrónicamente a esta persona, pero sí venderle: en el
  -- mostrador la mayoría compra sin dar RUC.
  ruc text,
  ruc_dv smallint check (ruc_dv is null or ruc_dv between 0 and 9),
  documento text,

  email text,
  telefono text,
  direccion text,
  ciudad text,

  -- Qué es para el usuario. Una misma persona puede ser las dos cosas.
  es_cliente boolean not null default true,
  es_proveedor boolean not null default false,

  etiquetas text[] not null default '{}',
  notas text,

  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists eos_crm_contactos_usuario_idx
  on public.eos_crm_contactos (usuario_id, nombre);

comment on table public.eos_crm_contactos is
  'Clientes y proveedores en una sola tabla: en una PYME la misma persona te compra y te vende.';

-- ------------------------------------------------------------
-- Oportunidades: lo que todavía no es una venta.
-- ------------------------------------------------------------
--
-- Las etapas son cinco y no diez a propósito. Un embudo de diez etapas se
-- abandona: nadie mueve tarjetas todos los días. Con cinco, mover una es una
-- decisión de verdad y el embudo dice algo.

create table if not exists public.eos_crm_oportunidades (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  contacto_id uuid references public.eos_crm_contactos(id) on delete set null,

  titulo text not null check (length(btrim(titulo)) between 1 and 200),
  detalle text,

  monto numeric(16,2) not null default 0 check (monto >= 0),
  moneda text not null default 'PYG',

  etapa text not null default 'nueva'
    check (etapa in ('nueva', 'contactado', 'propuesta', 'negociacion', 'ganada', 'perdida')),

  cierre_estimado date,
  motivo_perdida text,

  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  cerrada_en timestamptz
);

create index if not exists eos_crm_oportunidades_usuario_idx
  on public.eos_crm_oportunidades (usuario_id, etapa, cierre_estimado);

-- ------------------------------------------------------------
-- Actividades: lo que se habló y lo que hay que hacer.
-- ------------------------------------------------------------

create table if not exists public.eos_crm_actividades (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  contacto_id uuid references public.eos_crm_contactos(id) on delete cascade,
  oportunidad_id uuid references public.eos_crm_oportunidades(id) on delete cascade,

  tipo text not null default 'nota'
    check (tipo in ('llamada', 'reunion', 'correo', 'whatsapp', 'nota', 'tarea')),
  detalle text not null check (length(btrim(detalle)) between 1 and 4000),

  -- Una tarea tiene fecha futura y se marca hecha; una nota es del pasado y
  -- nace hecha. La misma tabla sirve para las dos porque el usuario no piensa
  -- en dos listas distintas: piensa en "lo del cliente".
  fecha date not null default current_date,
  hecha boolean not null default true,

  creado_en timestamptz not null default now()
);

create index if not exists eos_crm_actividades_pendientes_idx
  on public.eos_crm_actividades (usuario_id, fecha)
  where hecha = false;

-- ============================================================
-- 2) ERP — las cosas
-- ============================================================

create table if not exists public.eos_erp_productos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  codigo text,
  nombre text not null check (length(btrim(nombre)) between 1 and 200),
  descripcion text,
  unidad text not null default 'unidad',

  -- SIEMPRE con IVA incluido. Ver el comentario de cabecera.
  precio_venta numeric(16,2) not null default 0 check (precio_venta >= 0),
  costo numeric(16,2),
  moneda text not null default 'PYG',

  -- 10, 5 o 0. Son las tres tasas que existen en Paraguay.
  iva smallint not null default 10 check (iva in (0, 5, 10)),

  -- Quien vende servicios no lleva stock, y obligarlo a llevarlo lo hace
  -- abandonar el módulo en la primera semana.
  controla_stock boolean not null default false,
  stock_actual numeric(16,3) not null default 0,
  stock_minimo numeric(16,3) not null default 0,

  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint eos_erp_productos_codigo_uniq unique (usuario_id, codigo)
);

create index if not exists eos_erp_productos_usuario_idx
  on public.eos_erp_productos (usuario_id, nombre) where activo;

comment on column public.eos_erp_productos.precio_venta is
  'Precio FINAL, con IVA incluido, como se dice en Paraguay. El impuesto se deriva, nunca se suma.';

-- ------------------------------------------------------------
-- Cada movimiento de stock queda escrito.
-- ------------------------------------------------------------
--
-- El stock se guarda en el producto Y se registra acá. Es redundante a
-- propósito: el número del producto es el que se lee mil veces por pantalla, y
-- recalcularlo sumando el historial en cada consulta no escala. El historial
-- existe para poder auditar cómo se llegó a ese número el día que no cierre —
-- y ese día llega siempre.

create table if not exists public.eos_erp_movimientos_stock (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  producto_id uuid not null references public.eos_erp_productos(id) on delete cascade,

  tipo text not null check (tipo in ('entrada', 'salida', 'ajuste')),
  cantidad numeric(16,3) not null,
  saldo_resultante numeric(16,3),

  motivo text,
  referencia_tipo text check (referencia_tipo in ('venta', 'compra', 'manual', 'inventario')),
  referencia_id uuid,

  fecha date not null default current_date,
  creado_en timestamptz not null default now()
);

create index if not exists eos_erp_stock_producto_idx
  on public.eos_erp_movimientos_stock (producto_id, fecha desc);

-- ------------------------------------------------------------
-- Ventas y compras: la misma forma, dos direcciones.
-- ------------------------------------------------------------

create table if not exists public.eos_erp_ventas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  contacto_id uuid references public.eos_crm_contactos(id) on delete set null,

  fecha date not null default current_date,
  moneda text not null default 'PYG',

  -- Calculados a partir de los ítems y guardados: una venta emitida no puede
  -- cambiar de total porque alguien editó el precio de un producto después.
  subtotal numeric(16,2) not null default 0,
  iva_total numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,

  condicion text not null default 'contado' check (condicion in ('contado', 'credito')),
  estado text not null default 'borrador'
    check (estado in ('borrador', 'emitida', 'cobrada', 'anulada')),

  -- El puente con Finanzas. Cuando la venta se cobra, el ingreso aparece en el
  -- panel: si la venta viviera en una tabla y la plata en otra, el disponible
  -- real volvería a mentir.
  movimiento_id uuid references public.eos_movimientos_financieros(id) on delete set null,

  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists eos_erp_ventas_usuario_idx
  on public.eos_erp_ventas (usuario_id, fecha desc);

create table if not exists public.eos_erp_venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.eos_erp_ventas(id) on delete cascade,
  producto_id uuid references public.eos_erp_productos(id) on delete set null,

  -- La descripción se copia al vender. Si mañana el producto cambia de nombre,
  -- la factura vieja tiene que seguir diciendo lo que decía.
  descripcion text not null,
  cantidad numeric(16,3) not null check (cantidad > 0),
  precio_unitario numeric(16,2) not null check (precio_unitario >= 0),
  iva smallint not null default 10 check (iva in (0, 5, 10)),
  total numeric(16,2) not null default 0,

  orden smallint not null default 0
);

create index if not exists eos_erp_venta_items_venta_idx
  on public.eos_erp_venta_items (venta_id, orden);

create table if not exists public.eos_erp_compras (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  contacto_id uuid references public.eos_crm_contactos(id) on delete set null,

  fecha date not null default current_date,
  moneda text not null default 'PYG',
  numero_comprobante text,

  subtotal numeric(16,2) not null default 0,
  iva_total numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,

  condicion text not null default 'contado' check (condicion in ('contado', 'credito')),
  estado text not null default 'registrada'
    check (estado in ('registrada', 'pagada', 'anulada')),

  movimiento_id uuid references public.eos_movimientos_financieros(id) on delete set null,

  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists eos_erp_compras_usuario_idx
  on public.eos_erp_compras (usuario_id, fecha desc);

create table if not exists public.eos_erp_compra_items (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.eos_erp_compras(id) on delete cascade,
  producto_id uuid references public.eos_erp_productos(id) on delete set null,

  descripcion text not null,
  cantidad numeric(16,3) not null check (cantidad > 0),
  precio_unitario numeric(16,2) not null check (precio_unitario >= 0),
  iva smallint not null default 10 check (iva in (0, 5, 10)),
  total numeric(16,2) not null default 0,

  orden smallint not null default 0
);

create index if not exists eos_erp_compra_items_compra_idx
  on public.eos_erp_compra_items (compra_id, orden);

-- ============================================================
-- 3) RLS: cada usuario ve y escribe solo lo suyo
-- ============================================================
--
-- Las tablas de ítems no tienen `usuario_id`: cuelgan de su cabecera. Su
-- política pregunta por el dueño de la cabecera, que es la única forma de que
-- no se pueda insertar un ítem en la factura de otro pasando un `venta_id`
-- adivinado.

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array[
    'eos_crm_contactos', 'eos_crm_oportunidades', 'eos_crm_actividades',
    'eos_erp_productos', 'eos_erp_movimientos_stock',
    'eos_erp_ventas', 'eos_erp_compras'
  ] loop
    execute format('alter table public.%I enable row level security', v_tabla);

    execute format('drop policy if exists %I on public.%I', v_tabla || '_propio', v_tabla);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select auth.uid()) = usuario_id)
         with check ((select auth.uid()) = usuario_id)',
      v_tabla || '_propio', v_tabla
    );

    execute format('revoke all on table public.%I from anon, authenticated', v_tabla);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated, service_role',
      v_tabla
    );
  end loop;
end $$;

alter table public.eos_erp_venta_items enable row level security;

drop policy if exists eos_erp_venta_items_propio on public.eos_erp_venta_items;
create policy eos_erp_venta_items_propio on public.eos_erp_venta_items
  for all to authenticated
  using (
    exists (
      select 1 from public.eos_erp_ventas v
      where v.id = venta_id and v.usuario_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.eos_erp_ventas v
      where v.id = venta_id and v.usuario_id = (select auth.uid())
    )
  );

revoke all on table public.eos_erp_venta_items from anon, authenticated;
grant select, insert, update, delete on table public.eos_erp_venta_items
  to authenticated, service_role;

alter table public.eos_erp_compra_items enable row level security;

drop policy if exists eos_erp_compra_items_propio on public.eos_erp_compra_items;
create policy eos_erp_compra_items_propio on public.eos_erp_compra_items
  for all to authenticated
  using (
    exists (
      select 1 from public.eos_erp_compras c
      where c.id = compra_id and c.usuario_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.eos_erp_compras c
      where c.id = compra_id and c.usuario_id = (select auth.uid())
    )
  );

revoke all on table public.eos_erp_compra_items from anon, authenticated;
grant select, insert, update, delete on table public.eos_erp_compra_items
  to authenticated, service_role;
