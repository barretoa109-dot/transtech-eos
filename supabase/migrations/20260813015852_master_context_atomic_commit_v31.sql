-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

create or replace function public.eos_commit_master_context_v31(
  p_request_id uuid,
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
begin
  if v_uid is null then
    raise exception 'EOS_UNAUTHENTICATED';
  end if;

  if p_request_id is null then
    raise exception 'EOS_CONTEXT_REQUEST_ID_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_source_fingerprint, '')), '') is null then
    raise exception 'EOS_CONTEXT_FINGERPRINT_REQUIRED';
  end if;

  if p_duration_ms is not null and p_duration_ms < 0 then
    raise exception 'EOS_CONTEXT_DURATION_INVALID';
  end if;

  perform 1
  from public.usuarios
  where id = v_uid
  for update;

  if not found then
    raise exception 'EOS_CONTEXT_USER_NOT_FOUND';
  end if;

  select r.changed
    into v_existing_changed
  from public.eos_master_context_runs r
  where r.usuario_id = v_uid
    and r.request_id = p_request_id;

  if found then
    select c.*
      into v_context
    from public.eos_master_contexts c
    where c.usuario_id = v_uid;

    if not found then
      raise exception 'EOS_CONTEXT_IDEMPOTENCY_STATE_INVALID';
    end if;

    return jsonb_build_object(
      'context', to_jsonb(v_context),
      'changed', v_existing_changed,
      'idempotent', true
    );
  end if;

  select c.*
    into v_context
  from public.eos_master_contexts c
  where c.usuario_id = v_uid
  for update;

  if found then
    v_changed := v_context.source_fingerprint is distinct from p_source_fingerprint;
    v_version := case when v_changed then v_context.version + 1 else v_context.version end;
  end if;

  insert into public.eos_master_contexts (
    usuario_id,
    version,
    identidad,
    estado_actual,
    objetivos,
    proyectos,
    compromisos,
    alertas,
    decisiones_recientes,
    aprendizajes,
    proxima_mejor_accion,
    resumen_compacto,
    source_fingerprint,
    fuentes,
    generado_at,
    vigente_hasta
  ) values (
    v_uid,
    v_version,
    coalesce(p_identidad, '{}'::jsonb),
    coalesce(p_estado_actual, '{}'::jsonb),
    coalesce(p_objetivos, '[]'::jsonb),
    coalesce(p_proyectos, '[]'::jsonb),
    coalesce(p_compromisos, '[]'::jsonb),
    coalesce(p_alertas, '[]'::jsonb),
    coalesce(p_decisiones_recientes, '[]'::jsonb),
    coalesce(p_aprendizajes, '[]'::jsonb),
    coalesce(p_proxima_mejor_accion, '{}'::jsonb),
    left(btrim(coalesce(p_resumen_compacto, '')), 6000),
    p_source_fingerprint,
    coalesce(p_fuentes, '{}'::jsonb),
    now(),
    now() + interval '6 hours'
  )
  on conflict (usuario_id) do update set
    version = excluded.version,
    identidad = excluded.identidad,
    estado_actual = excluded.estado_actual,
    objetivos = excluded.objetivos,
    proyectos = excluded.proyectos,
    compromisos = excluded.compromisos,
    alertas = excluded.alertas,
    decisiones_recientes = excluded.decisiones_recientes,
    aprendizajes = excluded.aprendizajes,
    proxima_mejor_accion = excluded.proxima_mejor_accion,
    resumen_compacto = excluded.resumen_compacto,
    source_fingerprint = excluded.source_fingerprint,
    fuentes = excluded.fuentes,
    generado_at = excluded.generado_at,
    vigente_hasta = excluded.vigente_hasta
  returning * into v_context;

  insert into public.eos_master_context_runs (
    usuario_id,
    request_id,
    trigger_source,
    source_fingerprint,
    changed,
    section_counts,
    duration_ms,
    generated_at,
    metadata
  ) values (
    v_uid,
    p_request_id,
    left(coalesce(nullif(btrim(p_trigger_source), ''), 'eos-web'), 80),
    p_source_fingerprint,
    v_changed,
    coalesce(p_section_counts, '{}'::jsonb),
    p_duration_ms,
    now(),
    jsonb_build_object('commit_version', 'v31', 'atomic', true)
  );

  return jsonb_build_object(
    'context', to_jsonb(v_context),
    'changed', v_changed,
    'idempotent', false
  );
end;
$$;

revoke all on function public.eos_commit_master_context_v31(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, jsonb, jsonb, integer) from public, anon, service_role;
grant execute on function public.eos_commit_master_context_v31(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, jsonb, jsonb, integer) to authenticated;

comment on function public.eos_commit_master_context_v31(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, jsonb, jsonb, integer) is
  'RC1 v31: commit atomico, idempotente y serializado del Contexto Maestro; version y run se persisten en la misma transaccion.';
