-- EOS — push motivacional nativo, hasta 3 veces por día.
--
-- Mismo patrón que `eos_emails_motivacionales_v188`
-- (20260920190000_eos_correos_motivacionales_v188.sql), adaptado a que acá el
-- reloj es un día calendario (hora Paraguay) con tres franjas, no un ciclo de
-- 3 días: `unique (usuario_id, fecha, franja)` es la idempotencia Y la
-- garantía de que cada franja manda como máximo un push por día y por
-- persona. Conviven dos canales a propósito (ver lib/calendario/avisar-agenda.ts
-- para el otro push nativo que ya existe): este es aparte, no lo reemplaza.
--
-- `avisos_motivacionales_push` en `eos_followup_preferences` arranca en `true`
-- por decisión del dueño (2026-11-10): llega a toda cuenta con un dispositivo
-- nativo registrado, y se apaga con un botón, no con un enlace de baja — a
-- diferencia del correo, acá no hay "enviar" que lleve un link, el push en sí
-- es la entrega.

create table if not exists public.eos_push_motivacionales_v258 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  franja text not null check (franja in ('manana', 'mediodia', 'noche')),
  indice integer not null,
  enviado_en timestamptz not null default now(),

  unique (usuario_id, fecha, franja)
);

create index if not exists eos_push_motivacionales_fecha_idx
  on public.eos_push_motivacionales_v258 (fecha);

comment on table public.eos_push_motivacionales_v258 is
  'Un push motivacional como máximo por usuario, por día (hora Paraguay) y por franja (mañana/mediodía/noche). El UNIQUE es la idempotencia.';

alter table public.eos_push_motivacionales_v258 enable row level security;

-- Solo lectura para el dueño; escribe únicamente el server con service_role.
drop policy if exists push_motivacionales_select on public.eos_push_motivacionales_v258;
create policy push_motivacionales_select on public.eos_push_motivacionales_v258
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on public.eos_push_motivacionales_v258 from anon;

alter table public.eos_followup_preferences
  add column if not exists avisos_motivacionales_push boolean not null default true;

comment on column public.eos_followup_preferences.avisos_motivacionales_push is
  'false = la persona apagó el push motivacional (3 veces al día, app nativa). Sin fila = lo recibe.';
