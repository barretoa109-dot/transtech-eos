begin;

create or replace function public.eos_guard_action_execution_freshness_v72()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command public.eos_action_commands%rowtype;
  v_profile_enabled boolean;
  v_rule_enabled boolean;
  v_require_fresh boolean;
  v_context public.eos_master_context_v8%rowtype;
  v_is_claim boolean := coalesce(new.idempotency_key, '') like 'claim:%';
  v_is_internal_terminal boolean;
begin
  select c.*
  into v_command
  from public.eos_action_commands c
  where c.id = new.command_id;

  if not found then
    raise exception 'EOS_ACTION_COMMAND_NOT_FOUND';
  end if;

  v_is_internal_terminal :=
    coalesce(new.idempotency_key, '') like 'terminal:%'
    and v_command.accion in ('CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA');

  if not v_is_claim and not v_is_internal_terminal then
    return new;
  end if;

  select p.enabled
  into v_profile_enabled
  from public.eos_autonomy_profiles_v12 p
  where p.usuario_id = v_command.usuario_id;

  if v_profile_enabled is false then
    raise exception 'EOS_ACTION_AUTONOMY_DISABLED';
  end if;

  select r.enabled, r.require_fresh_context
  into v_rule_enabled, v_require_fresh
  from public.eos_autonomy_rules_v12 r
  where r.usuario_id = v_command.usuario_id
    and r.accion = v_command.accion;

  if found and v_rule_enabled is false then
    raise exception 'EOS_ACTION_RULE_DISABLED';
  end if;

  if coalesce(v_require_fresh, false) is not true then
    return new;
  end if;

  select c.*
  into v_context
  from public.eos_master_context_v8 c
  where c.usuario_id = v_command.usuario_id
  limit 1;

  if not found
     or v_context.necesita_actualizacion is distinct from false
     or v_context.vigente_hasta is null
     or v_context.vigente_hasta <= now() then
    raise exception 'EOS_ACTION_CONTEXT_STALE';
  end if;

  return new;
end;
$$;

revoke all on function public.eos_guard_action_execution_freshness_v72()
  from public, anon, authenticated;

drop trigger if exists eos_action_events_execution_freshness_v72
  on public.eos_action_events;

create trigger eos_action_events_execution_freshness_v72
before insert on public.eos_action_events
for each row
execute function public.eos_guard_action_execution_freshness_v72();

comment on function public.eos_guard_action_execution_freshness_v72() is
  'RC1 v72: fail-closed execution boundary. Claims and internal effects are rejected when autonomy/rule is disabled or a rule requires Contexto Maestro that is missing, marked stale, lacks expiry, or is expired.';

commit;
