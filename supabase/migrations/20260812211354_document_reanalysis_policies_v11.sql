-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

create policy eos_document_chunks_delete_own_v11
on public.eos_document_chunks_v11
for delete
to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_document_findings_delete_own_v11
on public.eos_document_findings_v11
for delete
to authenticated
using ((select auth.uid()) = usuario_id);

grant delete on table public.eos_document_chunks_v11 to authenticated;
grant delete on table public.eos_document_findings_v11 to authenticated;
