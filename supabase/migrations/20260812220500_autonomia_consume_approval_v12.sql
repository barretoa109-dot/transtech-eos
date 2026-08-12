begin;

create or replace function public.eos_consume_action_approval_v12(
  p_approval_id uuid,
  p_command_id uuid default null
)
returns table (
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
  command_owner uuid;
begin
  select *
  into approval
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

  if p_command_id is not null then
    select command.usuario_id
    into command_owner
    from public.eos_action_commands as command
    where command.id = p_command_id;

    if command_owner is null or command_owner <> approval.usuario_id then
      raise exception 'La orden no pertenece al propietario de la aprobación.';
    end if;
  end if;

  update public.eos_action_approvals_v12
  set
    status = 'consumed',
    command_id = coalesce(p_command_id, command_id),
    decided_at = coalesce(decided_at, now())
  where id = approval.id;

  insert into public.eos_autonomy_events_v12 (
    usuario_id,
    approval_id,
    command_id,
    event_type,
    actor,
    detail
  ) values (
    approval.usuario_id,
    approval.id,
    coalesce(p_command_id, approval.command_id),
    'consumed',
    'service',
    jsonb_build_object(
      'request_id', approval.request_id,
      'accion', approval.accion,
      'risk_tier', approval.risk_tier,
      'risk_points', approval.risk_points
    )
  );

  return query
  select
    approval.id,
    approval.usuario_id,
    approval.request_id,
    approval.accion,
    true;
end;
$$;

revoke all on function public.eos_consume_action_approval_v12(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.eos_consume_action_approval_v12(uuid, uuid)
  to service_role;

comment on function public.eos_consume_action_approval_v12(uuid, uuid) is
  'Consume atómicamente una aprobación explícita una única vez antes/durante la ejecución confiable. Solo service_role.';

commit;
