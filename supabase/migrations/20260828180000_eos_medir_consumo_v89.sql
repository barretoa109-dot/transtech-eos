-- Saber cuánto cuesta cada usuario (v89).
--
-- ============================================================
-- EOS COBRABA SIN SABER CUÁNTO GASTABA
-- ============================================================
--
-- `uso_mensual` tiene desde siempre las columnas `tokens_entrada`,
-- `tokens_salida` y `costo_estimado_usd`. Estaban en cero. Todas. Con 45
-- mensajes registrados este mes.
--
-- No era un error de cálculo: nadie las llenaba nunca. La respuesta de OpenAI
-- trae el consumo, el gateway la parseaba para sacar el texto y descartaba el
-- resto, y la aplicación jamás se enteraba.
--
-- Para treinta clientes eso se nota en la factura de OpenAI a fin de mes. Para
-- trescientos es cómo se descubre, tarde, que los mejores clientes son los que
-- más plata hacen perder: un mensaje con una foto y medio historial consume
-- treinta veces más que un "hola", y la suscripción es la misma.
--
-- ============================================================
-- TOKENS SÍ, PRECIO NO
-- ============================================================
--
-- Los tokens se guardan porque son un hecho medido. El costo en dólares llega
-- calculado desde la aplicación, con una tarifa configurable: el precio por
-- token cambia con cada modelo y clavarlo en una migración es garantizar un
-- número viejo que nadie va a corregir. Si la tarifa no está configurada, el
-- costo queda en cero y los tokens igual quedan registrados — que es la parte
-- que después se puede convertir a plata en cualquier momento.
--
-- Los parámetros son opcionales para no romper a quien llame con dos
-- argumentos, que es como se llamaba hasta hoy.

CREATE OR REPLACE FUNCTION public.eos_finalize_message_quota_server_v75(
  p_usuario_id uuid,
  p_request_id uuid,
  p_tokens_entrada bigint default 0,
  p_tokens_salida bigint default 0,
  p_costo_estimado_usd numeric default 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_usage public.eos_message_usage_v40%rowtype;
  v_period text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;
  if p_usuario_id is null then raise exception 'EOS_MESSAGE_USER_ID_REQUIRED'; end if;
  if p_request_id is null then raise exception 'EOS_MESSAGE_REQUEST_ID_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('eos-message-quota:' || p_usuario_id::text, 0));

  select * into v_usage
  from public.eos_message_usage_v40
  where usuario_id = p_usuario_id
    and request_id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'EOS_MESSAGE_RESERVATION_NOT_FOUND');
  end if;

  if v_usage.status = 'consumed' then
    return jsonb_build_object(
      'ok', true,
      'status', 'consumed',
      'idempotent', true,
      'request_id', p_request_id
    );
  end if;

  if v_usage.status = 'released' then
    return jsonb_build_object(
      'ok', false,
      'code', 'EOS_MESSAGE_RESERVATION_RELEASED',
      'request_id', p_request_id
    );
  end if;

  if v_usage.expires_at <= now() then
    update public.eos_message_usage_v40
    set status = 'released',
        released_at = now(),
        release_reason = 'reservation_expired_before_finalize',
        updated_at = now()
    where id = v_usage.id;

    return jsonb_build_object(
      'ok', false,
      'code', 'EOS_MESSAGE_RESERVATION_EXPIRED',
      'request_id', p_request_id
    );
  end if;

  v_period := public.eos_periodo_actual();

  insert into public.uso_mensual (usuario_id, periodo)
  values (p_usuario_id, v_period)
  on conflict (usuario_id, periodo) do nothing;

  update public.uso_mensual
  set mensajes_usados = mensajes_usados + v_usage.cantidad,
      /*
       * Lo que costó, no sólo cuántos mensajes fueron.
       *
       * Un mensaje con una foto y medio historial consume treinta veces más que
       * un "hola". Contar mensajes dice cuánto se usó; contar tokens dice cuánto
       * salió. Sin lo segundo se cobra por mes sin saber si el cliente deja o
       * cuesta plata, y eso sólo se descubre mirando la factura de OpenAI —
       * cuando ya hay trescientos.
       *
       * Los tokens son un hecho. El costo en dólares viene calculado desde la
       * aplicación, con una tarifa configurable: el precio por token cambia y
       * clavarlo acá sería garantizar un número viejo que nadie corrige.
       */
      tokens_entrada = tokens_entrada + greatest(coalesce(p_tokens_entrada, 0), 0),
      tokens_salida = tokens_salida + greatest(coalesce(p_tokens_salida, 0), 0),
      costo_estimado_usd = costo_estimado_usd + greatest(coalesce(p_costo_estimado_usd, 0), 0),
      updated_at = now()
  where usuario_id = p_usuario_id
    and periodo = v_period;

  update public.eos_message_usage_v40
  set status = 'consumed',
      consumed_at = now(),
      released_at = null,
      release_reason = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'finalized_server_owned', true,
        'finalize_version', 'v75'
      ),
      updated_at = now()
  where id = v_usage.id;

  return jsonb_build_object(
    'ok', true,
    'status', 'consumed',
    'idempotent', false,
    'request_id', p_request_id,
    'plan', v_usage.plan_code,
    'scope', v_usage.quota_scope,
    'window_key', v_usage.window_key,
    'tokens_entrada', greatest(coalesce(p_tokens_entrada, 0), 0),
    'tokens_salida', greatest(coalesce(p_tokens_salida, 0), 0)
  );
end;
$function$
;
