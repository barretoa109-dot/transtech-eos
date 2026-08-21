-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

create or replace function public.eos_guard_action_execution_freshness_v72()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command public.eos_action_commands%rowtype;
  v_profile_enabled boolean;
  v_rule_enabled boolean;
  v_require_fresh boolean;
  v_context_fresh boolean := false;
  v_is_claim boolean := coalesce(new.idempotency_key, '') like 'claim:%';
  v_is_internal_terminal boolean;
begin
  select c.*
  into v_command
  from public.eos_action_commands c
  where c.id = new.command_id;

  if v_command.id is null then
    raise exception 'EOS_ACTION_COMMAND_NOT_FOUND';
  end if;

  v_is_internal_terminal :=
    coalesce(new.idempotency_key, '') like 'terminal:%'
    and v_command.accion in ('CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA');

  if not v_is_claim and not v_is_internal_terminal then
    return new;
  end if;

  select p.enabled
  into v_profile_enabled
  from public.eos_autonomy_profiles_v12 p
  where p.usuario_id = v_command.usuario_id;

  if v_profile_enabled is false then
    raise exception 'EOS_ACTION_AUTONOMY_DISABLED';
  end if;

  select r.enabled, r.require_fresh_context
  into v_rule_enabled, v_require_fresh
  from public.eos_autonomy_rules_v12 r
  where r.usuario_id = v_command.usuario_id
    and r.accion = v_command.accion;

  if v_rule_enabled is false then
    raise exception 'EOS_ACTION_RULE_DISABLED';
  end if;

  if coalesce(v_require_fresh, false) is not true then
    return new;
  end if;

  select (
    c.necesita_actualizacion is false
    and c.vigente_hasta is not null
    and c.vigente_hasta > now()
  )
  into v_context_fresh
  from public.eos_master_context_v8 c
  where c.usuario_id = v_command.usuario_id
  order by c.version desc nulls last, c.updated_at desc nulls last, c.id desc
  limit 1;

  if coalesce(v_context_fresh, false) is not true then
    raise exception 'EOS_ACTION_CONTEXT_STALE';
  end if;

  return new;
end;
$$;

comment on function public.eos_guard_action_execution_freshness_v72() is
  'RC1 v73: deterministic fail-closed execution boundary. Claims and internal effects evaluate the newest Contexto Maestro and reject disabled autonomy/rules or required context that is missing, stale or expired.';

commit;
