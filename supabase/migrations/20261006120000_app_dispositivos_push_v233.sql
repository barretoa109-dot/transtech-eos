-- v233: dispositivos de la app nativa para notificaciones push (06/10/2026).
--
-- Cada teléfono con la app instalada registra su token de push acá, asociado
-- a la persona. El envío (APNs / FCM) lo hace el servidor con service_role.
--
-- Una persona puede tener varios teléfonos; un token es único en el sistema.
-- Al cerrar sesión o desinstalar, el token se borra con la ruta
-- /api/push/dispositivo. Si el token ya no sirve, FCM lo informa y el envío
-- lo borra.
--
-- Solo service_role (regla de datos de personas: ver docs/app-nativa/tiendas.md).
-- Rollback: drop table public.dispositivos_push.

create table if not exists public.dispositivos_push (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  plataforma text not null check (plataforma in ('ios', 'android')),
  token text not null unique check (length(token) between 16 and 4096),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists dispositivos_push_usuario_idx
  on public.dispositivos_push (usuario_id);

alter table public.dispositivos_push enable row level security;
revoke all on table public.dispositivos_push from public, anon, authenticated;
grant select, insert, update, delete on table public.dispositivos_push to service_role;
grant usage on sequence public.dispositivos_push_id_seq to service_role;

comment on table public.dispositivos_push is
  'Tokens de push de la app nativa, por persona y teléfono. Solo service_role.';
