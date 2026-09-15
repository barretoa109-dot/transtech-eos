-- EOS — idempotencia de los emails transaccionales (bienvenida y plan).
--
-- Hasta ahora no existía NINGÚN email de bienvenida ni de confirmación de
-- plan: se construye acá por primera vez. La única pieza que necesita una
-- tabla propia es la garantía de "una sola vez" — el mismo patrón que ya usa
-- `eos_briefing_envios` (ver esa migración): un email que llega dos veces
-- rompe la confianza en el canal.
--
-- Dos disparadores por evento, no uno:
--   'bienvenida' — al nacer la cuenta. `referencia` queda vacía: hay como
--     mucho una bienvenida por cuenta, para siempre.
--   'plan'       — al activarse un plan pago. `referencia` es el id de la
--     `solicitudes_pago` que lo activó, así que una RENOVACIÓN (una
--     solicitud nueva) sí manda su propio correo, y sólo un REINTENTO del
--     mismo evento (mismo id de solicitud, típico de un webhook reentregado)
--     queda bloqueado por el `unique`.
--
-- Nada de esto reemplaza la idempotencia de los RPC de pago
-- (`asignar_plan_eos`, `eos_bancard_confirmar_cobro_v51`,
-- `eos_process_manual_payment_v42`, todos ya idempotentes): esta tabla es una
-- segunda red, específica del email, no la fuente de verdad de si el plan se
-- activó.

create table if not exists public.eos_emails_transaccionales_v164 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('bienvenida', 'plan')),
  referencia text not null default '',
  enviado_en timestamptz not null default now(),

  unique (usuario_id, tipo, referencia)
);

create index if not exists eos_emails_transaccionales_usuario_idx
  on public.eos_emails_transaccionales_v164 (usuario_id, enviado_en desc);

comment on table public.eos_emails_transaccionales_v164 is
  'Idempotencia de los emails de bienvenida y confirmación de plan. Un email transaccional que llega dos veces rompe la confianza en el canal.';

alter table public.eos_emails_transaccionales_v164 enable row level security;

-- Solo lectura para el dueño (por si algún día se muestra "te mandamos esto").
-- Escribe únicamente el server con service_role, que igual salta la RLS.
drop policy if exists emails_transaccionales_select on public.eos_emails_transaccionales_v164;
create policy emails_transaccionales_select on public.eos_emails_transaccionales_v164
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on public.eos_emails_transaccionales_v164 from anon;
