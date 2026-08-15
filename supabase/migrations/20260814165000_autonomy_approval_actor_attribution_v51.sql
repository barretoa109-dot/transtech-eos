begin;

create or replace function public.eos_log_approval_decision_v12()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_actor text := 'service';
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    if v_auth_uid is not null and v_auth_uid = new.usuario_id then
      v_actor := 'user';
    end if;

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
      v_actor,
      jsonb_build_object(
        'accion', new.accion,
        'risk_tier', new.risk_tier,
        'risk_points', new.risk_points,
        'effective_level', new.effective_level,
        'actor_attribution', case
          when v_actor = 'user' then 'auth_uid_matches_owner'
          else 'service_or_non_owner_context'
        end
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.eos_log_approval_decision_v12()
  from public, anon, authenticated;
grant execute on function public.eos_log_approval_decision_v12()
  to service_role;

comment on function public.eos_log_approval_decision_v12() is
  'Registra decisiones de aprobación; atribuye actor=user solo cuando auth.uid() coincide con el propietario, evitando depender de current_user dentro de SECURITY DEFINER.';

commit;
