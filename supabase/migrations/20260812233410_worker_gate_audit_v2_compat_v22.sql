-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

create or replace function public.eos_consume_action_approval_v12(
  p_approval_id uuid,
  p_command_id uuid default null
)
returns table(
  approval_id uuid,
  usuario_id uuid,
  request_id uuid,
  accion text,
  consumed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval public.eos_action_approvals_v12%rowtype;
  command_row public.eos_action_commands%rowtype;
begin
  if p_command_id is null then
    raise exception 'command_id es obligatorio para consumir una aprobación.';
  end if;

  select * into approval
  from public.eos_action_approvals_v12
  where id = p_approval_id
  for update;

  if approval.id is null then
    raise exception 'Aprobación no encontrada.';
  end if;

  if approval.status <> 'approved' then
    raise exception 'La aprobación no está disponible para consumo. Estado: %', approval.status;
  end if;

  if approval.expires_at <= now() then
    update public.eos_action_approvals_v12
    set status = 'expired', decided_at = coalesce(decided_at, now())
    where id = approval.id;
    raise exception 'La aprobación ya venció.';
  end if;

  select * into command_row
  from public.eos_action_commands
  where id = p_command_id
  for update;

  if command_row.id is null then
    raise exception 'La orden indicada no existe.';
  end if;

  if command_row.usuario_id <> approval.usuario_id then
    raise exception 'La orden no pertenece al propietario de la aprobación.';
  end if;

  if command_row.request_id <> approval.request_id then
    raise exception 'La orden no corresponde al request_id aprobado.';
  end if;

  if command_row.accion <> approval.accion then
    raise exception 'La orden no corresponde a la acción aprobada.';
  end if;

  if command_row.estado not in ('recibida', 'ejecutando') then
    raise exception 'La orden está en estado terminal/no ejecutable: %', command_row.estado;
  end if;

  update public.eos_action_approvals_v12
  set status = 'consumed',
      command_id = p_command_id,
      decided_at = coalesce(decided_at, now())
  where id = approval.id;

  insert into public.eos_autonomy_events_v12 (
    usuario_id, approval_id, command_id, event_type, actor, detail
  ) values (
    approval.usuario_id,
    approval.id,
    p_command_id,
    'consumed',
    'service',
    jsonb_build_object(
      'request_id', approval.request_id,
      'accion', approval.accion,
      'risk_tier', approval.risk_tier,
      'risk_points', approval.risk_points,
      'command_state', command_row.estado,
      'binding_verified', true,
      'policy_version', 'eos-worker-gate-v2'
    )
  );

  return query
  select approval.id, approval.usuario_id, approval.request_id, approval.accion, true;
end;
$$;

revoke all on function public.eos_consume_action_approval_v12(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.eos_consume_action_approval_v12(uuid, uuid)
  to service_role;

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
    if v_policy_version not in ('eos-worker-gate-v1', 'eos-worker-gate-v2') then
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
    v_policy_version := coalesce(v_policy_version, 'eos-worker-gate-v2');
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
    coalesce(v_policy_version, 'eos-worker-gate-v2'),
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

revoke all on function public.eos_mirror_worker_gate_audit_v15()
  from public, anon, authenticated;
grant execute on function public.eos_mirror_worker_gate_audit_v15()
  to service_role;

comment on function public.eos_mirror_worker_gate_audit_v15() is
  'Refleja eventos Worker Gate v1/v2 y consumos one-shot en la bitácora sin guardar payloads completos.';

commit;
