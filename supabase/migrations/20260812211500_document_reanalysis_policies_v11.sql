begin;

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

commit;
