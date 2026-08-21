-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

drop policy if exists "Allow insert tareas" on public.tareas;
drop policy if exists "Allow read tareas" on public.tareas;
drop policy if exists "Allow update tareas" on public.tareas;

drop policy if exists tareas_select_own_v18 on public.tareas;
create policy tareas_select_own_v18
on public.tareas
for select
to authenticated
using (((select auth.uid())::text) = usuario_id);

drop policy if exists tareas_insert_own_v18 on public.tareas;
create policy tareas_insert_own_v18
on public.tareas
for insert
to authenticated
with check (((select auth.uid())::text) = usuario_id);

drop policy if exists tareas_update_own_v18 on public.tareas;
create policy tareas_update_own_v18
on public.tareas
for update
to authenticated
using (((select auth.uid())::text) = usuario_id)
with check (((select auth.uid())::text) = usuario_id);

revoke all on table public.tareas from anon, authenticated;
grant select, insert, update on table public.tareas to authenticated;
grant all on table public.tareas to service_role;

create index if not exists tareas_usuario_created_idx_v18
  on public.tareas (usuario_id, created_at desc);

commit;
