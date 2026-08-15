create or replace function public.eos_reserve_message_quota_v40(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.planes%rowtype;
  v_existing public.eos_message_usage_v40%rowtype;
  v_scope text;
  v_window text;
  v_limit integer;
  v_used bigint := 0;
  v_reserved bigint := 0;
  v_reset_at timestamptz;
  v_subscription_active boolean;
begin
  if v_uid is null then raise exception 'EOS_UNAUTHENTICATED'; end if;
  if p_request_id is null then raise exception 'EOS_MESSAGE_REQUEST_ID_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('eos-message-quota:' || v_uid::text, 0));

  select p.* into v_plan
  from public.usuarios u
  join public.planes p on p.codigo = lower(coalesce(u.plan, 'free'))
  where u.id = v_uid and p.activo = true
  limit 1;

  if v_plan.id is null then raise exception 'EOS_MESSAGE_PLAN_INVALID'; end if;

  v_subscription_active := public.eos_suscripcion_vigente_internal_v1(v_uid);
  if not v_subscription_active then
    return jsonb_build_object('allowed', false, 'code', 'EOS_SUBSCRIPTION_INACTIVE', 'plan', v_plan.codigo);
  end if;

  update public.eos_message_usage_v40
  set status = 'released', released_at = now(), release_reason = 'reservation_expired', updated_at = now()
  where usuario_id = v_uid and status = 'reserved' and expires_at <= now();

  select * into v_existing
  from public.eos_message_usage_v40
  where usuario_id = v_uid and request_id = p_request_id
  for update;

  if found and v_existing.status = 'reserved' then
    return jsonb_build_object(
      'allowed', false, 'code', 'EOS_MESSAGE_REQUEST_IN_PROGRESS',
      'status', 'reserved', 'idempotent', true,
      'plan', v_existing.plan_code, 'scope', v_existing.quota_scope,
      'window_key', v_existing.window_key, 'request_id', p_request_id
    );
  end if;

  if found and v_existing.status = 'consumed' then
    return jsonb_build_object(
      'allowed', false, 'code', 'EOS_MESSAGE_REQUEST_ALREADY_CONSUMED',
      'status', 'consumed', 'idempotent', true,
      'plan', v_existing.plan_code, 'scope', v_existing.quota_scope,
      'window_key', v_existing.window_key, 'request_id', p_request_id
    );
  end if;

  if v_plan.codigo = 'free' then
    v_scope := 'daily';
    v_window := (now() at time zone 'America/Asuncion')::date::text;
    v_reset_at := (((now() at time zone 'America/Asuncion')::date + 1)::timestamp at time zone 'America/Asuncion');

    select coalesce(sum(cantidad), 0) into v_used
    from public.eos_message_usage_v40
    where usuario_id = v_uid and quota_scope = 'daily'
      and window_key = v_window and status = 'consumed';

    select coalesce(sum(cantidad), 0) into v_reserved
    from public.eos_message_usage_v40
    where usuario_id = v_uid and quota_scope = 'daily'
      and window_key = v_window and status = 'reserved' and expires_at > now();
  else
    v_scope := 'monthly';
    v_window := public.eos_periodo_actual();
    v_reset_at := ((date_trunc('month', now() at time zone 'America/Asuncion') + interval '1 month') at time zone 'America/Asuncion');

    insert into public.uso_mensual (usuario_id, periodo)
    values (v_uid, v_window)
    on conflict (usuario_id, periodo) do nothing;

    select coalesce(mensajes_usados, 0) into v_used
    from public.uso_mensual
    where usuario_id = v_uid and periodo = v_window
    for update;

    select coalesce(sum(cantidad), 0) into v_reserved
    from public.eos_message_usage_v40
    where usuario_id = v_uid and quota_scope = 'monthly'
      and window_key = v_window and status = 'reserved' and expires_at > now();
  end if;

  v_limit := v_plan.limite_mensajes;

  if v_limit is not null and (v_used + v_reserved + 1) > v_limit then
    return jsonb_build_object(
      'allowed', false, 'code', 'EOS_MESSAGE_LIMIT_REACHED',
      'plan', v_plan.codigo, 'scope', v_scope, 'window_key', v_window,
      'used', v_used, 'reserved', v_reserved, 'limit', v_limit,
      'remaining', greatest(v_limit - v_used - v_reserved, 0),
      'reset_at', v_reset_at
    );
  end if;

  insert into public.eos_message_usage_v40 (
    usuario_id, request_id, plan_code, quota_scope, window_key, cantidad,
    status, reserved_at, expires_at, consumed_at, released_at, release_reason,
    metadata, updated_at
  ) values (
    v_uid, p_request_id, v_plan.codigo, v_scope, v_window, 1,
    'reserved', now(), now() + interval '5 minutes', null, null, null,
    jsonb_build_object('source', 'api-eos-v40'), now()
  )
  on conflict (usuario_id, request_id) do update set
    plan_code = excluded.plan_code,
    quota_scope = excluded.quota_scope,
    window_key = excluded.window_key,
    cantidad = excluded.cantidad,
    status = 'reserved',
    reserved_at = excluded.reserved_at,
    expires_at = excluded.expires_at,
    consumed_at = null,
    released_at = null,
    release_reason = null,
    metadata = excluded.metadata,
    updated_at = now()
  where public.eos_message_usage_v40.status = 'released';

  return jsonb_build_object(
    'allowed', true, 'code', null, 'status', 'reserved', 'idempotent', false,
    'plan', v_plan.codigo, 'scope', v_scope, 'window_key', v_window,
    'used', v_used, 'reserved', v_reserved + 1, 'limit', v_limit,
    'remaining', case when v_limit is null then null else greatest(v_limit - v_used - v_reserved - 1, 0) end,
    'reset_at', v_reset_at, 'request_id', p_request_id
  );
end;
$$;

revoke all on function public.eos_reserve_message_quota_v40(uuid) from public, anon, service_role;
grant execute on function public.eos_reserve_message_quota_v40(uuid) to authenticated;

comment on function public.eos_reserve_message_quota_v40(uuid) is
  'RC1 v41: reserva anti-replay; reserved bloquea ejecución duplicada, consumed no puede reutilizarse y released sí puede reservarse tras fallo.';