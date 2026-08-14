create or replace function public.eos_commit_document_analysis_v29(
  p_document_id uuid,
  p_run_id uuid,
  p_summary text,
  p_chunks jsonb,
  p_findings jsonb,
  p_result jsonb,
  p_analysis_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_run_owner uuid;
begin
  if v_uid is null then
    raise exception 'EOS_UNAUTHENTICATED';
  end if;

  if jsonb_typeof(coalesce(p_chunks, '[]'::jsonb)) <> 'array' then
    raise exception 'EOS_INVALID_CHUNKS';
  end if;

  if jsonb_typeof(coalesce(p_findings, '[]'::jsonb)) <> 'array' then
    raise exception 'EOS_INVALID_FINDINGS';
  end if;

  select d.usuario_id
    into v_owner
  from public.eos_documents_v11 d
  where d.id = p_document_id
  for update;

  if not found then
    raise exception 'EOS_DOCUMENT_NOT_FOUND';
  end if;

  if v_owner <> v_uid then
    raise exception 'EOS_FORBIDDEN_DOCUMENT_SCOPE';
  end if;

  select r.usuario_id
    into v_run_owner
  from public.eos_document_intelligence_runs_v11 r
  where r.id = p_run_id
    and r.document_id = p_document_id
    and r.status = 'processing'
  for update;

  if not found then
    raise exception 'EOS_ANALYSIS_RUN_NOT_PROCESSING';
  end if;

  if v_run_owner <> v_uid then
    raise exception 'EOS_FORBIDDEN_RUN_SCOPE';
  end if;

  delete from public.eos_document_chunks_v11
  where document_id = p_document_id
    and usuario_id = v_uid;

  delete from public.eos_document_findings_v11
  where document_id = p_document_id
    and usuario_id = v_uid
    and status = 'active';

  insert into public.eos_document_chunks_v11 (
    document_id,
    usuario_id,
    chunk_index,
    content,
    char_start,
    char_end,
    metadata
  )
  select
    p_document_id,
    v_uid,
    x.chunk_index,
    x.content,
    x.char_start,
    x.char_end,
    coalesce(x.metadata, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as x(
    chunk_index integer,
    content text,
    char_start integer,
    char_end integer,
    metadata jsonb
  );

  insert into public.eos_document_findings_v11 (
    document_id,
    usuario_id,
    finding_type,
    title,
    value_text,
    normalized_value,
    evidence_text,
    confidence,
    importance,
    status,
    metadata
  )
  select
    p_document_id,
    v_uid,
    x.finding_type,
    x.title,
    x.value_text,
    coalesce(x.normalized_value, '{}'::jsonb),
    x.evidence_text,
    coalesce(x.confidence, 0.500),
    coalesce(x.importance, 3),
    'active',
    coalesce(x.metadata, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_findings, '[]'::jsonb)) as x(
    finding_type text,
    title text,
    value_text text,
    normalized_value jsonb,
    evidence_text text,
    confidence numeric,
    importance smallint,
    metadata jsonb
  );

  update public.eos_documents_v11
  set intelligence_status = 'ready',
      summary = left(coalesce(p_summary, ''), 1400),
      processed_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'intelligence',
          coalesce(p_analysis_metadata, '{}'::jsonb)
        )
  where id = p_document_id
    and usuario_id = v_uid;

  update public.eos_document_intelligence_runs_v11
  set status = 'completed',
      result = coalesce(p_result, '{}'::jsonb),
      error_message = null,
      completed_at = now()
  where id = p_run_id
    and document_id = p_document_id
    and usuario_id = v_uid
    and status = 'processing';

  if not found then
    raise exception 'EOS_ANALYSIS_RUN_COMMIT_FAILED';
  end if;

  return true;
end;
$$;

revoke all on function public.eos_commit_document_analysis_v29(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.eos_commit_document_analysis_v29(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to authenticated;
revoke execute on function public.eos_commit_document_analysis_v29(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from service_role;

comment on function public.eos_commit_document_analysis_v29(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) is
  'Fase 8 hardening v29: reemplaza chunks/hallazgos y cierra el run documental en una sola transacción self-scoped; un fallo revierte el reemplazo completo.';
