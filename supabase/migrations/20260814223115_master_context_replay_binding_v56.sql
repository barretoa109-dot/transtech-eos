-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

create or replace function public.eos_commit_master_context_v33(
  p_request_id uuid,
  p_source_revision bigint,
  p_trigger_source text,
  p_identidad jsonb,
  p_estado_actual jsonb,
  p_objetivos jsonb,
  p_proyectos jsonb,
  p_compromisos jsonb,
  p_alertas jsonb,
  p_decisiones_recientes jsonb,
  p_aprendizajes jsonb,
  p_proxima_mejor_accion jsonb,
  p_resumen_compacto text,
  p_source_fingerprint text,
  p_fuentes jsonb,
  p_section_counts jsonb,
  p_duration_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_context public.eos_master_contexts%rowtype;
  v_changed boolean := true;
  v_version integer := 1;
  v_existing_changed boolean;
  v_existing_fingerprint text;
  v_existing_source_revision bigint;
  v_revision bigint;
begin
  if v_uid is null then
    raise exception 'EOS_UNAUTHENTICATED';
  end if;
  if p_request_id is null then raise exception 'EOS_CONTEXT_REQUEST_ID_REQUIRED'; end if;
  if p_source_revision is null or p_source_revision < 0 then raise exception 'EOS_CONTEXT_SOURCE_REVISION_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_source_fingerprint, '')), '') is null then raise exception 'EOS_CONTEXT_FINGERPRINT_REQUIRED'; end if;
  if p_duration_ms is not null and p_duration_ms < 0 then raise exception 'EOS_CONTEXT_DURATION_INVALID'; end if;

  perform 1 from public.usuarios where id = v_uid for update;
  if not found then raise exception 'EOS_CONTEXT_USER_NOT_FOUND'; end if;

  select r.changed, r.source_fingerprint,
    case when coalesce(r.metadata->>'source_revision', '') ~ '^[0-9]+$' then (r.metadata->>'source_revision')::bigint else null end
  into v_existing_changed, v_existing_fingerprint, v_existing_source_revision
  from public.eos_master_context_runs r
  where r.usuario_id = v_uid and r.request_id = p_request_id;

  if found then
    if v_existing_fingerprint is distinct from p_source_fingerprint
      or v_existing_source_revision is null
      or v_existing_source_revision is distinct from p_source_revision then
      raise exception 'EOS_CONTEXT_REQUEST_CONFLICT';
    end if;

    select c.* into v_context
    from public.eos_master_contexts c
    where c.usuario_id = v_uid;

    if not found then raise exception 'EOS_CONTEXT_IDEMPOTENCY_STATE_INVALID'; end if;
    if v_context.source_fingerprint is distinct from v_existing_fingerprint then raise exception 'EOS_CONTEXT_IDEMPOTENCY_SUPERSEDED'; end if;

    return jsonb_build_object(
      'context', to_jsonb(v_context),
      'changed', v_existing_changed,
      'idempotent', true,
      'source_revision', v_existing_source_revision,
      'stale', v_context.vigente_hasta <= now()
    );
  end if;

  insert into public.eos_master_context_source_state_v33 (usuario_id, revision, changed_at, last_source)
  values (v_uid, 0, now(), 'commit-init')
  on conflict (usuario_id) do nothing;

  select s.revision into v_revision
  from public.eos_master_context_source_state_v33 s
  where s.usuario_id = v_uid
  for update;

  if v_revision is distinct from p_source_revision then raise exception 'EOS_CONTEXT_SOURCE_CHANGED'; end if;

  select c.* into v_context
  from public.eos_master_contexts c
  where c.usuario_id = v_uid
  for update;

  if found then
    v_changed := v_context.source_fingerprint is distinct from p_source_fingerprint;
    v_version := case when v_changed then v_context.version + 1 else v_context.version end;
  end if;

  insert into public.eos_master_contexts (
    usuario_id, version, identidad, estado_actual, objetivos, proyectos, compromisos, alertas,
    decisiones_recientes, aprendizajes, proxima_mejor_accion, resumen_compacto, source_fingerprint,
    fuentes, generado_at, vigente_hasta
  ) values (
    v_uid, v_version, coalesce(p_identidad,'{}'::jsonb), coalesce(p_estado_actual,'{}'::jsonb),
    coalesce(p_objetivos,'[]'::jsonb), coalesce(p_proyectos,'[]'::jsonb), coalesce(p_compromisos,'[]'::jsonb),
    coalesce(p_alertas,'[]'::jsonb), coalesce(p_decisiones_recientes,'[]'::jsonb), coalesce(p_aprendizajes,'[]'::jsonb),
    coalesce(p_proxima_mejor_accion,'{}'::jsonb), left(btrim(coalesce(p_resumen_compacto,'')),6000),
    p_source_fingerprint, coalesce(p_fuentes,'{}'::jsonb), now(), now()+interval '6 hours'
  )
  on conflict (usuario_id) do update set
    version=excluded.version, identidad=excluded.identidad, estado_actual=excluded.estado_actual,
    objetivos=excluded.objetivos, proyectos=excluded.proyectos, compromisos=excluded.compromisos,
    alertas=excluded.alertas, decisiones_recientes=excluded.decisiones_recientes, aprendizajes=excluded.aprendizajes,
    proxima_mejor_accion=excluded.proxima_mejor_accion, resumen_compacto=excluded.resumen_compacto,
    source_fingerprint=excluded.source_fingerprint, fuentes=excluded.fuentes, generado_at=excluded.generado_at,
    vigente_hasta=excluded.vigente_hasta
  returning * into v_context;

  insert into public.eos_master_context_runs (
    usuario_id, request_id, trigger_source, source_fingerprint, changed, section_counts,
    duration_ms, generated_at, metadata
  ) values (
    v_uid, p_request_id, left(coalesce(nullif(btrim(p_trigger_source),''),'eos-web'),80),
    p_source_fingerprint, v_changed, coalesce(p_section_counts,'{}'::jsonb), p_duration_ms, now(),
    jsonb_build_object('commit_version','v56','atomic',true,'source_revision',v_revision,
      'source_revision_guard',true,'request_fingerprint_binding',true)
  );

  return jsonb_build_object(
    'context', to_jsonb(v_context), 'changed', v_changed, 'idempotent', false,
    'source_revision', v_revision, 'stale', false
  );
end;
$$;

revoke all on function public.eos_commit_master_context_v33(
  uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,jsonb,jsonb,integer
) from public, anon, service_role;

grant execute on function public.eos_commit_master_context_v33(
  uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,jsonb,jsonb,integer
) to authenticated;

comment on function public.eos_commit_master_context_v33(
  uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,jsonb,jsonb,integer
) is 'RC1 v56: commit atomico de Contexto Maestro con source revision guard y binding estricto de request_id + fingerprint + revision para replays.';
