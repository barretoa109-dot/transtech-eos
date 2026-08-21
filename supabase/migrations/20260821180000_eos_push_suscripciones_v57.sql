-- EOS — suscripciones de notificaciones push (Web Push / VAPID)
--
-- El briefing por correo ya sale solo, pero el correo se lee cuando uno abre
-- el correo. El push llega al teléfono. Es el canal que convierte a EOS en
-- algo presente en el día y no en una pestaña que uno recuerda visitar.
--
-- Se usa Web Push estándar y no FCM a propósito: **no depende de las tiendas**.
-- Funciona hoy en Chrome/Edge/Firefox de escritorio y Android, y en iOS 16.4+
-- para la PWA instalada. No hace falta esperar al D-U-N-S.
--
-- Un usuario puede tener varias suscripciones: el navegador del teléfono, el
-- de la notebook, la PWA instalada. Cada endpoint es una fila distinta.

create table if not exists public.eos_push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  -- Identifica de forma única al navegador/dispositivo ante el servicio de
  -- push. Es la clave natural: si el mismo navegador se resuscribe, debe
  -- actualizar su fila y no crear una nueva.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,

  -- Para poder decirle al usuario qué dispositivo es cuál si algún día
  -- listamos sus sesiones. Se guarda recortado.
  user_agent text,

  -- Los servicios de push responden 404/410 cuando una suscripción murió
  -- (el usuario revocó el permiso, desinstaló la PWA, limpió el navegador).
  -- Se marcan en vez de borrarse en el acto, para poder distinguir "nunca se
  -- suscribió" de "se suscribió y se fue".
  activa boolean not null default true,
  ultimo_error text,
  ultimo_envio_en timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists eos_push_usuario_idx
  on public.eos_push_suscripciones (usuario_id) where activa;

comment on table public.eos_push_suscripciones is
  'Suscripciones Web Push por dispositivo. Se usa VAPID y no FCM porque no depende de las tiendas.';

-- ============================================================
-- RLS: el usuario administra las suyas; el cron escribe con service_role.
-- ============================================================
alter table public.eos_push_suscripciones enable row level security;

drop policy if exists push_suscripciones_select on public.eos_push_suscripciones;
create policy push_suscripciones_select on public.eos_push_suscripciones
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists push_suscripciones_insert on public.eos_push_suscripciones;
create policy push_suscripciones_insert on public.eos_push_suscripciones
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists push_suscripciones_update on public.eos_push_suscripciones;
create policy push_suscripciones_update on public.eos_push_suscripciones
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

-- Poder darse de baja es tan importante como poder suscribirse.
drop policy if exists push_suscripciones_delete on public.eos_push_suscripciones;
create policy push_suscripciones_delete on public.eos_push_suscripciones
  for delete to authenticated using ((select auth.uid()) = usuario_id);
