begin;

create table if not exists public.eos_master_contexts (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  identidad jsonb not null default '{}'::jsonb,
  estado_actual jsonb not null default '{}'::jsonb,
  objetivos jsonb not null default '[]'::jsonb,
  proyectos jsonb not null default '[]'::jsonb,
  compromisos jsonb not null default '[]'::jsonb,
  alertas jsonb not null default '[]'::jsonb,
  decisiones_recientes jsonb not null default '[]'::jsonb,
  aprendizajes jsonb not null default '[]'::jsonb,
  proxima_mejor_accion jsonb not null default '{}'::jsonb,
  resumen_compacto text not null default '',
  source_fingerprint text not null,
  fuentes jsonb not null default '{}'::jsonb,
  generado_at timestamptz not null default now(),
  vigente_hasta timestamptz not null default (now() + interval '6 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eos_master_contexts_user_unique unique (usuario_id),
  constraint eos_master_contexts_identity_object check (jsonb_typeof(identidad) = 'object'),
  constraint eos_master_contexts_current_object check (jsonb_typeof(estado_actual) = 'object'),
  constraint eos_master_contexts_goals_array check (jsonb_typeof(objetivos) = 'array'),
  constraint eos_master_contexts_projects_array check (jsonb_typeof(proyectos) = 'array'),
  constraint eos_master_contexts_commitments_array check (jsonb_typeof(compromisos) = 'array'),
  constraint eos_master_contexts_alerts_array check (jsonb_typeof(alertas) = 'array'),
  constraint eos_master_contexts_decisions_array check (jsonb_typeof(decisiones_recientes) = 'array'),
  constraint eos_master_contexts_learnings_array check (jsonb_typeof(aprendizajes) = 'array'),
  constraint eos_master_contexts_next_action_object check (jsonb_typeof(proxima_mejor_accion) = 'object'),
  constraint eos_master_contexts_sources_object check (jsonb_typeof(fuentes) = 'object')
);

create table if not exists public.eos_master_context_runs (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  request_id uuid,
  trigger_source text not null default 'manual',
  source_fingerprint text not null,
  changed boolean not null default true,
  section_counts jsonb not null default '{}'::jsonb,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  generated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_master_context_runs_counts_object check (jsonb_typeof(section_counts) = 'object')
);

create unique index if not exists eos_master_context_runs_user_request_uidx
  on public.eos_master_context_runs (usuario_id, request_id)
  where request_id is not null;

create index if not exists eos_master_context_runs_user_date_idx
  on public.eos_master_context_runs (usuario_id, generated_at desc);

alter table public.eos_decisions
  add column if not exists resultado_estado text not null default 'pendiente'
    check (resultado_estado in ('pendiente', 'midiendo', 'validado', 'inconcluso')),
  add column if not exists evaluacion_eos text,
  add column if not exists evaluacion_confianza numeric(4, 3)
    check (evaluacion_confianza is null or (evaluacion_confianza >= 0 and evaluacion_confianza <= 1)),
  add column if not exists evaluada_at timestamptz;

create index if not exists eos_decisions_user_measurement_idx
  on public.eos_decisions (usuario_id, resultado_estado, fecha_revision)
  where estado in ('activa', 'en_revision');

create or replace function public.eos_prepare_master_context()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.resumen_compacto := btrim(new.resumen_compacto);
  return new;
end;
$$;

drop trigger if exists eos_master_contexts_prepare_before_write on public.eos_master_contexts;
create trigger eos_master_contexts_prepare_before_write
before insert or update on public.eos_master_contexts
for each row execute function public.eos_prepare_master_context();

create or replace view public.eos_master_context_v8
with (security_invoker = true)
as
select
  c.*,
  (c.vigente_hasta <= now()) as necesita_actualizacion,
  greatest(0, floor(extract(epoch from (now() - c.generado_at)) / 60))::integer
    as antiguedad_minutos
from public.eos_master_contexts as c;

alter table public.eos_master_contexts enable row level security;
alter table public.eos_master_context_runs enable row level security;

create policy eos_master_contexts_select_own on public.eos_master_contexts
for select to authenticated using ((select auth.uid()) = usuario_id);
create policy eos_master_contexts_insert_own on public.eos_master_contexts
for insert to authenticated with check ((select auth.uid()) = usuario_id);
create policy eos_master_contexts_update_own on public.eos_master_contexts
for update to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

create policy eos_master_context_runs_select_own on public.eos_master_context_runs
for select to authenticated using ((select auth.uid()) = usuario_id);
create policy eos_master_context_runs_insert_own on public.eos_master_context_runs
for insert to authenticated with check ((select auth.uid()) = usuario_id);

revoke all on table public.eos_master_contexts from anon, authenticated;
revoke all on table public.eos_master_context_runs from anon, authenticated;
revoke all on table public.eos_master_context_v8 from anon, authenticated;
grant select, insert, update on table public.eos_master_contexts to authenticated;
grant select, insert on table public.eos_master_context_runs to authenticated;
grant select on table public.eos_master_context_v8 to authenticated;
grant all on table public.eos_master_contexts to service_role;
grant all on table public.eos_master_context_runs to service_role;
grant select on table public.eos_master_context_v8 to service_role;

revoke all on function public.eos_prepare_master_context() from public, anon;
revoke all on function public.eos_prepare_master_context() from authenticated;
grant execute on function public.eos_prepare_master_context() to service_role;

comment on table public.eos_master_contexts is
  'EOS 4.0: contexto ejecutivo compacto y vigente, compuesto desde las fuentes canonicas del usuario.';
comment on table public.eos_master_context_runs is
  'EOS 4.0: auditoria idempotente de cada reconstruccion del Contexto Maestro.';
comment on view public.eos_master_context_v8 is
  'Contexto Maestro con indicadores de vigencia para Chat, Briefing y automatizaciones.';

commit;
