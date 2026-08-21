-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

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
