-- EOS — Snapshot mensual de patrimonio y disponible real (v237), para "Tu
-- progreso" (Informes de Personal).
--
-- Hasta ahora, "Tu progreso" solo podía mostrar el ÚLTIMO patrimonio
-- declarado: EOS nunca guardaba una foto mensual, así que no había con qué
-- armar una curva de cómo evolucionó. Esta tabla es esa foto.
--
-- Mismo patrón que `eos_informes_impacto_v206`: un snapshot como máximo por
-- cuenta y por mes (el UNIQUE es la idempotencia), `datos` guarda los
-- números exactos de ese momento —si cambia cómo se calcula el patrimonio
-- más adelante, la foto de agosto sigue siendo la de agosto—, y solo lectura
-- para el dueño: lo escribe el cron mensual con `service_role`.
--
-- `patrimonio_neto` puede ser null a propósito (ver lib/finanzas/patrimonio.ts):
-- sin las dos mitades —activos y pasivos— declaradas, un "neto" sería un
-- número inventado con nombre de neto. Null es la respuesta honesta.

create table if not exists public.eos_finanzas_progreso_mensual_v237 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  periodo text not null check (periodo ~ '^[0-9]{4}-[0-9]{2}$'),
  datos jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now(),

  unique (usuario_id, periodo)
);

create index if not exists eos_finanzas_progreso_mensual_periodo_idx
  on public.eos_finanzas_progreso_mensual_v237 (periodo);

comment on table public.eos_finanzas_progreso_mensual_v237 is
  'Una foto por cuenta y por mes (periodo YYYY-MM) de patrimonio neto, disponible real y reserva. datos = los números exactos de ese momento.';

alter table public.eos_finanzas_progreso_mensual_v237 enable row level security;

-- Solo lectura para el dueño; escribe únicamente el server con service_role.
drop policy if exists progreso_mensual_select on public.eos_finanzas_progreso_mensual_v237;
create policy progreso_mensual_select on public.eos_finanzas_progreso_mensual_v237
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on public.eos_finanzas_progreso_mensual_v237 from anon;
