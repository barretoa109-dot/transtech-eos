-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

drop policy if exists "Allow read eos_kpis" on public.eos_kpis;
create policy eos_kpis_select_own_v19
on public.eos_kpis
for select
to authenticated
using ((select auth.uid()) = usuario_id);
revoke select on table public.eos_kpis from anon;
grant select on table public.eos_kpis to authenticated;
create index if not exists eos_kpis_usuario_created_idx_v19 on public.eos_kpis (usuario_id, created_at desc);

drop policy if exists "Allow read eos_tendencias" on public.eos_tendencias;
create policy eos_tendencias_select_own_v19
on public.eos_tendencias
for select
to authenticated
using ((select auth.uid()) = usuario_id);
revoke select on table public.eos_tendencias from anon;
grant select on table public.eos_tendencias to authenticated;
create index if not exists eos_tendencias_usuario_created_idx_v19 on public.eos_tendencias (usuario_id, created_at desc);

drop policy if exists "Allow read recomendaciones" on public.recomendaciones;
create policy recomendaciones_select_own_v19
on public.recomendaciones
for select
to authenticated
using ((select auth.uid()) = usuario_id);
revoke select on table public.recomendaciones from anon;
grant select on table public.recomendaciones to authenticated;
create index if not exists recomendaciones_usuario_created_idx_v19 on public.recomendaciones (usuario_id, created_at desc);

drop policy if exists "Allow read score_historico" on public.score_historico;
create policy score_historico_select_own_v19
on public.score_historico
for select
to authenticated
using ((select auth.uid()) = usuario_id);
revoke select on table public.score_historico from anon;
grant select on table public.score_historico to authenticated;
create index if not exists score_historico_usuario_created_idx_v19 on public.score_historico (usuario_id, created_at desc);

drop policy if exists "Allow read notificaciones" on public.notificaciones;
create policy notificaciones_select_own_v19
on public.notificaciones
for select
to authenticated
using (((select auth.uid())::text) = usuario_id);
revoke select on table public.notificaciones from anon;
grant select on table public.notificaciones to authenticated;
create index if not exists notificaciones_usuario_created_idx_v19 on public.notificaciones (usuario_id, created_at desc);

commit;
