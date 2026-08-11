begin;

create table if not exists public.eos_decisions (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  proyecto_id uuid references public.eos_projects(id) on delete set null,
  objetivo_id uuid references public.eos_goals(id) on delete set null,
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  mensaje_id uuid references public.mensajes(id) on delete set null,
  titulo text not null,
  decision text not null,
  contexto text,
  razon text,
  resultado_esperado text,
  metrica text,
  valor_base numeric(18, 4),
  valor_objetivo numeric(18, 4),
  unidad text,
  estado text not null default 'activa'
    check (estado in ('borrador', 'activa', 'en_revision', 'cerrada', 'cancelada')),
  confianza numeric(4, 3) not null default 1.000
    check (confianza >= 0 and confianza <= 1),
  fuente text not null default 'usuario',
  request_id uuid,
  fecha_decision timestamptz not null default now(),
  fecha_revision date,
  cerrada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_decisions_title_not_blank check (btrim(titulo) <> ''),
  constraint eos_decisions_text_not_blank check (btrim(decision) <> '')
);

create table if not exists public.eos_decision_results (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.eos_decisions(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  tipo text not null default 'observacion'
    check (tipo in ('positivo', 'neutral', 'negativo', 'inconcluso', 'observacion')),
  resumen text not null,
  evidencia jsonb not null default '{}'::jsonb,
  valor_resultado numeric(18, 4),
  unidad text,
  aprendizaje text,
  fuente text not null default 'usuario',
  source_event_type text,
  source_event_id text,
  ocurrido_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_decision_results_summary_not_blank check (btrim(resumen) <> '')
);

create unique index if not exists eos_decisions_user_request_uidx
  on public.eos_decisions (usuario_id, request_id)
  where request_id is not null;

create index if not exists eos_decisions_user_date_idx
  on public.eos_decisions (usuario_id, fecha_decision desc);

create index if not exists eos_decisions_user_open_review_idx
  on public.eos_decisions (usuario_id, fecha_revision)
  where estado in ('activa', 'en_revision');

create index if not exists eos_decisions_project_idx
  on public.eos_decisions (proyecto_id)
  where proyecto_id is not null;

create index if not exists eos_decisions_goal_idx
  on public.eos_decisions (objetivo_id)
  where objetivo_id is not null;

create index if not exists eos_decisions_conversation_idx
  on public.eos_decisions (conversacion_id)
  where conversacion_id is not null;

create index if not exists eos_decisions_message_idx
  on public.eos_decisions (mensaje_id)
  where mensaje_id is not null;

create index if not exists eos_decision_results_decision_date_idx
  on public.eos_decision_results (decision_id, ocurrido_at desc);

create index if not exists eos_decision_results_user_date_idx
  on public.eos_decision_results (usuario_id, ocurrido_at desc);

create unique index if not exists eos_decision_results_source_uidx
  on public.eos_decision_results (source_event_type, source_event_id)
  where source_event_type is not null and source_event_id is not null;

create or replace function public.eos_prepare_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.titulo := btrim(new.titulo);
  new.decision := btrim(new.decision);
  new.updated_at := now();

  if new.estado in ('cerrada', 'cancelada') and new.cerrada_at is null then
    new.cerrada_at := now();
  elsif new.estado not in ('cerrada', 'cancelada') then
    new.cerrada_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.eos_validate_decision_result()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  decision_owner uuid;
begin
  select d.usuario_id into decision_owner
  from public.eos_decisions as d
  where d.id = new.decision_id;

  if decision_owner is null or decision_owner <> new.usuario_id then
    raise exception 'El resultado no corresponde al propietario de la decision.';
  end if;

  new.resumen := btrim(new.resumen);
  return new;
end;
$$;

drop trigger if exists eos_decisions_prepare_before_write on public.eos_decisions;
create trigger eos_decisions_prepare_before_write
before insert or update on public.eos_decisions
for each row execute function public.eos_prepare_decision();

drop trigger if exists eos_decision_results_validate_before_insert on public.eos_decision_results;
create trigger eos_decision_results_validate_before_insert
before insert on public.eos_decision_results
for each row execute function public.eos_validate_decision_result();

create or replace view public.eos_decision_registry_v6
with (security_invoker = true)
as
select
  d.*,
  coalesce(r.result_count, 0)::integer as result_count,
  r.latest_result_at,
  r.latest_result_type,
  r.latest_result_summary,
  r.latest_learning
from public.eos_decisions as d
left join lateral (
  select
    count(*) as result_count,
    max(dr.ocurrido_at) as latest_result_at,
    (array_agg(dr.tipo order by dr.ocurrido_at desc, dr.created_at desc))[1]
      as latest_result_type,
    (array_agg(dr.resumen order by dr.ocurrido_at desc, dr.created_at desc))[1]
      as latest_result_summary,
    (array_agg(dr.aprendizaje order by dr.ocurrido_at desc, dr.created_at desc)
      filter (where dr.aprendizaje is not null))[1] as latest_learning
  from public.eos_decision_results as dr
  where dr.decision_id = d.id
) as r on true;

alter table public.eos_decisions enable row level security;
alter table public.eos_decision_results enable row level security;

drop policy if exists eos_decisions_select_own on public.eos_decisions;
drop policy if exists eos_decisions_insert_own on public.eos_decisions;
drop policy if exists eos_decisions_update_own on public.eos_decisions;

create policy eos_decisions_select_own on public.eos_decisions
for select to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_decisions_insert_own on public.eos_decisions
for insert to authenticated
with check ((select auth.uid()) = usuario_id);

create policy eos_decisions_update_own on public.eos_decisions
for update to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

drop policy if exists eos_decision_results_select_own on public.eos_decision_results;
drop policy if exists eos_decision_results_insert_own on public.eos_decision_results;

create policy eos_decision_results_select_own on public.eos_decision_results
for select to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_decision_results_insert_own on public.eos_decision_results
for insert to authenticated
with check ((select auth.uid()) = usuario_id);

revoke all on table public.eos_decisions from anon, authenticated;
revoke all on table public.eos_decision_results from anon, authenticated;
revoke all on table public.eos_decision_registry_v6 from anon, authenticated;

grant select, insert, update on table public.eos_decisions to authenticated;
grant select, insert on table public.eos_decision_results to authenticated;
grant select on table public.eos_decision_registry_v6 to authenticated;

grant all on table public.eos_decisions to service_role;
grant all on table public.eos_decision_results to service_role;
grant select on table public.eos_decision_registry_v6 to service_role;

revoke all on function public.eos_prepare_decision() from public, anon;
revoke all on function public.eos_validate_decision_result() from public, anon;
grant execute on function public.eos_prepare_decision() to authenticated, service_role;
grant execute on function public.eos_validate_decision_result() to authenticated, service_role;

comment on table public.eos_decisions is
  'Fase 6: decisiones ejecutivas con contexto, criterio, expectativa y fecha de revision.';
comment on table public.eos_decision_results is
  'Fase 6: resultados y aprendizajes anexos e inmutables de cada decision.';
comment on view public.eos_decision_registry_v6 is
  'Registro consolidado de decisiones con su ultimo resultado y aprendizaje.';

commit;
