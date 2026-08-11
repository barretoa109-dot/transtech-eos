begin;

drop policy if exists eos_goal_commands_service_only
on public.eos_goal_commands;

create policy eos_goal_commands_service_only
on public.eos_goal_commands
for all
to service_role
using (true)
with check (true);

commit;
