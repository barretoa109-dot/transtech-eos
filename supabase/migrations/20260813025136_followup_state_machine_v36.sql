-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

create or replace function public.eos_transition_followup_v36(
  p_followup_id uuid,
  p_estado text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current public.eos_proactive_followups%rowtype;
  v_saved public.eos_proactive_followups%rowtype;
begin
  if v_uid is null then
    raise exception 'EOS_UNAUTHENTICATED';
  end if;

  if p_followup_id is null then
    raise exception 'EOS_FOLLOWUP_ID_REQUIRED';
  end if;

  if p_estado not in ('visto', 'resuelto', 'descartado') then
    raise exception 'EOS_FOLLOWUP_STATE_INVALID';
  end if;

  select f.*
    into v_current
  from public.eos_proactive_followups f
  where f.id = p_followup_id
    and f.usuario_id = v_uid
  for update;

  if not found then
    raise exception 'EOS_FOLLOWUP_NOT_FOUND';
  end if;

  if v_current.estado = p_estado then
    return jsonb_build_object(
      'followup', jsonb_build_object(
        'id', v_current.id,
        'estado', v_current.estado,
        'visto_at', v_current.visto_at,
        'resuelto_at', v_current.resuelto_at
      ),
      'idempotent', true
    );
  end if;

  if v_current.estado in ('resuelto', 'descartado') then
    raise exception 'EOS_FOLLOWUP_CLOSED';
  end if;

  if v_current.estado = 'visto' and p_estado = 'visto' then
    return jsonb_build_object(
      'followup', jsonb_build_object(
        'id', v_current.id,
        'estado', v_current.estado,
        'visto_at', v_current.visto_at,
        'resuelto_at', v_current.resuelto_at
      ),
      'idempotent', true
    );
  end if;

  update public.eos_proactive_followups
  set estado = p_estado
  where id = p_followup_id
    and usuario_id = v_uid
    and estado in ('pendiente', 'visto')
  returning * into v_saved;

  if not found then
    raise exception 'EOS_FOLLOWUP_TRANSITION_CONFLICT';
  end if;

  return jsonb_build_object(
    'followup', jsonb_build_object(
      'id', v_saved.id,
      'estado', v_saved.estado,
      'visto_at', v_saved.visto_at,
      'resuelto_at', v_saved.resuelto_at
    ),
    'idempotent', false
  );
end;
$$;

revoke all on function public.eos_transition_followup_v36(uuid, text) from public, anon, service_role;
grant execute on function public.eos_transition_followup_v36(uuid, text) to authenticated;

comment on function public.eos_transition_followup_v36(uuid, text) is
  'RC1 v36: transición self-scoped e idempotente de seguimientos; estados cerrados son terminales y las carreras se serializan con row lock.';
