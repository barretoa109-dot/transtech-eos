create or replace function public.eos_attach_transfer_proof_v46(
  p_solicitud_id uuid,
  p_usuario_id uuid,
  p_comprobante jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.solicitudes_pago%rowtype;
  v_metadata jsonb;
begin
  if p_solicitud_id is null or p_usuario_id is null then
    raise exception 'EOS_PAYMENT_REQUEST_ID_REQUIRED';
  end if;

  if p_comprobante is null or jsonb_typeof(p_comprobante) <> 'object' then
    raise exception 'EOS_PAYMENT_PROOF_REQUIRED';
  end if;

  select s.*
    into v_request
  from public.solicitudes_pago s
  where s.id = p_solicitud_id
    and s.usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_PAYMENT_REQUEST_NOT_FOUND';
  end if;

  if lower(coalesce(v_request.proveedor, '')) <> 'transferencia' then
    raise exception 'EOS_PAYMENT_PROVIDER_INVALID';
  end if;

  if v_request.estado <> 'pendiente_transferencia' then
    raise exception 'EOS_PAYMENT_NOT_AWAITING_TRANSFER';
  end if;

  if v_request.vencimiento_pago is not null and v_request.vencimiento_pago < now() then
    update public.solicitudes_pago
    set estado = 'vencido',
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'expired_at', now(),
          'expired_by', 'eos_attach_transfer_proof_v46'
        )
    where id = v_request.id;

    return jsonb_build_object(
      'ok', false,
      'status', 'vencido',
      'expired', true,
      'solicitud_id', v_request.id
    );
  end if;

  if coalesce(v_request.metadata, '{}'::jsonb) ? 'comprobante' then
    raise exception 'EOS_PAYMENT_PROOF_ALREADY_ATTACHED';
  end if;

  v_metadata := coalesce(v_request.metadata, '{}'::jsonb)
    || jsonb_build_object('comprobante', p_comprobante);

  update public.solicitudes_pago
  set estado = 'en_revision',
      metadata = v_metadata,
      updated_at = now()
  where id = v_request.id
  returning * into v_request;

  return jsonb_build_object(
    'ok', true,
    'status', 'en_revision',
    'solicitud_id', v_request.id,
    'usuario_id', v_request.usuario_id,
    'plan_codigo', v_request.plan_codigo
  );
end;
$$;

revoke all on function public.eos_attach_transfer_proof_v46(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.eos_attach_transfer_proof_v46(uuid, uuid, jsonb)
  to service_role;

comment on function public.eos_attach_transfer_proof_v46(uuid, uuid, jsonb) is
  'RC1 v46: asocia un comprobante a una transferencia de forma atomica; solo pendiente vigente puede pasar a en_revision y un comprobante no puede reemplazarse.';
