-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

create table if not exists public.eos_worker_gate_audit_v15 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  request_id uuid not null,
  accion text not null,
  mode text not null default 'evaluate',
  decision text not null,
  execute boolean not null default false,
  command_id uuid references public.eos_action_commands(id) on delete set null,
  approval_id uuid references public.eos_action_approvals_v12(id) on delete set null,
  payload_fingerprint text,
  contract_version text not null,
  policy_version text not null,
  http_status integer not null default 200,
  reason text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint eos_worker_gate_audit_mode_check check (mode in ('evaluate', 'consume')),
  constraint eos_worker_gate_audit_decision_check check (
    decision in ('recommend', 'prepare', 'approval', 'approval_ready', 'allow', 'block')
  ),
  constraint eos_worker_gate_audit_http_status_check check (http_status between 100 and 599),
  constraint eos_worker_gate_audit_action_check check (
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

create index if not exists eos_worker_gate_audit_user_created_idx
  on public.eos_worker_gate_audit_v15 (usuario_id, created_at desc);

create index if not exists eos_worker_gate_audit_request_idx
  on public.eos_worker_gate_audit_v15 (usuario_id, request_id, accion, created_at desc);

create index if not exists eos_worker_gate_audit_command_idx
  on public.eos_worker_gate_audit_v15 (command_id, created_at desc)
  where command_id is not null;

create index if not exists eos_worker_gate_audit_approval_idx
  on public.eos_worker_gate_audit_v15 (approval_id, created_at desc)
  where approval_id is not null;

alter table public.eos_worker_gate_audit_v15 enable row level security;

drop policy if exists eos_worker_gate_audit_select_own_v15
  on public.eos_worker_gate_audit_v15;

create policy eos_worker_gate_audit_select_own_v15
on public.eos_worker_gate_audit_v15
for select
to authenticated
using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_worker_gate_audit_v15 from anon, authenticated;
grant select on table public.eos_worker_gate_audit_v15 to authenticated;
grant all on table public.eos_worker_gate_audit_v15 to service_role;

comment on table public.eos_worker_gate_audit_v15 is
  'Bitácora de decisiones del contrato Worker → Gate. No almacena secretos ni payloads completos.';

comment on column public.eos_worker_gate_audit_v15.payload_fingerprint is
  'SHA-256 estable del payload evaluado; permite correlación sin duplicar el contenido.';

commit;
