create or replace function public.eos_followup_guard_transition_v37()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  if old.estado in ('resuelto', 'descartado') then
    raise exception 'EOS_FOLLOWUP_CLOSED';
  end if;

  if old.estado = 'visto' and new.estado = 'pendiente' then
    raise exception 'EOS_FOLLOWUP_INVALID_REGRESSION';
  end if;

  return new;
end;
$$;

revoke all on function public.eos_followup_guard_transition_v37() from public, anon, authenticated;
grant execute on function public.eos_followup_guard_transition_v37() to service_role;

drop trigger if exists eos_followup_state_guard_v37 on public.eos_proactive_followups;
create trigger eos_followup_state_guard_v37
before update of estado on public.eos_proactive_followups
for each row execute function public.eos_followup_guard_transition_v37();

create or replace function public.eos_followup_prepare_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    if new.estado = 'visto' then
      new.visto_at := now();
      new.resuelto_at := null;
    elsif new.estado in ('resuelto', 'descartado') then
      new.visto_at := now();
      new.resuelto_at := now();
    else
      new.visto_at := null;
      new.resuelto_at := null;
    end if;
    return new;
  end if;

  if new.estado = 'pendiente' then
    new.visto_at := old.visto_at;
    new.resuelto_at := old.resuelto_at;
  elsif new.estado = 'visto' then
    new.visto_at := coalesce(old.visto_at, now());
    new.resuelto_at := old.resuelto_at;
  elsif new.estado in ('resuelto', 'descartado') then
    new.visto_at := coalesce(old.visto_at, now());
    new.resuelto_at := coalesce(old.resuelto_at, now());
  end if;

  return new;
end;
$$;

revoke all on function public.eos_followup_prepare_row() from public, anon, authenticated;
grant execute on function public.eos_followup_prepare_row() to service_role;

comment on function public.eos_followup_guard_transition_v37() is
  'RC1 v37: guard global de transiciones de seguimiento; estados terminales no pueden reabrirse ni visto volver a pendiente, incluso por acceso directo a tabla.';
comment on function public.eos_followup_prepare_row() is
  'RC1 v37: timestamps de seguimiento derivados de la transición real; ignora timestamps arbitrarios suministrados por clientes durante updates.';