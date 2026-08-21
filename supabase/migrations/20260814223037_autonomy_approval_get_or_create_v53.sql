-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

create or replace function public.eos_get_or_create_action_approval_v53(
  p_usuario_id uuid,
  p_request_id uuid,
  p_accion text,
  p_risk_tier smallint,
  p_risk_points integer,
  p_requested_level smallint,
  p_effective_level smallint,
  p_reason text,
  p_payload_snapshot jsonb,
  p_payload_fingerprint text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.eos_action_approvals_v12%rowtype;
  v_inserted boolean := false;
  v_payload jsonb := coalesce(p_payload_snapshot, '{}'::jsonb);
  v_fingerprint text := nullif(btrim(coalesce(p_payload_fingerprint, '')), '');
begin
  if p_usuario_id is null or p_request_id is null then
    raise exception 'EOS_APPROVAL_IDENTITY_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_accion, '')), '') is null then
    raise exception 'EOS_APPROVAL_ACTION_REQUIRED';
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'EOS_APPROVAL_EXPIRY_INVALID';
  end if;

  insert into public.eos_action_approvals_v12 (
    usuario_id,
    request_id,
    accion,
    risk_tier,
    risk_points,
    requested_level,
    effective_level,
    status,
    reason,
    payload_snapshot,
    payload_fingerprint,
    expires_at
  ) values (
    p_usuario_id,
    p_request_id,
    btrim(p_accion),
    p_risk_tier,
    p_risk_points,
    p_requested_level,
    p_effective_level,
    'pending',
    p_reason,
    v_payload,
    v_fingerprint,
    p_expires_at
  )
  on conflict (usuario_id, request_id, accion) do nothing
  returning * into v_row;

  if found then
    v_inserted := true;
  else
    select *
      into v_row
      from public.eos_action_approvals_v12
     where usuario_id = p_usuario_id
       and request_id = p_request_id
       and accion = btrim(p_accion)
     for update;

    if not found then
      raise exception 'EOS_APPROVAL_CONCURRENT_LOOKUP_FAILED';
    end if;

    if v_row.payload_snapshot is distinct from v_payload then
      raise exception 'EOS_APPROVAL_PAYLOAD_MISMATCH';
    end if;

    if v_row.payload_fingerprint is not null
       and v_fingerprint is not null
       and v_row.payload_fingerprint <> v_fingerprint then
      raise exception 'EOS_APPROVAL_PAYLOAD_MISMATCH';
    end if;
  end if;

  return jsonb_build_object(
    'approval', jsonb_build_object(
      'id', v_row.id,
      'request_id', v_row.request_id,
      'accion', v_row.accion,
      'status', v_row.status,
      'risk_tier', v_row.risk_tier,
      'risk_points', v_row.risk_points,
      'requested_level', v_row.requested_level,
      'effective_level', v_row.effective_level,
      'reason', v_row.reason,
      'expires_at', v_row.expires_at,
      'created_at', v_row.created_at,
      'decided_at', v_row.decided_at
    ),
    'idempotent', not v_inserted
  );
end;
$$;

revoke all on function public.eos_get_or_create_action_approval_v53(
  uuid, uuid, text, smallint, integer, smallint, smallint, text, jsonb, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.eos_get_or_create_action_approval_v53(
  uuid, uuid, text, smallint, integer, smallint, smallint, text, jsonb, text, timestamptz
) to service_role;

comment on function public.eos_get_or_create_action_approval_v53(
  uuid, uuid, text, smallint, integer, smallint, smallint, text, jsonb, text, timestamptz
) is
  'Crea o reutiliza atomicamente una approval por usuario/request/accion. Reutiliza solo payload identico y falla cerrado ante payload distinto. Service-role only.';

commit;
