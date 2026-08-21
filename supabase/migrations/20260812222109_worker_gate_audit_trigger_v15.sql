-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

alter table public.eos_worker_gate_audit_v15
  add column if not exists autonomy_event_id bigint
    references public.eos_autonomy_events_v12(id) on delete set null;

create unique index if not exists eos_worker_gate_audit_autonomy_event_uidx
  on public.eos_worker_gate_audit_v15 (autonomy_event_id)
  where autonomy_event_id is not null;

create or replace function public.eos_mirror_worker_gate_audit_v15()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_action text;
  v_decision text;
  v_execute boolean := false;
  v_mode text := 'evaluate';
  v_reason text;
  v_payload_fingerprint text;
  v_policy_version text;
  v_contract_version text := 'eos-worker-gate-contract-v1';
begin
  if new.actor <> 'service' then
    return new;
  end if;

  v_policy_version := nullif(new.detail ->> 'policy_version', '');

  if new.event_type in ('evaluated', 'approval_requested', 'auto_allowed', 'auto_blocked') then
    if v_policy_version is distinct from 'eos-worker-gate-v1' then
      return new;
    end if;

    begin
      v_request_id := nullif(new.detail ->> 'request_id', '')::uuid;
    exception when others then
      return new;
    end;

    v_action := nullif(btrim(new.detail ->> 'accion'), '');
    if v_request_id is null or v_action is null then
      return new;
    end if;

    v_decision := case new.event_type
      when 'approval_requested' then 'approval'
      when 'auto_allowed' then 'allow'
      when 'auto_blocked' then 'block'
      else coalesce(nullif(new.detail ->> 'decision', ''), 'block')
    end;

    v_execute := new.event_type = 'auto_allowed';
    v_reason := nullif(new.detail ->> 'reason', '');

  elsif new.event_type = 'consumed' then
    if new.approval_id is null or new.command_id is null then
      return new;
    end if;

    select
      approval.request_id,
      approval.accion,
      approval.payload_fingerprint
    into
      v_request_id,
      v_action,
      v_payload_fingerprint
    from public.eos_action_approvals_v12 as approval
    where approval.id = new.approval_id;

    if v_request_id is null or v_action is null then
      return new;
    end if;

    v_mode := 'consume';
    v_decision := 'allow';
    v_execute := true;
    v_reason := 'Aprobación explícita consumida de forma atómica.';
    v_policy_version := 'eos-worker-gate-v1';
  else
    return new;
  end if;

  if v_payload_fingerprint is null and new.approval_id is not null then
    select approval.payload_fingerprint
    into v_payload_fingerprint
    from public.eos_action_approvals_v12 as approval
    where approval.id = new.approval_id;
  end if;

  insert into public.eos_worker_gate_audit_v15 (
    autonomy_event_id,
    usuario_id,
    request_id,
    accion,
    mode,
    decision,
    execute,
    command_id,
    approval_id,
    payload_fingerprint,
    contract_version,
    policy_version,
    http_status,
    reason,
    metadata
  ) values (
    new.id,
    new.usuario_id,
    v_request_id,
    v_action,
    v_mode,
    v_decision,
    v_execute,
    new.command_id,
    new.approval_id,
    v_payload_fingerprint,
    v_contract_version,
    coalesce(v_policy_version, 'eos-worker-gate-v1'),
    200,
    v_reason,
    jsonb_build_object(
      'source', 'eos_autonomy_events_v12',
      'event_type', new.event_type,
      'actor', new.actor
    )
  )
  on conflict (autonomy_event_id) where autonomy_event_id is not null
  do nothing;

  return new;
end;
$$;

revoke all on function public.eos_mirror_worker_gate_audit_v15() from public, anon, authenticated;

drop trigger if exists eos_autonomy_events_mirror_worker_gate_audit_v15
  on public.eos_autonomy_events_v12;

create trigger eos_autonomy_events_mirror_worker_gate_audit_v15
after insert on public.eos_autonomy_events_v12
for each row
execute function public.eos_mirror_worker_gate_audit_v15();

comment on function public.eos_mirror_worker_gate_audit_v15() is
  'Refleja decisiones del Worker Gate y consumos one-shot en la bitácora de integración sin guardar payloads completos.';

commit;
