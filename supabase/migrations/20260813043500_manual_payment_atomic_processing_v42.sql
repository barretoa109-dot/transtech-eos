create or replace function public.eos_process_manual_payment_v42(
  p_solicitud_id uuid,
  p_action text,
  p_admin_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.solicitudes_pago%rowtype;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_admin text := left(lower(btrim(coalesce(p_admin_email, ''))), 320);
  v_months integer;
  v_reference text;
  v_plan_state jsonb;
  v_history_id uuid;
begin
  if p_solicitud_id is null then
    raise exception 'EOS_PAYMENT_REQUEST_ID_REQUIRED';
  end if;

  if v_action not in ('aprobar', 'rechazar') then
    raise exception 'EOS_PAYMENT_ACTION_INVALID';
  end if;

  if v_admin = '' then
    raise exception 'EOS_PAYMENT_ADMIN_REQUIRED';
  end if;

  select s.*
    into v_request
  from public.solicitudes_pago s
  where s.id = p_solicitud_id
  for update;

  if not found then
    raise exception 'EOS_PAYMENT_REQUEST_NOT_FOUND';
  end if;

  if lower(coalesce(v_request.proveedor, '')) <> 'transferencia' then
    raise exception 'EOS_PAYMENT_PROVIDER_INVALID';
  end if;

  if v_action = 'aprobar' then
    if v_request.estado = 'pagado' then
      select h.id into v_history_id
      from public.historial_pagos h
      where h.solicitud_pago_id = v_request.id
      order by h.created_at desc
      limit 1;

      return jsonb_build_object(
        'ok', true,
        'action', 'aprobar',
        'status', 'pagado',
        'idempotent', true,
        'solicitud_id', v_request.id,
        'usuario_id', v_request.usuario_id,
        'plan_codigo', v_request.plan_codigo,
        'history_id', v_history_id
      );
    end if;

    if v_request.estado = 'rechazado' then
      raise exception 'EOS_PAYMENT_TERMINAL_CONFLICT';
    end if;

    if v_request.estado <> 'en_revision' then
      raise exception 'EOS_PAYMENT_NOT_REVIEWABLE';
    end if;

    if lower(coalesce(v_request.periodicidad, '')) not in ('mensual', 'anual') then
      raise exception 'EOS_PAYMENT_PERIOD_INVALID';
    end if;

    v_months := case when lower(v_request.periodicidad) = 'anual' then 12 else 1 end;
    v_reference := coalesce(
      nullif(btrim(v_request.referencia_externa), ''),
      'transferencia-' || v_request.id::text
    );

    v_plan_state := public.asignar_plan_eos(
      v_request.usuario_id,
      v_request.plan_codigo,
      v_months
    );

    update public.solicitudes_pago
    set estado = 'pagado',
        pagado_at = now(),
        referencia_externa = v_reference,
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'procesado_por_admin', v_admin,
          'procesado_at', now(),
          'manual_payment_atomic_version', 'v42'
        )
    where id = v_request.id
    returning * into v_request;

    insert into public.historial_pagos (
      solicitud_pago_id,
      usuario_id,
      plan_codigo,
      periodicidad,
      monto,
      moneda,
      proveedor,
      referencia_externa,
      estado,
      pagado_at,
      metadata
    ) values (
      v_request.id,
      v_request.usuario_id,
      v_request.plan_codigo,
      v_request.periodicidad,
      v_request.monto,
      v_request.moneda,
      'transferencia',
      v_reference,
      'pagado',
      v_request.pagado_at,
      jsonb_build_object(
        'origen', 'aprobacion_manual_admin',
        'procesado_por_admin', v_admin,
        'manual_payment_atomic_version', 'v42'
      )
    )
    on conflict (proveedor, referencia_externa) do update set
      solicitud_pago_id = excluded.solicitud_pago_id,
      usuario_id = excluded.usuario_id,
      plan_codigo = excluded.plan_codigo,
      periodicidad = excluded.periodicidad,
      monto = excluded.monto,
      moneda = excluded.moneda,
      estado = excluded.estado,
      pagado_at = excluded.pagado_at,
      metadata = public.historial_pagos.metadata || excluded.metadata
    returning id into v_history_id;

    return jsonb_build_object(
      'ok', true,
      'action', 'aprobar',
      'status', 'pagado',
      'idempotent', false,
      'solicitud_id', v_request.id,
      'usuario_id', v_request.usuario_id,
      'plan_codigo', v_request.plan_codigo,
      'history_id', v_history_id,
      'plan_state', v_plan_state
    );
  end if;

  if v_request.estado = 'rechazado' then
    return jsonb_build_object(
      'ok', true,
      'action', 'rechazar',
      'status', 'rechazado',
      'idempotent', true,
      'solicitud_id', v_request.id,
      'usuario_id', v_request.usuario_id,
      'plan_codigo', v_request.plan_codigo
    );
  end if;

  if v_request.estado = 'pagado' then
    raise exception 'EOS_PAYMENT_TERMINAL_CONFLICT';
  end if;

  if v_request.estado <> 'en_revision' then
    raise exception 'EOS_PAYMENT_NOT_REVIEWABLE';
  end if;

  update public.solicitudes_pago
  set estado = 'rechazado',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'procesado_por_admin', v_admin,
        'procesado_at', now(),
        'rechazado_manualmente', true,
        'manual_payment_atomic_version', 'v42'
      )
  where id = v_request.id;

  return jsonb_build_object(
    'ok', true,
    'action', 'rechazar',
    'status', 'rechazado',
    'idempotent', false,
    'solicitud_id', v_request.id,
    'usuario_id', v_request.usuario_id,
    'plan_codigo', v_request.plan_codigo
  );
end;
$$;

revoke all on function public.eos_process_manual_payment_v42(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_process_manual_payment_v42(uuid, text, text)
  to service_role;

comment on function public.eos_process_manual_payment_v42(uuid, text, text) is
  'RC1 v42: aprobación/rechazo manual atómico e idempotente; plan, solicitud e historial se comprometen juntos bajo row lock.';