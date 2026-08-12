begin;

create or replace function public.eos_invalidate_master_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  if tg_op = 'DELETE' then
    owner_id := old.usuario_id;
  else
    owner_id := new.usuario_id;
  end if;

  if owner_id is not null then
    update public.eos_master_contexts
    set vigente_hasta = least(vigente_hasta, now())
    where usuario_id = owner_id
      and vigente_hasta > now();
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.eos_invalidate_master_context() from public, anon, authenticated;
grant execute on function public.eos_invalidate_master_context() to service_role;

drop trigger if exists eos_goals_invalidate_master_context on public.eos_goals;
create trigger eos_goals_invalidate_master_context
after insert or update or delete on public.eos_goals
for each row execute function public.eos_invalidate_master_context();

drop trigger if exists eos_decisions_invalidate_master_context on public.eos_decisions;
create trigger eos_decisions_invalidate_master_context
after insert or update or delete on public.eos_decisions
for each row execute function public.eos_invalidate_master_context();

drop trigger if exists eos_decision_results_invalidate_master_context on public.eos_decision_results;
create trigger eos_decision_results_invalidate_master_context
after insert or update or delete on public.eos_decision_results
for each row execute function public.eos_invalidate_master_context();

drop trigger if exists eos_action_commands_invalidate_master_context on public.eos_action_commands;
create trigger eos_action_commands_invalidate_master_context
after insert or update or delete on public.eos_action_commands
for each row execute function public.eos_invalidate_master_context();

drop trigger if exists eos_proactive_followups_invalidate_master_context on public.eos_proactive_followups;
create trigger eos_proactive_followups_invalidate_master_context
after insert or update or delete on public.eos_proactive_followups
for each row execute function public.eos_invalidate_master_context();

drop trigger if exists eos_learnings_invalidate_master_context on public.eos_learnings;
create trigger eos_learnings_invalidate_master_context
after insert or update or delete on public.eos_learnings
for each row execute function public.eos_invalidate_master_context();

comment on function public.eos_invalidate_master_context() is
  'Marca el Contexto Maestro como obsoleto cuando cambia una fuente ejecutiva canonica.';

commit;
