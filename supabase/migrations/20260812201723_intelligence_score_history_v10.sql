-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

create table if not exists public.eos_intelligence_score_snapshots_v10 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  snapshot_day date not null default (timezone('utc', now()))::date,
  score smallint not null check (score between 0 and 100),
  contexto smallint not null check (contexto between 0 and 100),
  objetivos smallint not null check (objetivos between 0 and 100),
  ejecucion smallint not null check (ejecucion between 0 and 100),
  decisiones smallint not null check (decisiones between 0 and 100),
  aprendizaje smallint not null check (aprendizaje between 0 and 100),
  active_goals integer not null default 0 check (active_goals >= 0),
  pending_alerts integer not null default 0 check (pending_alerts >= 0),
  critical_alerts integer not null default 0 check (critical_alerts >= 0),
  completed_actions integer not null default 0 check (completed_actions >= 0),
  measured_decisions integer not null default 0 check (measured_decisions >= 0),
  learning_evidence integer not null default 0 check (learning_evidence >= 0),
  strongest_dimension text not null check (strongest_dimension in ('contexto','objetivos','ejecucion','decisiones','aprendizaje')),
  weakest_dimension text not null check (weakest_dimension in ('contexto','objetivos','ejecucion','decisiones','aprendizaje')),
  formula_version text not null default 'eos-intelligence-score-v1',
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists eos_intelligence_score_user_day_uidx on public.eos_intelligence_score_snapshots_v10 (usuario_id, snapshot_day);
create index if not exists eos_intelligence_score_user_history_idx on public.eos_intelligence_score_snapshots_v10 (usuario_id, snapshot_day desc);

alter table public.eos_intelligence_score_snapshots_v10 enable row level security;

drop policy if exists eos_intelligence_score_select_own on public.eos_intelligence_score_snapshots_v10;
create policy eos_intelligence_score_select_own on public.eos_intelligence_score_snapshots_v10 for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists eos_intelligence_score_insert_own on public.eos_intelligence_score_snapshots_v10;
create policy eos_intelligence_score_insert_own on public.eos_intelligence_score_snapshots_v10 for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists eos_intelligence_score_update_own on public.eos_intelligence_score_snapshots_v10;
create policy eos_intelligence_score_update_own on public.eos_intelligence_score_snapshots_v10 for update to authenticated using ((select auth.uid()) = usuario_id) with check ((select auth.uid()) = usuario_id);

revoke all on table public.eos_intelligence_score_snapshots_v10 from anon, authenticated;
grant select, insert, update on table public.eos_intelligence_score_snapshots_v10 to authenticated;
grant all on table public.eos_intelligence_score_snapshots_v10 to service_role;

comment on table public.eos_intelligence_score_snapshots_v10 is 'Historial diario autenticado del EOS Intelligence Score para explicar tendencia, variaciones y señales que movieron el score.';
comment on column public.eos_intelligence_score_snapshots_v10.formula_version is 'Version de la formula utilizada para evitar comparar silenciosamente scores calculados con metodologias incompatibles.';

commit;
