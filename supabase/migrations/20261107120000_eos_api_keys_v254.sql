-- Developer Platform (ítem 25 del documento EOS 2030), primera pieza: una
-- clave de API por cuenta, SOLO para lectura. Ver
-- docs/arquitectura-developer-platform-2026-11-07.md para el diseño completo.
--
-- ============================================================
-- POR QUÉ UNA TABLA NUEVA Y NO EOS_WORKER_GATE_SECRET
-- ============================================================
--
-- Ese secreto es ÚNICO y compartido para toda la plataforma: sirve porque
-- solo infraestructura propia (n8n, el runtime del agente) lo tiene, y el
-- `usuario_id` lo dice QUIEN LLAMA. Expuesto a un desarrollador externo,
-- cualquiera con la clave podría pedir datos de cualquier cuenta. Acá es al
-- revés: cada clave resuelve a UN usuario_id fijo, grabado en esta tabla, y
-- nunca el que el llamante diga.
--
-- ============================================================
-- NUNCA SE GUARDA LA CLAVE EN TEXTO PLANO
-- ============================================================
--
-- Se guarda el hash SHA-256 (hexadecimal, con `extensions.digest`, ya usado
-- en el proyecto desde v61) y un prefijo corto y SIN SECRETO para que la
-- persona reconozca cuál clave es cuál en una lista, sin tener que volver a
-- mostrar el valor completo —mismo criterio que cualquier proveedor serio
-- (Stripe, OpenAI): la clave completa se muestra UNA sola vez, al crearla.
--
-- ============================================================
-- REVOCAR NO BORRA
-- ============================================================
--
-- `revocada_en` en vez de un `delete`: la fila queda como evidencia de que
-- existió y cuándo se usó por última vez, útil si alguna vez hay que
-- investigar un uso indebido. Una clave revocada deja de autenticar porque
-- la ruta pública filtra `revocada_en is null`, no porque desapareció.

create table if not exists public.eos_api_keys (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 80),
  hash text not null unique,
  prefijo text not null check (length(prefijo) between 6 and 20),
  creado_en timestamptz not null default now(),
  ultimo_uso_en timestamptz,
  revocada_en timestamptz
);

comment on table public.eos_api_keys is
  'v254: claves de API por cuenta, Developer Platform (ítem 25), solo lectura. hash es SHA-256 de la clave; la clave en texto plano nunca se guarda.';

create index if not exists eos_api_keys_hash_idx on public.eos_api_keys (hash) where revocada_en is null;

alter table public.eos_api_keys enable row level security;

drop policy if exists eos_api_keys_select_propia on public.eos_api_keys;
create policy eos_api_keys_select_propia
  on public.eos_api_keys
  for select to authenticated
  using ((select auth.uid()) = usuario_id);

drop policy if exists eos_api_keys_insert_propia on public.eos_api_keys;
create policy eos_api_keys_insert_propia
  on public.eos_api_keys
  for insert to authenticated
  with check ((select auth.uid()) = usuario_id);

-- Solo revocar (poner revocada_en), nunca re-crear una clave ya emitida ni
-- cambiarle el hash: por eso el `check` deja pasar únicamente esa columna, con
-- la fila ya siendo propia y todavía no revocada.
drop policy if exists eos_api_keys_update_revocar_propia on public.eos_api_keys;
create policy eos_api_keys_update_revocar_propia
  on public.eos_api_keys
  for update to authenticated
  using ((select auth.uid()) = usuario_id and revocada_en is null)
  with check ((select auth.uid()) = usuario_id);

-- Mismo criterio que el resto del proyecto: toda tabla con datos de una
-- persona le revoca todo a `anon`. La ruta pública (`/api/v1/publico/*`) lee
-- con el cliente de servicio, que no pasa por RLS — no necesita que `anon`
-- tenga permiso.
revoke all on table public.eos_api_keys from public, anon, authenticated;
grant select, insert, update on table public.eos_api_keys to authenticated;
grant all on table public.eos_api_keys to service_role;
