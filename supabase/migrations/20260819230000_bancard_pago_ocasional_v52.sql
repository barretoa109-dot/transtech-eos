-- Bancard vPOS: pago ocasional (sin guardar la tarjeta) — v52.
--
-- Mismo ciclo que el cobro con token, pero sin tarjeta catastrada: el
-- usuario carga los datos en el iframe de Bancard y no queda nada
-- guardado. La confirmación llega por el webhook, que ya es idempotente.

create or replace function public.eos_bancard_crear_pago_ocasional_v52(
  p_usuario_id uuid,
  p_plan_codigo text,
  p_periodicidad text
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
    usuario_id, plan_codigo, periodicidad, moneda, monto,
    proveedor, estado, referencia_interna, referencia_externa,
    vencimiento_pago, metadata
  ) values (
    p_usuario_id, v_plan, v_periodicidad, 'PYG', v_monto,
    'bancard', 'pendiente',
    'EOSBC' || v_shop_process_id::text,
    v_shop_process_id::text,
    now() + interval '1 hour',
    jsonb_build_object(
      'bancard_shop_process_id', v_shop_process_id,
      'modalidad', 'pago_ocasional',
      'cobro_version', 'v52'
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

revoke all on function public.eos_bancard_crear_pago_ocasional_v52(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_bancard_crear_pago_ocasional_v52(uuid, text, text)
  to service_role;

comment on function public.eos_bancard_crear_pago_ocasional_v52(uuid, text, text) is
  'Bancard v52: crea una solicitud de pago ocasional (sin tarjeta catastrada) y reserva su shop_process_id.';
