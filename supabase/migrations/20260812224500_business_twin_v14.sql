begin;

create table if not exists public.eos_business_twins_v14 (
  usuario_id uuid primary key references public.usuarios(id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  model_version text not null default 'business-twin-v14',
  source_fingerprint text not null,
  identity jsonb not null default '{}'::jsonb,
  current_state jsonb not null default '{}'::jsonb,
  desired_state jsonb not null default '{}'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  constraints jsonb not null default '[]'::jsonb,
  capabilities jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  opportunities jsonb not null default '[]'::jsonb,
  priorities jsonb not null default '[]'::jsonb,
  execution_profile jsonb not null default '{}'::jsonb,
  learning_profile jsonb not null default '{}'::jsonb,
  autonomy_profile jsonb not null default '{}'::jsonb,
  intelligence_score integer,
  confidence numeric(4,3) not null default 0.000,
  source_completeness numeric(4,3) not null default 0.000,
  generated_at timestamptz not null default now(),
  valid_until timestamptz not null default (now() + interval '6 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_business_twins_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint eos_business_twins_completeness_check check (source_completeness >= 0 and source_completeness <= 1),
  constraint eos_business_twins_score_check check (intelligence_score is null or intelligence_score between 0 and 100),
  constraint eos_business_twins_source_fingerprint_check check (btrim(source_fingerprint) <> ''),
  constraint eos_business_twins_json_shapes_check check (
    jsonb_typeof(identity) = 'object'
    and jsonb_typeof(current_state) = 'object'
    and jsonb_typeof(desired_state) = 'object'
    and jsonb_typeof(gaps) = 'array'
    and jsonb_typeof(constraints) = 'array'
    and jsonb_typeof(capabilities) = 'array'
    and jsonb_typeof(risks) = 'array'
    and jsonb_typeof(opportunities) = 'array'
    and jsonb_typeof(priorities) = 'array'
    and jsonb_typeof(execution_profile) = 'object'
    and jsonb_typeof(learning_profile) = 'object'
    and jsonb_typeof(autonomy_profile) = 'object'
    and jsonb_typeof(metadata) = 'object'
  )
);

create index if not exists eos_business_twins_updated_idx
  on public.eos_business_twins_v14 (updated_at desc);

create table if not exists public.eos_business_twin_snapshots_v14 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  version integer not null check (version >= 1),
  source_fingerprint text not null,
  snapshot jsonb not null,
  confidence numeric(4,3) not null,
  source_completeness numeric(4,3) not null,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint eos_business_twin_snapshots_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint eos_business_twin_snapshots_completeness_check check (source_completeness >= 0 and source_completeness <= 1),
  constraint eos_business_twin_snapshots_json_check check (jsonb_typeof(snapshot) = 'object')
);

create unique index if not exists eos_business_twin_snapshots_user_version_uidx
  on public.eos_business_twin_snapshots_v14 (usuario_id, version);
create index if not exists eos_business_twin_snapshots_user_created_idx
  on public.eos_business_twin_snapshots_v14 (usuario_id, created_at desc);

create or replace function public.eos_touch_business_twin_v14()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists eos_business_twin_touch_v14 on public.eos_business_twins_v14;
create trigger eos_business_twin_touch_v14
before update on public.eos_business_twins_v14
for each row execute function public.eos_touch_business_twin_v14();

create or replace view public.eos_business_twin_current_v14
with (security_invoker = true)
as
select
  twin.*,
  twin.valid_until <= now() as is_stale,
  greatest(
    0,
    floor(extract(epoch from (now() - twin.generated_at)) / 60)
  )::integer as age_minutes
from public.eos_business_twins_v14 as twin;

alter table public.eos_business_twins_v14 enable row level security;
alter table public.eos_business_twin_snapshots_v14 enable row level security;

create policy eos_business_twins_select_own_v14
on public.eos_business_twins_v14
for select
to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_business_twin_snapshots_select_own_v14
on public.eos_business_twin_snapshots_v14
for select
to authenticated
using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_business_twins_v14 from anon, authenticated;
revoke all on table public.eos_business_twin_snapshots_v14 from anon, authenticated;
revoke all on table public.eos_business_twin_current_v14 from anon, authenticated;

grant select on table public.eos_business_twins_v14 to authenticated;
grant select on table public.eos_business_twin_snapshots_v14 to authenticated;
grant select on table public.eos_business_twin_current_v14 to authenticated;

grant all on table public.eos_business_twins_v14 to service_role;
grant all on table public.eos_business_twin_snapshots_v14 to service_role;
grant select on table public.eos_business_twin_current_v14 to service_role;

comment on table public.eos_business_twins_v14 is
  'Modelo operativo estructurado y versionado de la realidad del usuario/empresa. Se deriva de fuentes EOS existentes; no reemplaza el Contexto Maestro.';
comment on table public.eos_business_twin_snapshots_v14 is
  'Historial inmutable por versión del Business Twin para comparar cómo cambia la realidad operativa.';
comment on view public.eos_business_twin_current_v14 is
  'Business Twin vigente con indicadores de frescura derivados.';

commit;
