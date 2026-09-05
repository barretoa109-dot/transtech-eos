-- ============================================================
-- Punto 32 de la lista de lanzamiento: importar el catálogo no puede
-- duplicarse si el mismo "Importar" se envía dos veces.
-- ============================================================
--
-- `eos_erp_productos` solo tiene `unique (usuario_id, codigo)`, y `codigo` es
-- opcional: la planilla más común (una pyme sin SKU) no lo trae, así que esa
-- restricción no protege nada. Si la respuesta del primer POST se pierde
-- (la conexión se corta después de insertar, antes de que el navegador la
-- reciba) el usuario ve un error y aprieta "Importar" de nuevo: sin esta
-- tabla, esa segunda llamada duplica el catálogo entero, silenciosamente.
--
-- La corrección sigue el mismo patrón que ya existe para pagos y comandos del
-- chat: una clave que el cliente genera UNA vez por intento de importación y
-- reenvía si reintenta. La primera vez que se ve esa clave, se importa; la
-- segunda, se devuelve el resultado que ya quedó guardado.

create table if not exists public.eos_erp_importaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  clave uuid not null,
  importados integer not null,
  creado_en timestamptz not null default now(),

  constraint eos_erp_importaciones_clave_uniq unique (usuario_id, clave)
);

comment on table public.eos_erp_importaciones is
  'Ledger de idempotencia de "Traer desde una planilla": una fila por clave de intento, para que reenviar el mismo intento no duplique productos.';

alter table public.eos_erp_importaciones enable row level security;

-- Sin políticas para authenticated: es un detalle interno del servidor, no
-- algo que el usuario necesite leer directamente.
revoke all on table public.eos_erp_importaciones from anon, authenticated;
grant select, insert on table public.eos_erp_importaciones to service_role;
