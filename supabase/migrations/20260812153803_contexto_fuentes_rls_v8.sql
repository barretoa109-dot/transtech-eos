-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

revoke all on table public.eos_profiles from anon;
revoke all on table public.eos_projects from anon;

revoke all on table public.eos_profiles from authenticated;
revoke all on table public.eos_projects from authenticated;

grant select, insert, update, delete on table public.eos_profiles to authenticated;
grant select, insert, update, delete on table public.eos_projects to authenticated;
grant all on table public.eos_profiles to service_role;
grant all on table public.eos_projects to service_role;

drop policy if exists eos_profiles_select_own on public.eos_profiles;
create policy eos_profiles_select_own on public.eos_profiles
for select to authenticated
using ((select auth.uid()) = usuario_id);

drop policy if exists eos_profiles_insert_own on public.eos_profiles;
create policy eos_profiles_insert_own on public.eos_profiles
for insert to authenticated
with check ((select auth.uid()) = usuario_id);

drop policy if exists eos_profiles_update_own on public.eos_profiles;
create policy eos_profiles_update_own on public.eos_profiles
for update to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

drop policy if exists eos_profiles_delete_own on public.eos_profiles;
create policy eos_profiles_delete_own on public.eos_profiles
for delete to authenticated
using ((select auth.uid()) = usuario_id);

drop policy if exists eos_projects_select_own on public.eos_projects;
create policy eos_projects_select_own on public.eos_projects
for select to authenticated
using ((select auth.uid()) = usuario_id);

drop policy if exists eos_projects_insert_own on public.eos_projects;
create policy eos_projects_insert_own on public.eos_projects
for insert to authenticated
with check ((select auth.uid()) = usuario_id);

drop policy if exists eos_projects_update_own on public.eos_projects;
create policy eos_projects_update_own on public.eos_projects
for update to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

drop policy if exists eos_projects_delete_own on public.eos_projects;
create policy eos_projects_delete_own on public.eos_projects
for delete to authenticated
using ((select auth.uid()) = usuario_id);

drop trigger if exists eos_profiles_invalidate_master_context on public.eos_profiles;
create trigger eos_profiles_invalidate_master_context
after insert or update or delete on public.eos_profiles
for each row execute function public.eos_invalidate_master_context();

drop trigger if exists eos_projects_invalidate_master_context on public.eos_projects;
create trigger eos_projects_invalidate_master_context
after insert or update or delete on public.eos_projects
for each row execute function public.eos_invalidate_master_context();

commit;

