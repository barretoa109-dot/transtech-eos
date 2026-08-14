create or replace function public.eos_create_or_reuse_transfer_request_v47(
  p_usuario_id uuid,
  p_plan_codigo text,
  p_periodicidad text,
  p_comprador jsonb,
  p_cuenta_destino jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_codigo text := lower(btrim(coalesce(p_plan_codigo, '')));
  v_periodicidad text := lower(btrim(coalesce(p_periodicidad, '')));
  v_monto bigint;
  v_request public.solicitudes_pago%rowtype;
  v_reference text;
  v_reused boolean := false;
begin
  if p_usuario_id is null then
    raise exception 'EOS_PAYMENT_USER_REQUIRED';
  end if;

  if v_plan_codigo not in ('personal', 'pro', 'business') then
    raise exception 'EOS_PAYMENT_PLAN_INVALID';
  end if;

  if v_periodicidad not in ('mensual', 'anual') then
    raise exception 'EOS_PAYMENT_PERIOD_INVALID';
  end if;

  if p_comprador is null or jsonb_typeof(p_comprador) <> 'object' then
    raise exception 'EOS_PAYMENT_BUYER_REQUIRED';
  end if;

  if p_cuenta_destino is null or jsonb_typeof(p_cuenta_destino) <> 'object' then
    raise exception 'EOS_PAYMENT_DESTINATION_REQUIRED';
  end if;

  perform 1
  from public.usuarios u
  where u.id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_PAYMENT_USER_NOT_FOUND';
  end if;

  select case
           when v_periodicidad = 'anual' then p.precio_anual_pyg
           else p.precio_mensual_pyg
         end::bigint
    into v_monto
  from public.planes p
  where p.codigo = v_plan_codigo
    and p.activo = true
    and p.es_publico = true
  limit 1;

  if v_monto is null or v_monto <= 0 then
    raise exception 'EOS_PAYMENT_PLAN_PRICE_INVALID';
  end if;

  update public.solicitudes_pago
  set estado = 'vencido',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'expired_at', now(),
        'expired_by', 'eos_create_or_reuse_transfer_request_v47'
      )
  where usuario_id = p_usuario_id
    and lower(coalesce(proveedor, '')) = 'transferencia'
    and plan_codigo = v_plan_codigo
    and periodicidad = v_periodicidad
    and estado = 'pendiente_transferencia'
    and vencimiento_pago is not null
    and vencimiento_pago < now()
    and not (coalesce(metadata, '{}'::jsonb) ? 'comprobante');

  select s.*
    into v_request
  from public.solicitudes_pago s
  where s.usuario_id = p_usuario_id
    and lower(coalesce(s.proveedor, '')) = 'transferencia'
    and s.plan_codigo = v_plan_codigo
    and s.periodicidad = v_periodicidad
    and s.estado = 'pendiente_transferencia'
    and (s.vencimiento_pago is null or s.vencimiento_pago >= now())
    and not (coalesce(s.metadata, '{}'::jsonb) ? 'comprobante')
  order by s.created_at desc
  limit 1
  for update;

  if found then
    v_reused := true;

    update public.solicitudes_pago
    set metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'comprador', p_comprador,
            'cuenta_destino', p_cuenta_destino,
            'last_reused_at', now(),
            'request_creation_version', 'v47'
          ),
        updated_at = now()
    where id = v_request.id
    returning * into v_request;
  else
    v_reference := 'EOSTR' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 18));

    insert into public.solicitudes_pago (
      usuario_id,
      plan_codigo,
      periodicidad,
      moneda,
      monto,
      proveedor,
      estado,
      referencia_interna,
      vencimiento_pago,
      metadata
    ) values (
      p_usuario_id,
      v_plan_codigo,
      v_periodicidad,
      'PYG',
      v_monto,
      'transferencia',
      'pendiente_transferencia',
      v_reference,
      now() + interval '48 hours',
      jsonb_build_object(
        'comprador', p_comprador,
        'cuenta_destino', p_cuenta_destino,
        'request_creation_version', 'v47'
      )
    )
    returning * into v_request;
  end if;

  return jsonb_build_object(
    'ok', true,
    'reused', v_reused,
    'solicitud_id', v_request.id,
    'referencia', v_request.referencia_interna,
    'monto', v_request.monto,
    'estado', v_request.estado,
    'vencimiento_pago', v_request.vencimiento_pago,
    'plan_codigo', v_request.plan_codigo,
    'periodicidad', v_request.periodicidad
  );
end;
$$;

revoke all on function public.eos_create_or_reuse_transfer_request_v47(uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.eos_create_or_reuse_transfer_request_v47(uuid, text, text, jsonb, jsonb)
  to service_role;

comment on function public.eos_create_or_reuse_transfer_request_v47(uuid, text, text, jsonb, jsonb) is
  'RC1 v47: crea o reutiliza de forma serializada una solicitud de transferencia vigente del mismo usuario/plan/periodicidad; expira pendientes vencidas sin comprobante y evita duplicados por reintentos.';
