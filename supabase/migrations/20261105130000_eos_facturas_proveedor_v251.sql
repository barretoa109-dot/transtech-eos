-- EOS ERP — facturas de proveedores leídas del correo
--
-- Pilar 3 del documento de visión de tecnología (04/11): "visión por
-- computadora para tickets/facturas en papel". Cuando un proveedor que ya
-- factura electrónicamente manda el KuDE por correo al mismo buzón de
-- ingesta que ya existe para los avisos bancarios ([[eos-finanzas-buzon-v53]]),
-- EOS lo lee y propone una compra — el dueño la confirma con un toque, nunca
-- se registra sola.
--
-- No se parsea el XML del Documento Electrónico de SIFEN (ese schema no está
-- verificado contra ningún ejemplo real en este repo todavía): se lee el
-- KuDE con visión, con el mismo criterio conservador que ya rige los
-- comprobantes de pago y los avisos bancarios descartados.

create table if not exists public.eos_facturas_recibidas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  -- Puede no resolverse (usuario sin empresa todavía): la fila igual se
  -- guarda para que la vea, pero no se puede confirmar como compra sin esto.
  empresa_id uuid references public.eos_empresas(id) on delete set null,
  email_id text not null,
  attachment_id text,
  proveedor_ruc text,
  proveedor_nombre text,
  numero_documento text,
  cdc text,
  fecha date,
  moneda text not null default 'PYG' check (moneda in ('PYG', 'USD')),
  total numeric not null check (total > 0),
  iva_tasa smallint not null default 0 check (iva_tasa in (0, 5, 10)),
  confianza numeric,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'descartada')),
  -- Se completa al confirmar: la compra real que se terminó registrando.
  compra_id uuid references public.eos_erp_compras(id) on delete set null,
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz
);

comment on table public.eos_facturas_recibidas is
  'Facturas de proveedores leídas de un adjunto de correo (KuDE), propuestas para confirmar como compra. Nunca se registran solas.';

-- Un mismo correo no genera dos propuestas aunque Resend reintente.
create unique index if not exists eos_facturas_recibidas_email_idx
  on public.eos_facturas_recibidas (email_id);

create index if not exists eos_facturas_recibidas_pendientes_idx
  on public.eos_facturas_recibidas (usuario_id, creado_en desc)
  where estado = 'pendiente';

alter table public.eos_facturas_recibidas enable row level security;

-- Lectura para el dueño; sin policy de escritura para `authenticated` a
-- propósito, mismo criterio que `eos_correos_entrantes`: el webhook escribe
-- con service_role, y confirmar/descartar pasa por la API (que también usa
-- service_role, con el filtro por usuario_id explícito en la ruta).
drop policy if exists facturas_recibidas_select on public.eos_facturas_recibidas;
create policy facturas_recibidas_select on public.eos_facturas_recibidas
  for select to authenticated using ((select auth.uid()) = usuario_id);
