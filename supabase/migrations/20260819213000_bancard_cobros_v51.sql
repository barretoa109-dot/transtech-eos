-- Bancard vPOS 2.0: creación y confirmación de cobros con tarjeta (v51).
--
-- Replica la semántica del flujo manual (eos_process_manual_payment_v42):
-- 30/365 días según periodicidad, y en renovación del mismo plan vigente
-- se preserva el tiempo ya pagado sumando sobre el vencimiento anterior.
--
-- La confirmación es idempotente: Bancard puede notificar el mismo cobro
-- más de una vez (respuesta directa del charge + webhook de confirmación).

/*
 * Crea la solicitud de pago con tarjeta y reserva el shop_process_id
 * que identifica la transacción ante Bancard.
 */
create or replace function public.eos_bancard_crear_cobro_v51(
  p_usuario_id uuid,
  p_plan_codigo text,
  p_periodicidad text,
  p_tarjeta_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text := lower(btrim(coalesce(p_plan_codigo, '')));
  v_periodicidad text := lower(btrim(coalesce(p_periodicidad, '')));
  v_monto bigint;
  v_shop_process_id bigint;
  v_solicitud_id uuid;
  v_tarjeta public.eos_bancard_tarjetas_v51%rowtype;
begin
  if p_usuario_id is null then
    raise exception 'EOS_BANCARD_USER_REQUIRED';
  end if;

  if v_plan not in ('personal', 'pro', 'business') then
    raise exception 'EOS_BANCARD_PLAN_INVALID';
  end if;

  if v_periodicidad not in ('mensual', 'anual') then
    raise exception 'EOS_BANCARD_PERIOD_INVALID';
  end if;

  perform 1 from public.usuarios u where u.id = p_usuario_id for update;

  if not found then
    raise exception 'EOS_BANCARD_USER_NOT_FOUND';
  end if;

  select t.* into v_tarjeta
  from public.eos_bancard_tarjetas_v51 t
  where t.id = p_tarjeta_id
    and t.usuario_id = p_usuario_id
    and t.estado = 'activa';

  if not found then
    raise exception 'EOS_BANCARD_CARD_NOT_FOUND';
  end if;

  select case
           when v_periodicidad = 'anual' then p.precio_anual_pyg
           else p.precio_mensual_pyg
         end::bigint
    into v_monto
  from public.planes p
  where p.codigo = v_plan
    and p.activo = true
    and p.es_publico = true
  limit 1;

  if v_monto is null or v_monto <= 0 then
    raise exception 'EOS_BANCARD_PLAN_PRICE_INVALID';
  end if;

  v_shop_process_id := nextval('public.eos_bancard_shop_process_id_seq');

  insert into public.solicitudes_pago (
    usuario_id,
    plan_codigo,
    periodicidad,
    moneda,
    monto,
    proveedor,
    estado,
    referencia_interna,
    referencia_externa,
    vencimiento_pago,
    metadata
  ) values (
    p_usuario_id,
    v_plan,
    v_periodicidad,
    'PYG',
    v_monto,
    'bancard',
    'pendiente',
    'EOSBC' || v_shop_process_id::text,
    v_shop_process_id::text,
    now() + interval '1 hour',
    jsonb_build_object(
      'bancard_shop_process_id', v_shop_process_id,
      'tarjeta_id', p_tarjeta_id,
      'bancard_card_id', v_tarjeta.bancard_card_id,
      'cobro_version', 'v51'
    )
  )
  returning id into v_solicitud_id;

  return jsonb_build_object(
    'ok', true,
    'solicitud_id', v_solicitud_id,
    'shop_process_id', v_shop_process_id,
    'monto', v_monto,
    'plan_codigo', v_plan,
    'periodicidad', v_periodicidad
  );
end;
$$;

revoke all on function public.eos_bancard_crear_cobro_v51(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.eos_bancard_crear_cobro_v51(uuid, text, text, uuid)
  to service_role;

/*
 * Confirma (o rechaza) un cobro con tarjeta de forma atómica e
 * idempotente, y extiende el plan si fue aprobado.
 */
create or replace function public.eos_bancard_confirmar_cobro_v51(
  p_shop_process_id text,
  p_aprobado boolean,
  p_detalle jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.solicitudes_pago%rowtype;
  v_duration_days integer;
  v_reference text;
  v_previous_plan text;
  v_previous_start timestamptz;
  v_previous_expiry timestamptz;
  v_same_active_plan boolean := false;
  v_history_id uuid;
  v_plan_state jsonb;
begin
  if coalesce(btrim(p_shop_process_id), '') = '' then
    raise exception 'EOS_BANCARD_PROCESS_ID_REQUIRED';
  end if;

  select s.* into v_request
  from public.solicitudes_pago s
  where s.proveedor = 'bancard'
    and s.referencia_externa = btrim(p_shop_process_id)
  for update;

  if not found then
    raise exception 'EOS_BANCARD_REQUEST_NOT_FOUND';
  end if;

  -- Idempotencia: si ya está en estado terminal, no se reprocesa.
  if v_request.estado = 'pagado' then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'status', 'pagado',
      'solicitud_id', v_request.id, 'usuario_id', v_request.usuario_id,
      'plan_codigo', v_request.plan_codigo
    );
  end if;

  if v_request.estado = 'rechazado' then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'status', 'rechazado',
      'solicitud_id', v_request.id, 'usuario_id', v_request.usuario_id,
      'plan_codigo', v_request.plan_codigo
    );
  end if;

  if not p_aprobado then
    update public.solicitudes_pago
    set estado = 'rechazado',
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('bancard_respuesta', p_detalle, 'rechazado_at', now())
    where id = v_request.id;

    return jsonb_build_object(
      'ok', true, 'idempotent', false, 'status', 'rechazado',
      'solicitud_id', v_request.id, 'usuario_id', v_request.usuario_id,
      'plan_codigo', v_request.plan_codigo
    );
  end if;

  if lower(coalesce(v_request.periodicidad, '')) not in ('mensual', 'anual') then
    raise exception 'EOS_BANCARD_PERIOD_INVALID';
  end if;

  select lower(coalesce(u.plan, 'free')), u.plan_inicio, u.plan_vencimiento
    into v_previous_plan, v_previous_start, v_previous_expiry
  from public.usuarios u
  where u.id = v_request.usuario_id
  for update;

  if not found then
    raise exception 'EOS_BANCARD_USER_NOT_FOUND';
  end if;

  v_duration_days := case
    when lower(v_request.periodicidad) = 'anual' then 365
    else 30
  end;

  v_reference := 'bancard-' || v_request.referencia_externa;

  v_same_active_plan :=
    v_previous_plan = lower(v_request.plan_codigo)
    and v_previous_expiry is not null
    and v_previous_expiry > now();

  v_plan_state := public.asignar_plan_eos(
    v_request.usuario_id,
    v_request.plan_codigo,
    v_duration_days
  );

  -- Renovación del mismo plan vigente: no se pierde el tiempo ya pagado.
  if v_same_active_plan then
    update public.usuarios
    set plan_inicio = coalesce(v_previous_start, now()),
        plan_vencimiento = v_previous_expiry + make_interval(days => v_duration_days),
        estado_suscripcion = 'active'
    where id = v_request.usuario_id;

    v_plan_state := public.obtener_estado_comercial_eos(v_request.usuario_id);
  end if;

  update public.solicitudes_pago
  set estado = 'pagado',
      pagado_at = now(),
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'bancard_respuesta', p_detalle,
        'same_plan_renewal', v_same_active_plan,
        'dias_acreditados', v_duration_days,
        'confirmado_at', now()
      )
  where id = v_request.id
  returning * into v_request;

  insert into public.historial_pagos (
    solicitud_pago_id, usuario_id, plan_codigo, periodicidad, monto, moneda,
    proveedor, referencia_externa, estado, pagado_at, metadata
  ) values (
    v_request.id, v_request.usuario_id, v_request.plan_codigo, v_request.periodicidad,
    v_request.monto, v_request.moneda, 'bancard', v_reference, 'pagado',
    v_request.pagado_at,
    jsonb_build_object(
      'origen', 'bancard_charge',
      'same_plan_renewal', v_same_active_plan,
      'dias_acreditados', v_duration_days,
      'vencimiento_previo', v_previous_expiry,
      'bancard_respuesta', p_detalle
    )
  )
  on conflict (proveedor, referencia_externa) do update set
    estado = excluded.estado,
    pagado_at = excluded.pagado_at,
    metadata = public.historial_pagos.metadata || excluded.metadata
  where public.historial_pagos.solicitud_pago_id = excluded.solicitud_pago_id
  returning id into v_history_id;

  if v_history_id is null then
    raise exception 'EOS_BANCARD_REFERENCE_CONFLICT';
  end if;

  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'status', 'pagado',
    'solicitud_id', v_request.id, 'usuario_id', v_request.usuario_id,
    'plan_codigo', v_request.plan_codigo, 'history_id', v_history_id,
    'same_plan_renewal', v_same_active_plan,
    'credited_days', v_duration_days,
    'plan_state', v_plan_state
  );
end;
$$;

revoke all on function public.eos_bancard_confirmar_cobro_v51(text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.eos_bancard_confirmar_cobro_v51(text, boolean, jsonb)
  to service_role;

comment on function public.eos_bancard_confirmar_cobro_v51(text, boolean, jsonb) is
  'Bancard v51: confirma o rechaza un cobro con tarjeta de forma idempotente y extiende el plan preservando el tiempo ya pagado en renovaciones del mismo plan.';
