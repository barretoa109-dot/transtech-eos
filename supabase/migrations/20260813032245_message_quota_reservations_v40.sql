create table if not exists public.eos_message_usage_v40 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  request_id uuid not null,
  plan_code text not null,
  quota_scope text not null check (quota_scope in ('daily', 'monthly')),
  window_key text not null,
  cantidad integer not null default 1 check (cantidad > 0),
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'released')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eos_message_usage_consumed_timestamp_v40 check (
    status <> 'consumed' or consumed_at is not null
  ),
  constraint eos_message_usage_released_timestamp_v40 check (
    status <> 'released' or released_at is not null
  )
);

create unique index if not exists eos_message_usage_user_request_uidx_v40
  on public.eos_message_usage_v40 (usuario_id, request_id);
create index if not exists eos_message_usage_daily_idx_v40
  on public.eos_message_usage_v40 (usuario_id, window_key, status)
  where quota_scope = 'daily';
create index if not exists eos_message_usage_monthly_idx_v40
  on public.eos_message_usage_v40 (usuario_id, window_key, status)
  where quota_scope = 'monthly';
create index if not exists eos_message_usage_reserved_expiry_idx_v40
  on public.eos_message_usage_v40 (expires_at)
  where status = 'reserved';

alter table public.eos_message_usage_v40 enable row level security;
revoke all on table public.eos_message_usage_v40 from public, anon, authenticated;
grant all on table public.eos_message_usage_v40 to service_role;

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

  if found and v_existing.status in ('reserved', 'consumed') then
    return jsonb_build_object(
      'allowed', true, 'code', null, 'status', v_existing.status,
      'idempotent', true, 'plan', v_existing.plan_code,
      'scope', v_existing.quota_scope, 'window_key', v_existing.window_key,
      'request_id', p_request_id
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

create or replace function public.eos_finalize_message_quota_v40(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_usage public.eos_message_usage_v40%rowtype;
  v_period text;
begin
  if v_uid is null then raise exception 'EOS_UNAUTHENTICATED'; end if;
  if p_request_id is null then raise exception 'EOS_MESSAGE_REQUEST_ID_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('eos-message-quota:' || v_uid::text, 0));

  select * into v_usage
  from public.eos_message_usage_v40
  where usuario_id = v_uid and request_id = p_request_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'EOS_MESSAGE_RESERVATION_NOT_FOUND'); end if;
  if v_usage.status = 'consumed' then
    return jsonb_build_object('ok', true, 'status', 'consumed', 'idempotent', true, 'request_id', p_request_id);
  end if;
  if v_usage.status = 'released' then
    return jsonb_build_object('ok', false, 'code', 'EOS_MESSAGE_RESERVATION_RELEASED', 'request_id', p_request_id);
  end if;

  if v_usage.expires_at <= now() then
    update public.eos_message_usage_v40
    set status = 'released', released_at = now(), release_reason = 'reservation_expired_before_finalize', updated_at = now()
    where id = v_usage.id;
    return jsonb_build_object('ok', false, 'code', 'EOS_MESSAGE_RESERVATION_EXPIRED', 'request_id', p_request_id);
  end if;

  v_period := public.eos_periodo_actual();
  insert into public.uso_mensual (usuario_id, periodo)
  values (v_uid, v_period)
  on conflict (usuario_id, periodo) do nothing;

  update public.uso_mensual
  set mensajes_usados = mensajes_usados + v_usage.cantidad, updated_at = now()
  where usuario_id = v_uid and periodo = v_period;

  update public.eos_message_usage_v40
  set status = 'consumed', consumed_at = now(), released_at = null,
      release_reason = null, updated_at = now()
  where id = v_usage.id;

  return jsonb_build_object(
    'ok', true, 'status', 'consumed', 'idempotent', false,
    'request_id', p_request_id, 'plan', v_usage.plan_code,
    'scope', v_usage.quota_scope, 'window_key', v_usage.window_key
  );
end;
$$;

create or replace function public.eos_release_message_quota_v40(
  p_request_id uuid,
  p_reason text default 'request_failed'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_usage public.eos_message_usage_v40%rowtype;
begin
  if v_uid is null then raise exception 'EOS_UNAUTHENTICATED'; end if;
  if p_request_id is null then raise exception 'EOS_MESSAGE_REQUEST_ID_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('eos-message-quota:' || v_uid::text, 0));

  select * into v_usage
  from public.eos_message_usage_v40
  where usuario_id = v_uid and request_id = p_request_id
  for update;

  if not found then return jsonb_build_object('ok', true, 'status', 'missing', 'idempotent', true); end if;
  if v_usage.status <> 'reserved' then
    return jsonb_build_object('ok', true, 'status', v_usage.status, 'idempotent', true);
  end if;

  update public.eos_message_usage_v40
  set status = 'released', released_at = now(),
      release_reason = left(coalesce(nullif(btrim(p_reason), ''), 'request_failed'), 160),
      updated_at = now()
  where id = v_usage.id;

  return jsonb_build_object('ok', true, 'status', 'released', 'idempotent', false);
end;
$$;

revoke all on function public.eos_reserve_message_quota_v40(uuid) from public, anon, service_role;
revoke all on function public.eos_finalize_message_quota_v40(uuid) from public, anon, service_role;
revoke all on function public.eos_release_message_quota_v40(uuid, text) from public, anon, service_role;
grant execute on function public.eos_reserve_message_quota_v40(uuid) to authenticated;
grant execute on function public.eos_finalize_message_quota_v40(uuid) to authenticated;
grant execute on function public.eos_release_message_quota_v40(uuid, text) to authenticated;

create or replace function public.obtener_estado_comercial_eos(p_usuario_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := auth.role();
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_plan text;
  v_limit integer;
  v_used bigint := 0;
  v_reserved bigint := 0;
  v_window text;
  v_reset_at timestamptz;
  v_active boolean;
begin
  if v_role = 'anon' then raise exception 'EOS_AUTH_REQUIRED'; end if;
  if v_role = 'authenticated' and v_uid is distinct from p_usuario_id then raise exception 'EOS_FORBIDDEN_USER_SCOPE'; end if;
  if v_role is not null and v_role not in ('authenticated', 'service_role') then raise exception 'EOS_FORBIDDEN_ROLE'; end if;

  v_result := public.obtener_estado_comercial_eos_internal_v1(p_usuario_id);
  v_plan := lower(coalesce(v_result ->> 'plan', 'free'));
  v_limit := nullif(v_result #>> '{limites,mensajes}', '')::integer;
  v_active := coalesce((v_result ->> 'suscripcion_vigente')::boolean, false);

  if v_plan = 'free' then
    v_window := (now() at time zone 'America/Asuncion')::date::text;
    v_reset_at := (((now() at time zone 'America/Asuncion')::date + 1)::timestamp at time zone 'America/Asuncion');

    select coalesce(sum(cantidad), 0) into v_used
    from public.eos_message_usage_v40
    where usuario_id = p_usuario_id and quota_scope = 'daily'
      and window_key = v_window and status = 'consumed';

    select coalesce(sum(cantidad), 0) into v_reserved
    from public.eos_message_usage_v40
    where usuario_id = p_usuario_id and quota_scope = 'daily'
      and window_key = v_window and status = 'reserved' and expires_at > now();

    v_result := jsonb_set(v_result, '{uso,mensajes}', to_jsonb(v_used), true);
    v_result := jsonb_set(
      v_result, '{disponibilidad,puede_enviar_mensajes}',
      to_jsonb(v_active and (v_limit is null or (v_used + v_reserved) < v_limit)), true
    );
    v_result := v_result || jsonb_build_object(
      'cuota_mensajes', jsonb_build_object(
        'scope', 'daily', 'window_key', v_window, 'used', v_used,
        'reserved', v_reserved, 'limit', v_limit,
        'remaining', case when v_limit is null then null else greatest(v_limit - v_used - v_reserved, 0) end,
        'reset_at', v_reset_at
      )
    );
  else
    v_window := public.eos_periodo_actual();
    v_reset_at := ((date_trunc('month', now() at time zone 'America/Asuncion') + interval '1 month') at time zone 'America/Asuncion');
    v_result := v_result || jsonb_build_object(
      'cuota_mensajes', jsonb_build_object(
        'scope', 'monthly', 'window_key', v_window,
        'used', coalesce((v_result #>> '{uso,mensajes}')::bigint, 0),
        'reserved', 0, 'limit', v_limit,
        'remaining', case when v_limit is null then null else greatest(v_limit - coalesce((v_result #>> '{uso,mensajes}')::integer, 0), 0) end,
        'reset_at', v_reset_at
      )
    );
  end if;

  return v_result;
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
  v_plan text;
  v_window text;
  v_used bigint := 0;
  v_reserved bigint := 0;
  v_limit integer;
  v_request uuid;
begin
  if v_role = 'anon' then raise exception 'EOS_AUTH_REQUIRED'; end if;
  if v_role = 'authenticated' and v_uid is distinct from p_usuario_id then raise exception 'EOS_FORBIDDEN_USER_SCOPE'; end if;
  if v_role is not null and v_role not in ('authenticated', 'service_role') then raise exception 'EOS_FORBIDDEN_ROLE'; end if;

  if lower(btrim(coalesce(p_tipo, ''))) <> 'mensaje' then
    return public.registrar_consumo_eos_internal_v1(
      p_usuario_id, p_tipo, p_cantidad, p_tokens_entrada, p_tokens_salida, p_costo_estimado_usd
    );
  end if;

  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor que cero.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('eos-message-quota:' || p_usuario_id::text, 0));

  select lower(coalesce(u.plan, 'free')), p.limite_mensajes into v_plan, v_limit
  from public.usuarios u
  join public.planes p on p.codigo = lower(coalesce(u.plan, 'free'))
  where u.id = p_usuario_id and p.activo = true
  limit 1;

  if v_plan is null then raise exception 'El usuario no tiene un plan válido.'; end if;
  if not public.eos_suscripcion_vigente_internal_v1(p_usuario_id) then raise exception 'La suscripción del usuario no está activa.'; end if;

  if v_plan <> 'free' then
    return public.registrar_consumo_eos_internal_v1(
      p_usuario_id, p_tipo, p_cantidad, p_tokens_entrada, p_tokens_salida, p_costo_estimado_usd
    );
  end if;

  update public.eos_message_usage_v40
  set status='released', released_at=now(), release_reason='reservation_expired', updated_at=now()
  where usuario_id=p_usuario_id and status='reserved' and expires_at<=now();

  v_window := (now() at time zone 'America/Asuncion')::date::text;
  select coalesce(sum(cantidad),0) into v_used
  from public.eos_message_usage_v40
  where usuario_id=p_usuario_id and quota_scope='daily' and window_key=v_window and status='consumed';
  select coalesce(sum(cantidad),0) into v_reserved
  from public.eos_message_usage_v40
  where usuario_id=p_usuario_id and quota_scope='daily' and window_key=v_window and status='reserved' and expires_at>now();

  if v_limit is not null and (v_used + v_reserved + p_cantidad) > v_limit then
    raise exception 'EOS_MESSAGE_LIMIT_REACHED';
  end if;

  v_request := gen_random_uuid();
  insert into public.eos_message_usage_v40 (
    usuario_id, request_id, plan_code, quota_scope, window_key, cantidad,
    status, reserved_at, expires_at, consumed_at, metadata
  ) values (
    p_usuario_id, v_request, 'free', 'daily', v_window, p_cantidad,
    'consumed', now(), now(), now(), jsonb_build_object('source','registrar_consumo_eos-v40')
  );

  insert into public.uso_mensual (usuario_id, periodo)
  values (p_usuario_id, public.eos_periodo_actual())
  on conflict (usuario_id, periodo) do nothing;
  update public.uso_mensual
  set mensajes_usados = mensajes_usados + p_cantidad,
      tokens_entrada = tokens_entrada + greatest(coalesce(p_tokens_entrada,0),0),
      tokens_salida = tokens_salida + greatest(coalesce(p_tokens_salida,0),0),
      costo_estimado_usd = costo_estimado_usd + greatest(coalesce(p_costo_estimado_usd,0),0),
      updated_at = now()
  where usuario_id=p_usuario_id and periodo=public.eos_periodo_actual();

  return public.obtener_estado_comercial_eos(p_usuario_id);
end;
$$;

revoke all on function public.obtener_estado_comercial_eos(uuid) from public, anon;
revoke all on function public.registrar_consumo_eos(uuid, text, integer, bigint, bigint, numeric) from public, anon;
grant execute on function public.obtener_estado_comercial_eos(uuid) to authenticated, service_role;
grant execute on function public.registrar_consumo_eos(uuid, text, integer, bigint, bigint, numeric) to authenticated, service_role;

comment on table public.eos_message_usage_v40 is
  'Reservas y consumos idempotentes de mensajes EOS. Free usa día calendario America/Asuncion; planes pagos conservan periodo mensual.';
comment on function public.eos_reserve_message_quota_v40(uuid) is
  'Reserva un slot de mensaje antes de ejecutar EOS, contando reservas activas para evitar sobreconsumo concurrente.';
comment on function public.eos_finalize_message_quota_v40(uuid) is
  'Confirma una reserva de mensaje solo después de una respuesta EOS exitosa e incrementa uso mensual una sola vez.';
comment on function public.eos_release_message_quota_v40(uuid,text) is
  'Libera una reserva cuando EOS falla o expira para no cobrar intentos no entregados.';