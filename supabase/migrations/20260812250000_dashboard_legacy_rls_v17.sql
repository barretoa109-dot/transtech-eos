begin;

-- Dashboard legacy compatibility: expose only the rows owned by the current
-- authenticated user. These tables already had RLS enabled but no policies,
-- which made the current dashboard client reads effectively deny-all.

-- actividad_reciente: dashboard reads and inserts own activity entries.
drop policy if exists actividad_reciente_select_own_v17 on public.actividad_reciente;
create policy actividad_reciente_select_own_v17
on public.actividad_reciente
for select
to authenticated
using ((select auth.uid()) = usuario_id);

drop policy if exists actividad_reciente_insert_own_v17 on public.actividad_reciente;
create policy actividad_reciente_insert_own_v17
on public.actividad_reciente
for insert
to authenticated
with check ((select auth.uid()) = usuario_id);

revoke all on table public.actividad_reciente from anon, authenticated;
grant select, insert on table public.actividad_reciente to authenticated;
grant all on table public.actividad_reciente to service_role;

create index if not exists actividad_reciente_usuario_created_idx_v17
  on public.actividad_reciente (usuario_id, created_at desc);

-- dashboard_ia: dashboard only reads the latest own row.
drop policy if exists dashboard_ia_select_own_v17 on public.dashboard_ia;
create policy dashboard_ia_select_own_v17
on public.dashboard_ia
for select
to authenticated
using ((select auth.uid())::text = usuario_id);

revoke all on table public.dashboard_ia from anon, authenticated;
grant select on table public.dashboard_ia to authenticated;
grant all on table public.dashboard_ia to service_role;

create index if not exists dashboard_ia_usuario_created_idx_v17
  on public.dashboard_ia (usuario_id, created_at desc);

-- seguimientos: legacy dashboard reads own follow-up rows. Writes remain server-only.
drop policy if exists seguimientos_select_own_v17 on public.seguimientos;
create policy seguimientos_select_own_v17
on public.seguimientos
for select
to authenticated
using ((select auth.uid()) = usuario_id);

revoke all on table public.seguimientos from anon, authenticated;
grant select on table public.seguimientos to authenticated;
grant all on table public.seguimientos to service_role;

create index if not exists seguimientos_usuario_created_idx_v17
  on public.seguimientos (usuario_id, created_at desc);

commit;
