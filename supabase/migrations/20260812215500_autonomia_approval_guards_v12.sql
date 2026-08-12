begin;

create or replace function public.eos_guard_user_approval_update_v12()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if old.usuario_id is distinct from new.usuario_id
      or old.command_id is distinct from new.command_id
      or old.request_id is distinct from new.request_id
      or old.accion is distinct from new.accion
      or old.risk_tier is distinct from new.risk_tier
      or old.risk_points is distinct from new.risk_points
      or old.requested_level is distinct from new.requested_level
      or old.effective_level is distinct from new.effective_level
      or old.reason is distinct from new.reason
      or old.payload_snapshot is distinct from new.payload_snapshot
      or old.payload_fingerprint is distinct from new.payload_fingerprint
      or old.expires_at is distinct from new.expires_at
      or old.created_at is distinct from new.created_at then
      raise exception 'Los datos de la solicitud de aprobación son administrados por EOS.';
    end if;

    if old.status <> 'pending' then
      raise exception 'La solicitud ya fue resuelta.';
    end if;

    if old.expires_at <= now() then
      raise exception 'La solicitud de aprobación ya venció.';
    end if;

    if new.status not in ('approved', 'rejected') then
      raise exception 'Solo podés aprobar o rechazar una solicitud pendiente.';
    end if;

    new.decided_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists eos_action_approvals_user_guard_v12
  on public.eos_action_approvals_v12;
create trigger eos_action_approvals_user_guard_v12
before update on public.eos_action_approvals_v12
for each row
execute function public.eos_guard_user_approval_update_v12();

create or replace function public.eos_log_approval_decision_v12()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    insert into public.eos_autonomy_events_v12 (
      usuario_id,
      approval_id,
      command_id,
      event_type,
      actor,
      detail
    ) values (
      new.usuario_id,
      new.id,
      new.command_id,
      new.status,
      case when current_user = 'authenticated' then 'user' else 'service' end,
      jsonb_build_object(
        'accion', new.accion,
        'risk_tier', new.risk_tier,
        'risk_points', new.risk_points,
        'effective_level', new.effective_level
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.eos_log_approval_decision_v12() from public;

drop trigger if exists eos_action_approvals_log_decision_v12
  on public.eos_action_approvals_v12;
create trigger eos_action_approvals_log_decision_v12
after update on public.eos_action_approvals_v12
for each row
execute function public.eos_log_approval_decision_v12();

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'eos-autonomy-approval-expiry-v12'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'eos-autonomy-approval-expiry-v12',
    '*/5 * * * *',
    'select public.eos_expire_autonomy_approvals_v12();'
  );
end;
$$;

comment on function public.eos_guard_user_approval_update_v12() is
  'Impide que el usuario altere riesgo, payload o identidad de una aprobación; solo permite aprobar o rechazar una solicitud propia vigente.';

commit;
