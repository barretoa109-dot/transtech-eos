-- EOS — correos motivacionales cada 3 días.
--
-- Dos piezas, las dos chicas a propósito:
--
-- 1. `eos_emails_motivacionales_v188`: la garantía de "uno por ciclo". El ciclo
--    es un número entero que sube cada 3 días calendario (ver
--    `lib/email/motivacionales.ts`), así que el UNIQUE (usuario_id, ciclo) es
--    a la vez la idempotencia y el reloj: no hace falta guardar "cuándo fue el
--    último" ni compararlo. Mismo patrón que `eos_emails_transaccionales_v164`:
--    se reclama la fila ANTES de mandar.
--
-- 2. `correos_motivacionales` en `eos_followup_preferences`: la baja. Arranca en
--    `true` porque a diferencia del briefing (opt-in, lleva datos de la
--    persona) este correo es de acompañamiento y le llega a toda cuenta — pero
--    cada uno trae un enlace de baja de un clic, y esta columna es lo que ese
--    enlace apaga. Sin fila en la tabla de preferencias = no se dio de baja.
--
-- Se reutiliza `eos_followup_preferences` y no se crea una tabla de bajas por lo
-- mismo que ya dice `app/api/briefing/preferencias`: dos lugares donde el
-- usuario apaga lo mismo es la forma de que uno solo se respete.

create table if not exists public.eos_emails_motivacionales_v188 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ciclo integer not null,
  indice integer not null,
  enviado_en timestamptz not null default now(),

  unique (usuario_id, ciclo)
);

create index if not exists eos_emails_motivacionales_ciclo_idx
  on public.eos_emails_motivacionales_v188 (ciclo);

comment on table public.eos_emails_motivacionales_v188 is
  'Un correo motivacional como máximo por usuario y por ciclo de 3 días. El UNIQUE es la idempotencia; el ciclo es el reloj.';

alter table public.eos_emails_motivacionales_v188 enable row level security;

-- Solo lectura para el dueño; escribe únicamente el server con service_role.
drop policy if exists emails_motivacionales_select on public.eos_emails_motivacionales_v188;
create policy emails_motivacionales_select on public.eos_emails_motivacionales_v188
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on public.eos_emails_motivacionales_v188 from anon;

alter table public.eos_followup_preferences
  add column if not exists correos_motivacionales boolean not null default true;

comment on column public.eos_followup_preferences.correos_motivacionales is
  'false = la persona se dio de baja de los correos motivacionales (enlace de baja del propio correo). Sin fila = recibe.';
