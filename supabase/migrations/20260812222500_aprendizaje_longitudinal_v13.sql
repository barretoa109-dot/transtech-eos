begin;

create table if not exists public.eos_learning_snapshots_v13 (
  id uuid primary key default gen_random_uuid(),
  learning_id uuid not null references public.eos_learnings(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  snapshot_day date not null default current_date,
  categoria text not null,
  patron text not null,
  recomendacion text not null,
  tendencia text not null,
  confianza numeric(4,3) not null,
  evidence_count integer not null,
  positive_count integer not null,
  negative_count integer not null,
  estado text not null,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_learning_snapshots_confidence_check check (confianza >= 0 and confianza <= 1),
  constraint eos_learning_snapshots_counts_check check (
    evidence_count >= 0 and positive_count >= 0 and negative_count >= 0
  )
);

create unique index if not exists eos_learning_snapshots_daily_uidx
  on public.eos_learning_snapshots_v13 (learning_id, snapshot_day);
create index if not exists eos_learning_snapshots_user_day_idx
  on public.eos_learning_snapshots_v13 (usuario_id, snapshot_day desc);
create index if not exists eos_learning_snapshots_learning_day_idx
  on public.eos_learning_snapshots_v13 (learning_id, snapshot_day desc);

create or replace function public.eos_capture_learning_snapshot_v13()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.eos_learning_snapshots_v13 (
    learning_id,
    usuario_id,
    snapshot_day,
    categoria,
    patron,
    recomendacion,
    tendencia,
    confianza,
    evidence_count,
    positive_count,
    negative_count,
    estado,
    first_observed_at,
    last_observed_at,
    captured_at,
    metadata
  ) values (
    new.id,
    new.usuario_id,
    current_date,
    new.categoria,
    new.patron,
    new.recomendacion,
    new.tendencia,
    new.confianza,
    new.evidence_count,
    new.positive_count,
    new.negative_count,
    new.estado,
    new.first_observed_at,
    new.last_observed_at,
    now(),
    jsonb_build_object(
      'source', 'eos-learning-trigger-v13',
      'generated_at', new.generated_at,
      'model_version', new.model_version,
      'prompt_version', new.prompt_version
    )
  )
  on conflict (learning_id, snapshot_day) do update set
    categoria = excluded.categoria,
    patron = excluded.patron,
    recomendacion = excluded.recomendacion,
    tendencia = excluded.tendencia,
    confianza = excluded.confianza,
    evidence_count = excluded.evidence_count,
    positive_count = excluded.positive_count,
    negative_count = excluded.negative_count,
    estado = excluded.estado,
    first_observed_at = excluded.first_observed_at,
    last_observed_at = excluded.last_observed_at,
    captured_at = excluded.captured_at,
    metadata = excluded.metadata;

  return new;
end;
$$;

revoke all on function public.eos_capture_learning_snapshot_v13() from public;

drop trigger if exists eos_learnings_snapshot_v13 on public.eos_learnings;
create trigger eos_learnings_snapshot_v13
after insert or update of categoria, patron, recomendacion, tendencia, confianza,
  evidence_count, positive_count, negative_count, estado, last_observed_at
on public.eos_learnings
for each row execute function public.eos_capture_learning_snapshot_v13();

insert into public.eos_learning_snapshots_v13 (
  learning_id,
  usuario_id,
  snapshot_day,
  categoria,
  patron,
  recomendacion,
  tendencia,
  confianza,
  evidence_count,
  positive_count,
  negative_count,
  estado,
  first_observed_at,
  last_observed_at,
  captured_at,
  metadata
)
select
  l.id,
  l.usuario_id,
  current_date,
  l.categoria,
  l.patron,
  l.recomendacion,
  l.tendencia,
  l.confianza,
  l.evidence_count,
  l.positive_count,
  l.negative_count,
  l.estado,
  l.first_observed_at,
  l.last_observed_at,
  now(),
  jsonb_build_object('source', 'baseline-v13')
from public.eos_learnings as l
on conflict (learning_id, snapshot_day) do nothing;

create or replace view public.eos_learning_longitudinal_v13
with (security_invoker = true)
as
with current_learning as (
  select l.*
  from public.eos_learnings as l
  where l.estado <> 'descartado'
), history as (
  select
    l.id as learning_id,
    count(s.id)::integer as snapshot_count,
    min(s.snapshot_day) as first_snapshot_day,
    max(s.snapshot_day) as latest_snapshot_day,
    (array_agg(s.confianza order by s.snapshot_day asc))[1] as first_confidence,
    (array_agg(s.confianza order by s.snapshot_day desc))[1] as latest_confidence,
    (array_agg(s.evidence_count order by s.snapshot_day asc))[1] as first_evidence_count,
    (array_agg(s.evidence_count order by s.snapshot_day desc))[1] as latest_evidence_count,
    count(*) filter (where s.snapshot_day >= current_date - 30)::integer as snapshots_30d
  from current_learning as l
  left join public.eos_learning_snapshots_v13 as s on s.learning_id = l.id
  group by l.id
)
select
  l.id,
  l.usuario_id,
  l.clave,
  l.categoria,
  l.patron,
  l.recomendacion,
  l.tendencia,
  l.confianza,
  l.evidence_count,
  l.positive_count,
  l.negative_count,
  l.estado,
  l.first_observed_at,
  l.last_observed_at,
  l.generated_at,
  l.updated_at,
  coalesce(h.snapshot_count, 0) as snapshot_count,
  h.first_snapshot_day,
  h.latest_snapshot_day,
  coalesce(h.first_confidence, l.confianza) as first_confidence,
  coalesce(h.latest_confidence, l.confianza) as latest_confidence,
  round((l.confianza - coalesce(h.first_confidence, l.confianza))::numeric, 3)
    as confidence_delta,
  greatest(0, l.evidence_count - coalesce(h.first_evidence_count, l.evidence_count))::integer
    as evidence_delta,
  case
    when l.last_observed_at is null then null
    else greatest(0, floor(extract(epoch from (now() - l.last_observed_at)) / 86400))::integer
  end as days_since_observed,
  case
    when l.evidence_count >= 4
      and l.positive_count > 0
      and l.negative_count > 0
      and least(l.positive_count, l.negative_count)::numeric / greatest(l.evidence_count, 1) >= 0.25
      then true
    else false
  end as contradictory,
  case
    when l.last_observed_at is not null and l.last_observed_at < now() - interval '90 days'
      then 'stale'
    when l.evidence_count >= 4
      and l.positive_count > 0
      and l.negative_count > 0
      and least(l.positive_count, l.negative_count)::numeric / greatest(l.evidence_count, 1) >= 0.25
      then 'contradictory'
    when coalesce(h.snapshot_count, 0) <= 1
      then 'new'
    when l.confianza - coalesce(h.first_confidence, l.confianza) >= 0.08
      then 'strengthening'
    when l.confianza - coalesce(h.first_confidence, l.confianza) <= -0.08
      then 'weakening'
    else 'stable'
  end as longitudinal_state
from current_learning as l
left join history as h on h.learning_id = l.id;

alter table public.eos_learning_snapshots_v13 enable row level security;

create policy eos_learning_snapshots_select_own_v13
on public.eos_learning_snapshots_v13
for select
to authenticated
using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_learning_snapshots_v13 from anon, authenticated;
revoke all on table public.eos_learning_longitudinal_v13 from anon, authenticated;
grant select on table public.eos_learning_snapshots_v13 to authenticated;
grant select on table public.eos_learning_longitudinal_v13 to authenticated;
grant all on table public.eos_learning_snapshots_v13 to service_role;
grant select on table public.eos_learning_longitudinal_v13 to service_role;

comment on table public.eos_learning_snapshots_v13 is
  'Snapshots diarios de cada aprendizaje para medir refuerzo, debilitamiento, contradicción y obsolescencia.';
comment on view public.eos_learning_longitudinal_v13 is
  'Estado longitudinal explicable de los aprendizajes EOS a lo largo del tiempo.';

commit;
