begin;

drop policy if exists eos_followup_runs_service_all
on public.eos_followup_runs;

create policy eos_followup_runs_service_all
on public.eos_followup_runs
for all
to service_role
using (true)
with check (true);

commit;
