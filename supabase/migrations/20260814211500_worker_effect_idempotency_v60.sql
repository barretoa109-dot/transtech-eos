begin;

-- EOS 4.0 RC1 v60
-- Binds the two durable Worker effects that still lacked a command-level
-- idempotency key (memory + goal command) to eos_action_commands.

alter table public.eos_memory
  add column if not exists action_command_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_memory_action_command_id_fkey'
      and conrelid = 'public.eos_memory'::regclass
  ) then
    alter table public.eos_memory
      add constraint eos_memory_action_command_id_fkey
      foreign key (action_command_id)
      references public.eos_action_commands(id)
      on delete set null;
  end if;
end;
$$;

create unique index if not exists eos_memory_action_command_uidx
  on public.eos_memory (action_command_id)
  where action_command_id is not null;

create or replace function public.eos_preserve_memory_action_command_v60()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and new.action_command_id is not null then
      raise exception 'action_command_id es administrado exclusivamente por EOS.';
    end if;

    if tg_op = 'UPDATE'
      and old.action_command_id is distinct from new.action_command_id then
      raise exception 'action_command_id es administrado exclusivamente por EOS.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists eos_memory_preserve_action_command_v60
  on public.eos_memory;
create trigger eos_memory_preserve_action_command_v60
before insert or update on public.eos_memory
for each row
execute function public.eos_preserve_memory_action_command_v60();

-- Keep the existing own-user memory contract, but prevent clients from
-- forging the internal command binding on INSERT.
drop policy if exists eos_memory_insert_propios on public.eos_memory;
create policy eos_memory_insert_propios
on public.eos_memory
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid())::text = usuario_id::text
  and action_command_id is null
);

alter table public.eos_goal_commands
  add column if not exists action_command_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_goal_commands_action_command_id_fkey'
      and conrelid = 'public.eos_goal_commands'::regclass
  ) then
    alter table public.eos_goal_commands
      add constraint eos_goal_commands_action_command_id_fkey
      foreign key (action_command_id)
      references public.eos_action_commands(id)
      on delete set null;
  end if;
end;
$$;

create unique index if not exists eos_goal_commands_action_command_uidx
  on public.eos_goal_commands (action_command_id)
  where action_command_id is not null;

comment on column public.eos_memory.action_command_id is
  'Orden EOS que originó la memoria. v60 impide duplicar el efecto del Worker.';
comment on column public.eos_goal_commands.action_command_id is
  'Orden EOS que originó el comando de objetivo. v60 impide duplicar el efecto del Worker.';

commit;
