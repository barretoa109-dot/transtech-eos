begin;

create table if not exists public.eos_autonomy_profiles_v12 (
  usuario_id uuid primary key references public.usuarios(id) on delete cascade,
  default_level smallint not null default 1,
  max_auto_actions_per_day integer not null default 5,
  max_daily_risk_points integer not null default 10,
  approval_ttl_minutes integer not null default 60,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eos_autonomy_profiles_level_check check (default_level between 0 and 3),
  constraint eos_autonomy_profiles_daily_actions_check check (max_auto_actions_per_day between 0 and 100),
  constraint eos_autonomy_profiles_daily_risk_check check (max_daily_risk_points between 0 and 1000),
  constraint eos_autonomy_profiles_ttl_check check (approval_ttl_minutes between 5 and 10080)
);

comment on column public.eos_autonomy_profiles_v12.default_level is
  '0=recomendar, 1=preparar, 2=pedir aprobación, 3=autoejecutar cuando el riesgo y los límites lo permitan.';

create table if not exists public.eos_autonomy_rules_v12 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  accion text not null,
  autonomy_level smallint not null,
  risk_tier smallint not null default 1,
  risk_points integer not null default 1,
  max_auto_per_day integer,
  enabled boolean not null default true,
  require_fresh_context boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eos_autonomy_rules_level_check check (autonomy_level between 0 and 3),
  constraint eos_autonomy_rules_risk_tier_check check (risk_tier between 0 and 3),
  constraint eos_autonomy_rules_risk_points_check check (risk_points between 0 and 100),
  constraint eos_autonomy_rules_max_auto_check check (max_auto_per_day is null or max_auto_per_day between 0 and 100),
  constraint eos_autonomy_rules_action_check check (
    accion in (
      'RESPONDER',
      'GENERAR_EXCEL',
      'GENERAR_PDF',
      'GENERAR_WORD',
      'CREAR_TAREA',
      'CREAR_OBJETIVO',
      'GUARDAR_MEMORIA',
      'VER_DASHBOARD',
      'VER_BRIEFING'
    )
  )
);

create unique index if not exists eos_autonomy_rules_user_action_uidx
  on public.eos_autonomy_rules_v12 (usuario_id, accion);

create table if not exists public.eos_action_approvals_v12 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  command_id uuid references public.eos_action_commands(id) on delete cascade,
  request_id uuid not null,
  accion text not null,
  risk_tier smallint not null default 1,
  risk_points integer not null default 1,
  requested_level smallint not null,
  effective_level smallint not null,
  status text not null default 'pending',
  reason text,
  payload_snapshot jsonb not null default '{}'::jsonb,
  payload_fingerprint text,
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eos_action_approvals_status_check check (
    status in ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'consumed')
  ),
  constraint eos_action_approvals_level_check check (
    requested_level between 0 and 3 and effective_level between 0 and 3
  ),
  constraint eos_action_approvals_risk_tier_check check (risk_tier between 0 and 3),
  constraint eos_action_approvals_risk_points_check check (risk_points between 0 and 100),
  constraint eos_action_approvals_expiry_check check (expires_at > created_at)
);

create unique index if not exists eos_action_approvals_user_request_action_uidx
  on public.eos_action_approvals_v12 (usuario_id, request_id, accion);
create index if not exists eos_action_approvals_pending_idx
  on public.eos_action_approvals_v12 (usuario_id, expires_at)
  where status = 'pending';
create index if not exists eos_action_approvals_command_idx
  on public.eos_action_approvals_v12 (command_id)
  where command_id is not null;

create table if not exists public.eos_autonomy_events_v12 (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  approval_id uuid references public.eos_action_approvals_v12(id) on delete cascade,
  command_id uuid references public.eos_action_commands(id) on delete cascade,
  event_type text not null,
  actor text not null default 'eos',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint eos_autonomy_events_type_check check (
    event_type in (
      'evaluated',
      'approval_requested',
      'approved',
      'rejected',
      'expired',
      'auto_allowed',
      'auto_blocked',
      'consumed',
      'cancelled',
      'profile_updated',
      'rule_updated'
    )
  ),
  constraint eos_autonomy_events_actor_check check (actor in ('eos', 'user', 'service'))
);

create index if not exists eos_autonomy_events_user_created_idx
  on public.eos_autonomy_events_v12 (usuario_id, created_at desc);
create index if not exists eos_autonomy_events_approval_idx
  on public.eos_autonomy_events_v12 (approval_id, created_at desc)
  where approval_id is not null;

create or replace function public.eos_touch_autonomy_v12()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists eos_autonomy_profiles_touch_v12 on public.eos_autonomy_profiles_v12;
create trigger eos_autonomy_profiles_touch_v12
before update on public.eos_autonomy_profiles_v12
for each row execute function public.eos_touch_autonomy_v12();

drop trigger if exists eos_autonomy_rules_touch_v12 on public.eos_autonomy_rules_v12;
create trigger eos_autonomy_rules_touch_v12
before update on public.eos_autonomy_rules_v12
for each row execute function public.eos_touch_autonomy_v12();

drop trigger if exists eos_action_approvals_touch_v12 on public.eos_action_approvals_v12;
create trigger eos_action_approvals_touch_v12
before update on public.eos_action_approvals_v12
for each row execute function public.eos_touch_autonomy_v12();

create or replace function public.eos_validate_autonomy_approval_owner_v12()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  command_owner uuid;
begin
  if new.command_id is null then
    return new;
  end if;

  select usuario_id into command_owner
  from public.eos_action_commands
  where id = new.command_id;

  if command_owner is null or command_owner <> new.usuario_id then
    raise exception 'La aprobación no corresponde al propietario de la orden.';
  end if;

  return new;
end;
$$;

drop trigger if exists eos_action_approvals_validate_owner_v12 on public.eos_action_approvals_v12;
create trigger eos_action_approvals_validate_owner_v12
before insert or update on public.eos_action_approvals_v12
for each row execute function public.eos_validate_autonomy_approval_owner_v12();

create or replace function public.eos_expire_autonomy_approvals_v12()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer := 0;
begin
  with expired as (
    update public.eos_action_approvals_v12
    set status = 'expired', decided_at = coalesce(decided_at, now())
    where status = 'pending' and expires_at <= now()
    returning id, usuario_id, command_id
  ), inserted as (
    insert into public.eos_autonomy_events_v12 (
      usuario_id, approval_id, command_id, event_type, actor, detail
    )
    select usuario_id, id, command_id, 'expired', 'service', '{}'::jsonb
    from expired
    returning 1
  )
  select count(*) into affected from inserted;

  return affected;
end;
$$;

revoke all on function public.eos_expire_autonomy_approvals_v12() from public, anon, authenticated;
grant execute on function public.eos_expire_autonomy_approvals_v12() to service_role;

alter table public.eos_autonomy_profiles_v12 enable row level security;
alter table public.eos_autonomy_rules_v12 enable row level security;
alter table public.eos_action_approvals_v12 enable row level security;
alter table public.eos_autonomy_events_v12 enable row level security;

create policy eos_autonomy_profiles_select_own_v12
on public.eos_autonomy_profiles_v12 for select to authenticated
using ((select auth.uid()) = usuario_id);
create policy eos_autonomy_profiles_insert_own_v12
on public.eos_autonomy_profiles_v12 for insert to authenticated
with check ((select auth.uid()) = usuario_id);
create policy eos_autonomy_profiles_update_own_v12
on public.eos_autonomy_profiles_v12 for update to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

create policy eos_autonomy_rules_select_own_v12
on public.eos_autonomy_rules_v12 for select to authenticated
using ((select auth.uid()) = usuario_id);
create policy eos_autonomy_rules_insert_own_v12
on public.eos_autonomy_rules_v12 for insert to authenticated
with check ((select auth.uid()) = usuario_id);
create policy eos_autonomy_rules_update_own_v12
on public.eos_autonomy_rules_v12 for update to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);
create policy eos_autonomy_rules_delete_own_v12
on public.eos_autonomy_rules_v12 for delete to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_action_approvals_select_own_v12
on public.eos_action_approvals_v12 for select to authenticated
using ((select auth.uid()) = usuario_id);
create policy eos_action_approvals_update_own_v12
on public.eos_action_approvals_v12 for update to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

create policy eos_autonomy_events_select_own_v12
on public.eos_autonomy_events_v12 for select to authenticated
using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_autonomy_profiles_v12 from anon, authenticated;
revoke all on table public.eos_autonomy_rules_v12 from anon, authenticated;
revoke all on table public.eos_action_approvals_v12 from anon, authenticated;
revoke all on table public.eos_autonomy_events_v12 from anon, authenticated;

grant select, insert, update on table public.eos_autonomy_profiles_v12 to authenticated;
grant select, insert, update, delete on table public.eos_autonomy_rules_v12 to authenticated;
grant select, update on table public.eos_action_approvals_v12 to authenticated;
grant select on table public.eos_autonomy_events_v12 to authenticated;
grant all on table public.eos_autonomy_profiles_v12 to service_role;
grant all on table public.eos_autonomy_rules_v12 to service_role;
grant all on table public.eos_action_approvals_v12 to service_role;
grant all on table public.eos_autonomy_events_v12 to service_role;
grant usage, select on sequence public.eos_autonomy_events_v12_id_seq to service_role;

comment on table public.eos_autonomy_profiles_v12 is
  'Preferencias globales de autonomía configurables por usuario.';
comment on table public.eos_autonomy_rules_v12 is
  'Excepciones por tipo de acción: nivel permitido, riesgo y límites.';
comment on table public.eos_action_approvals_v12 is
  'Solicitudes de aprobación previas a una ejecución gobernada por EOS.';
comment on table public.eos_autonomy_events_v12 is
  'Bitácora de evaluaciones y decisiones del motor de autonomía.';

commit;
