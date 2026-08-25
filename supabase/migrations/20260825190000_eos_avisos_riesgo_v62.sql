-- EOS — Idempotencia de los avisos de riesgo (fase 3 de la hoja de ruta)
--
-- El detector de riesgo encuentra el mismo problema todos los días hasta que
-- llega la fecha: si el 24 detecta que el 28 va a faltar plata, el 25, el 26 y
-- el 27 lo va a volver a detectar. Mandar ese aviso cinco veces es exactamente
-- lo que entrena a la gente a ignorar las notificaciones — y una alerta
-- ignorada es peor que ninguna, porque da la sensación de estar cubierto.
--
-- Un aviso por usuario y por fecha de riesgo. Se vuelve a avisar solo si la
-- situación EMPEORA de verdad (ver `lib/finanzas/avisos.ts`): que falten
-- 200.000 más no amerita otro mensaje; que falte el doble, sí.

create table if not exists public.eos_finanzas_avisos_riesgo (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  -- El día en que la plata no alcanza. Es la identidad del aviso: mientras el
  -- problema siga siendo "el 28", es el mismo problema.
  fecha_riesgo date not null,

  -- Cuánto faltaba la última vez que se avisó. Sirve para decidir si vale la
  -- pena volver a molestar.
  faltante numeric(16,2) not null check (faltante >= 0),

  -- Cuántas veces se avisó de ESTE riesgo. Si crece mucho, el criterio de
  -- reenvío está mal calibrado y conviene saberlo.
  veces smallint not null default 1 check (veces > 0),

  enviado_en timestamptz not null default now(),

  constraint eos_avisos_riesgo_uniq unique (usuario_id, fecha_riesgo)
);

create index if not exists eos_avisos_riesgo_usuario_idx
  on public.eos_finanzas_avisos_riesgo (usuario_id, fecha_riesgo desc);

comment on table public.eos_finanzas_avisos_riesgo is
  'Un aviso de riesgo por usuario y fecha. Existe para no repetir el mismo aviso todos los días hasta que llegue la fecha.';

-- ============================================================
-- RLS: el usuario ve sus avisos; solo el servidor los escribe.
-- ============================================================
alter table public.eos_finanzas_avisos_riesgo enable row level security;

drop policy if exists avisos_riesgo_select on public.eos_finanzas_avisos_riesgo;
create policy avisos_riesgo_select on public.eos_finanzas_avisos_riesgo
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_finanzas_avisos_riesgo from anon, authenticated;
grant select on table public.eos_finanzas_avisos_riesgo to authenticated;
grant select, insert, update on table public.eos_finanzas_avisos_riesgo to service_role;

-- Mismo blindaje que el resto de finanzas: nunca filas huérfanas.
drop trigger if exists eos_avisos_riesgo_set_usuario_id_trg on public.eos_finanzas_avisos_riesgo;
create trigger eos_avisos_riesgo_set_usuario_id_trg
  before insert on public.eos_finanzas_avisos_riesgo
  for each row execute function public.eos_finanzas_set_usuario_id();
