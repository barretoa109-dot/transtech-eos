begin;

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

do $$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array[
    'eos_document_chunks_v11',
    'eos_document_findings_v11',
    'eos_document_links_v11',
    'eos_document_intelligence_runs_v11'
  ]
  loop
    trigger_name := table_name || '_owner_guard';

    execute format('drop trigger if exists %I on public.%I', trigger_name, table_name);
    execute format(
      'create trigger %I before insert or update of document_id, usuario_id on public.%I for each row execute function public.eos_validate_document_child_owner_v11()',
      trigger_name,
      table_name
    );
  end loop;
end;
$$;

comment on function public.eos_validate_document_child_owner_v11() is
  'Impide que chunks, hallazgos, links o runs de Document Intelligence queden asociados a documentos pertenecientes a otro usuario.';

commit;
