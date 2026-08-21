-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

create table if not exists public.eos_master_context_source_state_v33 (
  usuario_id uuid primary key references public.usuarios(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  changed_at timestamptz not null default now(),
  last_source text,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.eos_master_context_source_state_v33 enable row level security;
revoke all on table public.eos_master_context_source_state_v33 from public, anon, authenticated;
grant all on table public.eos_master_context_source_state_v33 to service_role;

insert into public.eos_master_context_source_state_v33 (usuario_id, revision, changed_at, last_source)
select u.id, 0, now(), 'v33-baseline'
from public.usuarios u
on conflict (usuario_id) do nothing;

create or replace function public.eos_invalidate_master_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  v_source text := tg_table_name;
begin
  if tg_table_name = 'usuarios' then
    if tg_op = 'DELETE' then
      owner_id := old.id;
    else
      owner_id := new.id;
    end if;
  elsif tg_op = 'DELETE' then
    owner_id := old.usuario_id;
  else
    owner_id := new.usuario_id;
  end if;

  if owner_id is not null then
    insert into public.eos_master_context_source_state_v33 (
      usuario_id,
      revision,
      changed_at,
      last_source,
      metadata
    ) values (
      owner_id,
      1,
      now(),
      v_source,
      jsonb_build_object('trigger_op', tg_op)
    )
    on conflict (usuario_id) do update set
      revision = public.eos_master_context_source_state_v33.revision + 1,
      changed_at = excluded.changed_at,
      last_source = excluded.last_source,
      metadata = excluded.metadata;

    update public.eos_master_contexts
    set vigente_hasta = least(vigente_hasta, now())
    where usuario_id = owner_id
      and vigente_hasta > now();
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.eos_invalidate_master_context() from public, anon, authenticated;
grant execute on function public.eos_invalidate_master_context() to service_role;

drop trigger if exists usuarios_invalidate_master_context_v33 on public.usuarios;
create trigger usuarios_invalidate_master_context_v33
after update of nombre, plan on public.usuarios
for each row
when (old.nombre is distinct from new.nombre or old.plan is distinct from new.plan)
execute function public.eos_invalidate_master_context();

create or replace function public.eos_get_master_context_source_revision_v33()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_revision bigint;
begin
  if v_uid is null then
    raise exception 'EOS_UNAUTHENTICATED';
  end if;

  if not exists (select 1 from public.usuarios where id = v_uid) then
    raise exception 'EOS_CONTEXT_USER_NOT_FOUND';
  end if;

  insert into public.eos_master_context_source_state_v33 (usuario_id, revision, changed_at, last_source)
  values (v_uid, 0, now(), 'revision-read-init')
  on conflict (usuario_id) do nothing;

  select s.revision into v_revision
  from public.eos_master_context_source_state_v33 s
  where s.usuario_id = v_uid;

  return coalesce(v_revision, 0);
end;
$$;

revoke all on function public.eos_get_master_context_source_revision_v33() from public, anon, service_role;
grant execute on function public.eos_get_master_context_source_revision_v33() to authenticated;

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
  v_revision bigint;
begin
  if v_uid is null then
    raise exception 'EOS_UNAUTHENTICATED';
  end if;

  if p_request_id is null then
    raise exception 'EOS_CONTEXT_REQUEST_ID_REQUIRED';
  end if;

  if p_source_revision is null or p_source_revision < 0 then
    raise exception 'EOS_CONTEXT_SOURCE_REVISION_REQUIRED';
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
      'idempotent', true,
      'source_revision', p_source_revision,
      'stale', v_context.vigente_hasta <= now()
    );
  end if;

  insert into public.eos_master_context_source_state_v33 (usuario_id, revision, changed_at, last_source)
  values (v_uid, 0, now(), 'commit-init')
  on conflict (usuario_id) do nothing;

  select s.revision
    into v_revision
  from public.eos_master_context_source_state_v33 s
  where s.usuario_id = v_uid
  for update;

  if v_revision is distinct from p_source_revision then
    raise exception 'EOS_CONTEXT_SOURCE_CHANGED';
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
    jsonb_build_object(
      'commit_version', 'v33',
      'atomic', true,
      'source_revision', v_revision,
      'source_revision_guard', true
    )
  );

  return jsonb_build_object(
    'context', to_jsonb(v_context),
    'changed', v_changed,
    'idempotent', false,
    'source_revision', v_revision,
    'stale', false
  );
end;
$$;

revoke all on function public.eos_commit_master_context_v33(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, jsonb, jsonb, integer) from public, anon, service_role;
grant execute on function public.eos_commit_master_context_v33(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, jsonb, jsonb, integer) to authenticated;

comment on table public.eos_master_context_source_state_v33 is
  'Revision monotona por usuario de las fuentes canonicas del Contexto Maestro; evita publicar como fresco un rebuild que perdio una carrera contra una mutacion.';
comment on function public.eos_get_master_context_source_revision_v33() is
  'Devuelve la revision self-scoped que debe acompañar un rebuild de Contexto Maestro.';
comment on function public.eos_commit_master_context_v33(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, jsonb, jsonb, integer) is
  'RC1 v33: commit atomico del Contexto Maestro condicionado a que ninguna fuente canonica haya cambiado desde el inicio del rebuild.';
