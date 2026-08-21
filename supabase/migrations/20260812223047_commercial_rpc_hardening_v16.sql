-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

revoke all on function public.asignar_plan_eos(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.asignar_plan_eos(uuid, text, integer)
  to service_role;

revoke all on function public.handle_new_user()
  from public, anon, authenticated;
grant execute on function public.handle_new_user()
  to service_role;

revoke all on function public.rls_auto_enable()
  from public, anon, authenticated;
grant execute on function public.rls_auto_enable()
  to service_role;

alter function public.eos_suscripcion_vigente(uuid)
  rename to eos_suscripcion_vigente_internal_v1;
alter function public.tiene_permiso_eos(uuid, text)
  rename to tiene_permiso_eos_internal_v1;
alter function public.obtener_estado_comercial_eos(uuid)
  rename to obtener_estado_comercial_eos_internal_v1;
alter function public.registrar_consumo_eos(uuid, text, integer, bigint, bigint, numeric)
  rename to registrar_consumo_eos_internal_v1;

revoke all on function public.eos_suscripcion_vigente_internal_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.tiene_permiso_eos_internal_v1(uuid, text)
  from public, anon, authenticated;
revoke all on function public.obtener_estado_comercial_eos_internal_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.registrar_consumo_eos_internal_v1(uuid, text, integer, bigint, bigint, numeric)
  from public, anon, authenticated;

grant execute on function public.eos_suscripcion_vigente_internal_v1(uuid)
  to service_role;
grant execute on function public.tiene_permiso_eos_internal_v1(uuid, text)
  to service_role;
grant execute on function public.obtener_estado_comercial_eos_internal_v1(uuid)
  to service_role;
grant execute on function public.registrar_consumo_eos_internal_v1(uuid, text, integer, bigint, bigint, numeric)
  to service_role;

create or replace function public.eos_suscripcion_vigente(p_usuario_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := auth.role();
  v_uid uuid := auth.uid();
begin
  if v_role = 'anon' then
    raise exception 'EOS_AUTH_REQUIRED';
  end if;

  if v_role = 'authenticated' and v_uid is distinct from p_usuario_id then
    raise exception 'EOS_FORBIDDEN_USER_SCOPE';
  end if;

  if v_role is not null and v_role not in ('authenticated', 'service_role') then
    raise exception 'EOS_FORBIDDEN_ROLE';
  end if;

  return public.eos_suscripcion_vigente_internal_v1(p_usuario_id);
end;
$$;

create or replace function public.tiene_permiso_eos(
  p_usuario_id uuid,
  p_funcion_codigo text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := auth.role();
  v_uid uuid := auth.uid();
begin
  if v_role = 'anon' then
    raise exception 'EOS_AUTH_REQUIRED';
  end if;

  if v_role = 'authenticated' and v_uid is distinct from p_usuario_id then
    raise exception 'EOS_FORBIDDEN_USER_SCOPE';
  end if;

  if v_role is not null and v_role not in ('authenticated', 'service_role') then
    raise exception 'EOS_FORBIDDEN_ROLE';
  end if;

  return public.tiene_permiso_eos_internal_v1(
    p_usuario_id,
    p_funcion_codigo
  );
end;
$$;

create or replace function public.obtener_estado_comercial_eos(p_usuario_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := auth.role();
  v_uid uuid := auth.uid();
begin
  if v_role = 'anon' then
    raise exception 'EOS_AUTH_REQUIRED';
  end if;

  if v_role = 'authenticated' and v_uid is distinct from p_usuario_id then
    raise exception 'EOS_FORBIDDEN_USER_SCOPE';
  end if;

  if v_role is not null and v_role not in ('authenticated', 'service_role') then
    raise exception 'EOS_FORBIDDEN_ROLE';
  end if;

  return public.obtener_estado_comercial_eos_internal_v1(p_usuario_id);
end;
$$;

create or replace function public.registrar_consumo_eos(
  p_usuario_id uuid,
  p_tipo text,
  p_cantidad integer default 1,
  p_tokens_entrada bigint default 0,
  p_tokens_salida bigint default 0,
  p_costo_estimado_usd numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := auth.role();
  v_uid uuid := auth.uid();
begin
  if v_role = 'anon' then
    raise exception 'EOS_AUTH_REQUIRED';
  end if;

  if v_role = 'authenticated' and v_uid is distinct from p_usuario_id then
    raise exception 'EOS_FORBIDDEN_USER_SCOPE';
  end if;

  if v_role is not null and v_role not in ('authenticated', 'service_role') then
    raise exception 'EOS_FORBIDDEN_ROLE';
  end if;

  return public.registrar_consumo_eos_internal_v1(
    p_usuario_id,
    p_tipo,
    p_cantidad,
    p_tokens_entrada,
    p_tokens_salida,
    p_costo_estimado_usd
  );
end;
$$;

revoke all on function public.eos_suscripcion_vigente(uuid)
  from public, anon;
revoke all on function public.tiene_permiso_eos(uuid, text)
  from public, anon;
revoke all on function public.obtener_estado_comercial_eos(uuid)
  from public, anon;
revoke all on function public.registrar_consumo_eos(uuid, text, integer, bigint, bigint, numeric)
  from public, anon;

grant execute on function public.eos_suscripcion_vigente(uuid)
  to authenticated, service_role;
grant execute on function public.tiene_permiso_eos(uuid, text)
  to authenticated, service_role;
grant execute on function public.obtener_estado_comercial_eos(uuid)
  to authenticated, service_role;
grant execute on function public.registrar_consumo_eos(uuid, text, integer, bigint, bigint, numeric)
  to authenticated, service_role;

comment on function public.asignar_plan_eos(uuid, text, integer) is
  'Activación de plan reservada a service_role. Acceso cliente revocado en hardening v16.';
comment on function public.obtener_estado_comercial_eos(uuid) is
  'Wrapper compatible que permite a authenticated consultar solo su propio usuario y a service_role operar en servidor.';
comment on function public.registrar_consumo_eos(uuid, text, integer, bigint, bigint, numeric) is
  'Wrapper compatible que impide registrar consumo sobre otro usuario desde una sesión autenticada.';

commit;
