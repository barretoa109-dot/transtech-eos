-- EOS — registro de envíos del briefing diario
--
-- El motor de briefing ya generaba contenido todos los días, pero ese
-- contenido nunca salía de la app: había que entrar a buscarlo. La doctrina
-- pide lo contrario ("EOS trabaja, el usuario observa"), y un producto que
-- solo existe cuando lo abrís no genera el hábito que lo hace indispensable.
--
-- Esta tabla existe por una sola razón: que un briefing se envíe UNA vez.
-- El cron puede reintentarse, Vercel puede ejecutarlo dos veces, y un usuario
-- que recibe el mismo correo dos veces deja de confiar en el canal.
--
-- Las preferencias NO se guardan acá: ya viven en `eos_followup_preferences`,
-- que tiene canal_email, zona_horaria, hora_local y horas de silencio. Se
-- reutiliza a propósito en vez de duplicar el concepto.

create table if not exists public.eos_briefing_envios (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  briefing_date date not null,
  canal text not null default 'email' check (canal in ('email', 'push')),
  -- 'enviado' | 'error'. Se guarda el fallo para poder ver por qué un
  -- usuario no recibió lo suyo, sin tener que leer logs.
  estado text not null default 'enviado' check (estado in ('enviado', 'error')),
  detalle text,
  enviado_en timestamptz not null default now(),

  -- La garantía: un briefing por usuario, por día, por canal.
  unique (usuario_id, briefing_date, canal)
);

create index if not exists eos_briefing_envios_usuario_idx
  on public.eos_briefing_envios (usuario_id, enviado_en desc);

comment on table public.eos_briefing_envios is
  'Idempotencia del envío del briefing. Recibir el mismo correo dos veces destruye la confianza en el canal.';

-- ============================================================
-- RLS: el usuario puede ver qué se le mandó; escribe solo el cron
-- (service_role), que no pasa por RLS.
-- ============================================================
alter table public.eos_briefing_envios enable row level security;

drop policy if exists briefing_envios_select on public.eos_briefing_envios;
create policy briefing_envios_select on public.eos_briefing_envios
  for select to authenticated using ((select auth.uid()) = usuario_id);
