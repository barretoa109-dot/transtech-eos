-- El plan pago que no dejaba escribir, y el plan vencido que apagaba la cuenta.
--
-- ============================================================
-- 1) "SIN TOPE" SE ESCRIBÍA -1 Y SE LEÍA COMO UN TOPE DE -1
-- ============================================================
--
-- La v66 alineó los planes con los tramos de conversaciones y dejó esto:
--
--   update public.planes set limite_mensajes = -1 where codigo = 'business';
--
-- El -1 es la convención del catálogo de MÓDULOS —está escrito en el comment
-- de `eos_modulos.limite_mensajes`: "NULL = no toca el cupo. -1 = sin tope"—
-- y se copió a la tabla de PLANES, que nunca la tuvo: ahí "sin tope" siempre
-- se escribió NULL, y así está `enterprise` desde el primer día. Ninguna de
-- las funciones que leen `planes.limite_mensajes` conocía el -1. Todas
-- preguntaban lo mismo:
--
--   if v_limit is not null and (usados + reservados + 1) > v_limit then
--
-- Con `v_limit = -1`, el primer mensaje del mes ya cumple `1 > -1`. El
-- resultado es que **todo usuario del plan Business quedó bloqueado en su
-- mensaje número uno** desde el 26 de agosto de 2026, con el cartel "Llegaste
-- al límite de mensajes de tu plan actual".
--
-- Es el peor bloqueo posible de todos: le pega solo a quien pagó. Un usuario
-- del plan gratuito conservaba sus cinco mensajes por día; el que puso plata
-- para no tener tope se quedó con cero. Y como el cartel cambia de texto según
-- el plan, desde afuera parecía que el cambio de plan "no se había aplicado":
-- se aplicó, y por eso mismo dejó de andar.
--
-- Se arregla en los dos lados, y hacen falta los dos:
--
--   * EL DATO (sección 3). Es lo que destraba a la cuenta bloqueada hoy, y lo
--     que arregla a TODOS los lectores a la vez: quedan dos funciones
--     heredadas —`registrar_consumo_eos_internal_v1` y
--     `obtener_estado_comercial_eos_internal_v1`— con el mismo predicado
--     ciego. No las llama la aplicación (`grep` no las encuentra en `app` ni
--     en `lib`) pero sí las tiene a mano n8n, y reescribirlas desde acá
--     obligaría a reproducir de memoria un cuerpo largo que nadie puede
--     probar. Poner el dato en la convención de su propia tabla las corrige
--     sin tocarlas.
--
--   * LA LECTURA (la función de abajo). Para que el día que alguien vuelva a
--     escribir -1 —siguiendo el comment del catálogo de módulos, que es una
--     lectura razonable— no se repita el mismo apagón silencioso.
--
-- ============================================================
-- 2) UN PLAN VENCIDO NO ES UNA CUENTA CANCELADA
-- ============================================================
--
-- `eos_suscripcion_vigente` devuelve false cuando el plan venció o cuando el
-- estado dejó de ser 'active'. La reserva de cupo trataba ese false como un
-- portazo: `EOS_SUBSCRIPTION_INACTIVE`, 402, y ni un mensaje más. Para
-- siempre, porque la fecha no vuelve sola.
--
-- La aplicación nunca pensó así. `planEfectivo()` en `app/api/eos/route.ts`
-- hace exactamente lo contrario desde el día uno:
--
--   if (estado !== "active" ... && plan !== "free") return "free";
--   if (usuario.plan_vencimiento <= Date.now()) return "free";
--
-- O sea: al vencer se CAE AL PLAN GRATUITO. Las dos mitades del sistema
-- opinaban distinto sobre lo mismo, y ganaba la que decía que no. El efecto
-- real: a quien se le venció el mes —o le rebotó la tarjeta— EOS se le apaga
-- entero en vez de volver a los cinco mensajes diarios de siempre. Es la peor
-- forma de pedirle que renueve: sin producto no hay a qué volver.
--
-- Hoy hay una cuenta de producción exactamente en ese estado.
--
-- Desde acá la reserva hace lo que hace la app: si la suscripción no está
-- vigente, se resuelve el cupo con el plan `free`. Sigue habiendo un límite y
-- sigue habiendo motivo para renovar; lo que no hay es una cuenta muerta.
--
-- La única forma de quedar sin cupo es que ni siquiera exista el plan `free`
-- activo en la tabla, y eso ya es un esquema roto, no un usuario moroso.

create or replace function public.eos_reserve_message_quota_server_v75(
  p_usuario_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.planes%rowtype;
  v_existing public.eos_message_usage_v40%rowtype;
  v_scope text;
  v_window text;
  v_limit integer;
  v_used bigint := 0;
  v_reserved bigint := 0;
  v_reset_at timestamptz;
  v_subscription_active boolean;
  v_sin_tope boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;
  if p_usuario_id is null then raise exception 'EOS_MESSAGE_USER_ID_REQUIRED'; end if;
  if p_request_id is null then raise exception 'EOS_MESSAGE_REQUEST_ID_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('eos-message-quota:' || p_usuario_id::text, 0));

  select p.* into v_plan
  from public.usuarios u
  join public.planes p on p.codigo = lower(coalesce(u.plan, 'free'))
  where u.id = p_usuario_id and p.activo = true
  limit 1;

  if v_plan.id is null then raise exception 'EOS_MESSAGE_PLAN_INVALID'; end if;

  -- Suscripción caída: se sigue, pero con el plan gratuito. Ver el bloque 2
  -- de la cabecera. El plan efectivo se recalcula acá y de ahí en más TODO
  -- —ventana, límite, `plan_code` de la fila, `plan` de la respuesta— usa el
  -- efectivo, para que el cartel que ve el usuario diga la verdad.
  v_subscription_active := public.eos_suscripcion_vigente_internal_v1(p_usuario_id);

  if not v_subscription_active and v_plan.codigo is distinct from 'free' then
    select p.* into v_plan
    from public.planes p
    where p.codigo = 'free' and p.activo = true
    limit 1;

    if v_plan.id is null then
      return jsonb_build_object(
        'allowed', false,
        'code', 'EOS_SUBSCRIPTION_INACTIVE',
        'plan', 'free'
      );
    end if;
  end if;

  update public.eos_message_usage_v40
  set status = 'released',
      released_at = now(),
      release_reason = 'reservation_expired',
      updated_at = now()
  where usuario_id = p_usuario_id
    and status = 'reserved'
    and expires_at <= now();

  select * into v_existing
  from public.eos_message_usage_v40
  where usuario_id = p_usuario_id
    and request_id = p_request_id
  for update;

  if found and v_existing.status = 'reserved' then
    return jsonb_build_object(
      'allowed', false,
      'code', 'EOS_MESSAGE_REQUEST_IN_PROGRESS',
      'status', 'reserved',
      'idempotent', true,
      'plan', v_existing.plan_code,
      'scope', v_existing.quota_scope,
      'window_key', v_existing.window_key,
      'request_id', p_request_id
    );
  end if;

  if found and v_existing.status = 'consumed' then
    return jsonb_build_object(
      'allowed', false,
      'code', 'EOS_MESSAGE_REQUEST_ALREADY_CONSUMED',
      'status', 'consumed',
      'idempotent', true,
      'plan', v_existing.plan_code,
      'scope', v_existing.quota_scope,
      'window_key', v_existing.window_key,
      'request_id', p_request_id
    );
  end if;

  if v_plan.codigo = 'free' then
    v_scope := 'daily';
    v_window := (now() at time zone 'America/Asuncion')::date::text;
    v_reset_at := (((now() at time zone 'America/Asuncion')::date + 1)::timestamp at time zone 'America/Asuncion');

    select coalesce(sum(cantidad), 0) into v_used
    from public.eos_message_usage_v40
    where usuario_id = p_usuario_id
      and quota_scope = 'daily'
      and window_key = v_window
      and status = 'consumed';

    select coalesce(sum(cantidad), 0) into v_reserved
    from public.eos_message_usage_v40
    where usuario_id = p_usuario_id
      and quota_scope = 'daily'
      and window_key = v_window
      and status = 'reserved'
      and expires_at > now();
  else
    v_scope := 'monthly';
    v_window := public.eos_periodo_actual();
    v_reset_at := ((date_trunc('month', now() at time zone 'America/Asuncion') + interval '1 month') at time zone 'America/Asuncion');

    insert into public.uso_mensual (usuario_id, periodo)
    values (p_usuario_id, v_window)
    on conflict (usuario_id, periodo) do nothing;

    select coalesce(mensajes_usados, 0) into v_used
    from public.uso_mensual
    where usuario_id = p_usuario_id
      and periodo = v_window
    for update;

    select coalesce(sum(cantidad), 0) into v_reserved
    from public.eos_message_usage_v40
    where usuario_id = p_usuario_id
      and quota_scope = 'monthly'
      and window_key = v_window
      and status = 'reserved'
      and expires_at > now();
  end if;

  v_limit := v_plan.limite_mensajes;

  -- Las dos formas de decir "sin tope": la columna vacía y el -1 del catálogo.
  v_sin_tope := v_limit is null or v_limit < 0;

  if not v_sin_tope and (v_used + v_reserved + 1) > v_limit then
    return jsonb_build_object(
      'allowed', false,
      'code', 'EOS_MESSAGE_LIMIT_REACHED',
      'plan', v_plan.codigo,
      'scope', v_scope,
      'window_key', v_window,
      'used', v_used,
      'reserved', v_reserved,
      'limit', v_limit,
      'remaining', greatest(v_limit - v_used - v_reserved, 0),
      'reset_at', v_reset_at
    );
  end if;

  insert into public.eos_message_usage_v40 (
    usuario_id,
    request_id,
    plan_code,
    quota_scope,
    window_key,
    cantidad,
    status,
    reserved_at,
    expires_at,
    consumed_at,
    released_at,
    release_reason,
    metadata,
    updated_at
  ) values (
    p_usuario_id,
    p_request_id,
    v_plan.codigo,
    v_scope,
    v_window,
    1,
    'reserved',
    now(),
    now() + interval '5 minutes',
    null,
    null,
    null,
    jsonb_build_object(
      'source', 'api-eos-v40',
      'server_owned', true,
      'reservation_version', 'v75',
      'subscription_active', v_subscription_active
    ),
    now()
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
    'allowed', true,
    'code', null,
    'status', 'reserved',
    'idempotent', false,
    'plan', v_plan.codigo,
    'scope', v_scope,
    'window_key', v_window,
    'used', v_used,
    'reserved', v_reserved + 1,
    'limit', case when v_sin_tope then null else v_limit end,
    'remaining', case
      when v_sin_tope then null
      else greatest(v_limit - v_used - v_reserved - 1, 0)
    end,
    'reset_at', v_reset_at,
    'request_id', p_request_id
  );
end;
$$;

comment on function public.eos_reserve_message_quota_server_v75(uuid, uuid) is
  'RC1 v75 + v125: reserva de mensaje del lado del servidor. limite_mensajes < 0 es SIN TOPE, y una suscripción caída cae al plan free en vez de bloquear.';


-- ============================================================
-- 3) El dato, puesto en la convención de su propia tabla
-- ============================================================
--
-- `enterprise` ya usaba NULL para decir "sin tope" y siempre funcionó. Esto
-- alinea a `business` con su vecino en vez de sostener dos convenciones en la
-- misma columna.
--
-- Se escribe por condición y no por código de plan a propósito: si mañana un
-- tramo nuevo hereda el -1 de la misma fuente, esta migración ya lo cubrió.

update public.planes
set limite_mensajes = null
where limite_mensajes is not null
  and limite_mensajes < 0;

-- Y que no vuelva a entrar. Un tope negativo no significa nada en esta tabla:
-- o hay un número de mensajes, o no hay tope y la columna va vacía.
alter table public.planes
  drop constraint if exists planes_limite_mensajes_check;

alter table public.planes
  add constraint planes_limite_mensajes_check
  check (limite_mensajes is null or limite_mensajes >= 0);

comment on column public.planes.limite_mensajes is
  'Mensajes de la ventana del plan (diaria en free, mensual en el resto). NULL = sin tope. Nunca negativo: ver v125.';
