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
      'binding_verified', true
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

commit;
