-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

create or replace function public.eos_validate_document_child_owner_v11()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  select usuario_id
    into owner_id
  from public.eos_documents_v11
  where id = new.document_id;

  if owner_id is null then
    raise exception 'Document % does not exist', new.document_id
      using errcode = '23503';
  end if;

  if owner_id <> new.usuario_id then
    raise exception 'Document owner mismatch'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.eos_validate_document_child_owner_v11() from public;
grant execute on function public.eos_validate_document_child_owner_v11() to authenticated, service_role;

drop trigger if exists trg_eos_document_chunks_owner_v11 on public.eos_document_chunks_v11;
create trigger trg_eos_document_chunks_owner_v11
before insert or update on public.eos_document_chunks_v11
for each row execute function public.eos_validate_document_child_owner_v11();

drop trigger if exists trg_eos_document_findings_owner_v11 on public.eos_document_findings_v11;
create trigger trg_eos_document_findings_owner_v11
before insert or update on public.eos_document_findings_v11
for each row execute function public.eos_validate_document_child_owner_v11();

drop trigger if exists trg_eos_document_links_owner_v11 on public.eos_document_links_v11;
create trigger trg_eos_document_links_owner_v11
before insert or update on public.eos_document_links_v11
for each row execute function public.eos_validate_document_child_owner_v11();

drop trigger if exists trg_eos_document_runs_owner_v11 on public.eos_document_intelligence_runs_v11;
create trigger trg_eos_document_runs_owner_v11
before insert or update on public.eos_document_intelligence_runs_v11
for each row execute function public.eos_validate_document_child_owner_v11();
