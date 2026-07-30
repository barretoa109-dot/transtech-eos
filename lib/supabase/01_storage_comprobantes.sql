-- Ejecutar una sola vez en Supabase SQL Editor.
-- El bucket queda privado; los comprobantes solamente se manipulan desde el servidor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes-pago',
  'comprobantes-pago',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No se crean políticas públicas porque la carga se realiza
-- con el cliente administrador del servidor.
