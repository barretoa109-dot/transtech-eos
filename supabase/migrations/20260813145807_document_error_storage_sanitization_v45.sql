begin;

alter table public.eos_document_intelligence_runs_v11
  add column if not exists error_code text;

create or replace function public.eos_sanitize_document_run_error_v45()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_raw text := btrim(coalesce(new.error_message, ''));
begin
  if v_raw = '' then
    new.error_message := null;
    if new.status <> 'error' then
      new.error_code := null;
    end if;
    return new;
  end if;

  if v_raw ilike '%EOS_STALE_ANALYSIS_RUN%' then
    new.error_code := 'EOS_STALE_ANALYSIS_RUN';
    new.error_message := 'El análisis fue reemplazado por una ejecución más reciente.';
  else
    new.error_code := coalesce(nullif(btrim(new.error_code), ''), 'EOS_DOCUMENT_ANALYSIS_FAILED');
    new.error_message := 'No se pudo completar el análisis documental.';
  end if;

  return new;
end;
$$;

create or replace function public.eos_sanitize_document_error_v45()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_has_extraction_error boolean := v_metadata ? 'extraction_error';
  v_raw_error text := btrim(coalesce(new.error_message, ''));
begin
  if v_has_extraction_error then
    new.metadata := (v_metadata - 'extraction_error') || jsonb_build_object(
      'extraction_error_code', 'EOS_DOCUMENT_EXTRACTION_FAILED'
    );
  end if;

  if v_raw_error <> '' then
    new.error_code := coalesce(nullif(btrim(new.error_code), ''), 'EOS_DOCUMENT_PROCESSING_FAILED');
    new.error_message := 'No se pudo procesar el documento.';
  elsif new.error_message is not null then
    new.error_message := null;
  end if;

  return new;
end;
$$;

revoke all on function public.eos_sanitize_document_run_error_v45() from public, anon, authenticated;
revoke all on function public.eos_sanitize_document_error_v45() from public, anon, authenticated;
grant execute on function public.eos_sanitize_document_run_error_v45() to service_role;
grant execute on function public.eos_sanitize_document_error_v45() to service_role;

drop trigger if exists eos_document_run_error_sanitize_v45 on public.eos_document_intelligence_runs_v11;
create trigger eos_document_run_error_sanitize_v45
before insert or update of error_message, error_code, status
on public.eos_document_intelligence_runs_v11
for each row execute function public.eos_sanitize_document_run_error_v45();

drop trigger if exists eos_document_error_sanitize_v45 on public.eos_documents_v11;
create trigger eos_document_error_sanitize_v45
before insert or update of error_message, error_code, metadata
on public.eos_documents_v11
for each row execute function public.eos_sanitize_document_error_v45();

comment on function public.eos_sanitize_document_run_error_v45() is
  'Sanitiza errores persistidos de runs documentales para evitar exponer detalles internos en filas visibles por RLS.';
comment on function public.eos_sanitize_document_error_v45() is
  'Elimina detalles técnicos de extracción/procesamiento antes de persistir documentos visibles por el usuario.';

commit;
