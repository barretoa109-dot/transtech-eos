-- Deshacer un cobro que Bancard revirtió (v95).
--
-- ============================================================
-- EL AGUJERO
-- ============================================================
--
-- `lib/bancard.ts` tiene desde hace meses un `tokenRollback()`. No lo llama
-- nadie. Buscado en todo el repositorio: cero usos.
--
-- O sea que EOS **no tiene ningún camino para una reversión**. Si Bancard
-- revierte un cobro —un rollback, un contracargo, una devolución— la solicitud
-- se queda en `pagado`, el plan sigue vigente, los módulos siguen activos y
-- nadie se entera. El cliente conserva un producto que ya no pagó, y la única
-- forma de descubrirlo es que alguien compare a mano el panel de Bancard con
-- la base.
--
-- El webhook de PagoPar sí reconoce la palabra "reversado", pero lo único que
-- hace es escribir en el log "Revisar manualmente la vigencia del plan". Eso
-- no es manejar una reversión: es dejar constancia de que no se maneja.
--
-- ============================================================
-- QUÉ TIENE QUE DESHACER, EXACTAMENTE
-- ============================================================
--
-- Un cobro aprobado deja cuatro rastros, y hay que revertir los cuatro o
-- ninguno:
--
--   1. `solicitudes_pago.estado = 'pagado'`.
--   2. Una fila en `historial_pagos`.
--   3. El plan del usuario, extendido `dias_acreditados` días.
--   4. Si el cobro era de un armado: cada módulo del armado extendido esos
--      mismos días, y el armado marcado `vigente` — eso lo hace el trigger
--      `eos_activar_armado_al_pagar_v66` al pasar la solicitud a `pagado`.
--
-- La v51 ya guardaba en la metadata `dias_acreditados` y `vencimiento_previo`,
-- que es justo lo que hace falta para rebobinar sin adivinar. Le faltaba el
-- código del plan anterior; esta migración se lo agrega, sin cambiar su firma
-- ni su comportamiento.
--
-- Para los cobros VIEJOS, que no tienen `plan_previo` guardado, el plan no se
-- toca y solo se rebobina el vencimiento. Es lo correcto en el caso normal —
-- una renovación del mismo plan— y en el raro es conservador: prefiere dejar
-- un plan de más antes que bajarle el plan a alguien por adivinar mal.
--
-- ============================================================
-- POR QUÉ NO LLAMA A BANCARD
-- ============================================================
--
-- Esto revierte lo NUESTRO. Pedirle a Bancard que devuelva la plata es otra
-- operación, la hace `tokenRollback` desde el servidor, y puede pasar en
-- cualquier orden: a veces Bancard revierte solo (contracargo) y nos avisa
-- después. Mezclar las dos en una función haría imposible el caso más común.

-- ============================================================
-- 1) Un armado revertido no es un armado cancelado
-- ============================================================
--
-- Cancelado es lo que hace el usuario. Reversado es lo que le pasó al cobro.
-- Meterlos en el mismo estado pierde la única información que después sirve
-- para reclamar.

alter table public.eos_planes_armados
  drop constraint if exists eos_planes_armados_estado_check;

alter table public.eos_planes_armados
  add constraint eos_planes_armados_estado_check
  check (estado in ('pendiente', 'vigente', 'reemplazado', 'cancelado', 'reversado'));

-- ============================================================
-- 2) Que la confirmación guarde el plan anterior
-- ============================================================
--
-- Idéntica a la v51 salvo por `plan_previo` en la metadata. Se reproduce
-- entera porque `create or replace` no admite parches parciales.

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

  -- Un cobro revertido NO se puede volver a confirmar por el mismo camino:
  -- haría que el usuario reciba dos veces lo mismo por un pago que ya no está.
  if v_request.estado = 'reversado' then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'status', 'reversado',
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
      -- Lo único que agrega la v95: sin esto, una reversión no sabe a qué plan
      -- volver y tiene que adivinar.
      'plan_previo', v_previous_plan,
      'inicio_previo', v_previous_start,
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

-- ============================================================
-- 3) Deshacerlo
-- ============================================================

create or replace function public.eos_bancard_revertir_cobro_v95(
  p_shop_process_id text,
  p_motivo text,
  p_detalle jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.solicitudes_pago%rowtype;
  v_historial public.historial_pagos%rowtype;
  v_meta jsonb;
  v_dias integer;
  v_venc_previo timestamptz;
  v_inicio_previo timestamptz;
  v_plan_previo text;
  v_armado_id uuid;
  v_armado public.eos_planes_armados%rowtype;
  v_codigo text;
  v_modulos_rebobinados integer := 0;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if coalesce(btrim(p_shop_process_id), '') = '' then
    raise exception 'EOS_BANCARD_PROCESS_ID_REQUIRED';
  end if;

  -- El motivo es obligatorio: una reversión sin motivo es imposible de
  -- explicarle después al cliente que pregunta por qué se le apagó EOS.
  if v_motivo is null then
    raise exception 'EOS_REVERSION_MOTIVO_REQUERIDO';
  end if;
  v_motivo := left(v_motivo, 500);

  select s.* into v_request
  from public.solicitudes_pago s
  where s.proveedor = 'bancard'
    and s.referencia_externa = btrim(p_shop_process_id)
  for update;

  if not found then
    raise exception 'EOS_BANCARD_REQUEST_NOT_FOUND';
  end if;

  -- Bancard puede notificar la misma reversión más de una vez. Repetirla no
  -- puede descontarle los días dos veces a nadie.
  if v_request.estado = 'reversado' then
    return jsonb_build_object(
      'ok', true, 'ya_estaba', true, 'status', 'reversado',
      'solicitud_id', v_request.id, 'usuario_id', v_request.usuario_id
    );
  end if;

  -- Solo se revierte lo que se cobró. Un rechazado o un pendiente no dejó
  -- nada que deshacer, y tratarlo como reversión escondería el error real.
  if v_request.estado <> 'pagado' then
    raise exception 'EOS_BANCARD_NO_ESTABA_PAGADO: %', v_request.estado;
  end if;

  select h.* into v_historial
  from public.historial_pagos h
  where h.solicitud_pago_id = v_request.id
  for update;

  v_meta := coalesce(v_historial.metadata, '{}'::jsonb)
    || coalesce(v_request.metadata, '{}'::jsonb);

  v_dias := coalesce((v_meta ->> 'dias_acreditados')::integer, 0);
  v_venc_previo := (v_meta ->> 'vencimiento_previo')::timestamptz;
  v_inicio_previo := (v_meta ->> 'inicio_previo')::timestamptz;
  v_plan_previo := nullif(btrim(coalesce(v_meta ->> 'plan_previo', '')), '');

  -- ---------- El plan ----------
  perform 1 from public.usuarios where id = v_request.usuario_id for update;

  if v_venc_previo is not null then
    -- Había plan antes: se vuelve exactamente a donde estaba.
    update public.usuarios
    set plan_vencimiento = v_venc_previo,
        plan_inicio = coalesce(v_inicio_previo, plan_inicio),
        plan = coalesce(v_plan_previo, plan)
    where id = v_request.usuario_id;
  else
    -- No había plan: este cobro fue el que lo estrenó, así que se apaga.
    -- El plan solo se baja cuando sabemos a cuál volver; adivinar sería
    -- quitarle a alguien algo que sí pagó por otro lado.
    update public.usuarios
    set plan_vencimiento = null,
        plan = coalesce(v_plan_previo, plan)
    where id = v_request.usuario_id;
  end if;

  -- ---------- Los módulos del armado ----------
  v_armado_id := nullif(v_meta ->> 'armado_id', '')::uuid;

  if v_armado_id is not null then
    select * into v_armado
    from public.eos_planes_armados
    where id = v_armado_id and usuario_id = v_request.usuario_id
    for update;

    if found then
      foreach v_codigo in array coalesce(v_armado.modulos, array[]::text[]) loop
        -- Se resta exactamente lo que sumó `eos_activar_modulo`. Un módulo que
        -- al restarle los días queda en el pasado pasa a `vencido`, que es lo
        -- que habría estado si este pago nunca hubiera existido.
        update public.eos_usuario_modulos
        set vencimiento = case
              when vencimiento is null then null
              else vencimiento - make_interval(days => v_dias)
            end,
            estado = case
              when vencimiento is not null
                and (vencimiento - make_interval(days => v_dias)) <= now()
              then 'vencido'
              else estado
            end,
            actualizado_en = now()
        where usuario_id = v_request.usuario_id
          and modulo_codigo = v_codigo
          -- Una cortesía o un módulo interno no salió de este cobro: no se toca.
          and origen = 'pago';

        if found then v_modulos_rebobinados := v_modulos_rebobinados + 1; end if;
      end loop;

      update public.eos_planes_armados
      set estado = 'reversado', actualizado_en = now()
      where id = v_armado.id;
    end if;
  end if;

  -- ---------- Los rastros del cobro ----------
  update public.solicitudes_pago
  set estado = 'reversado',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'reversado_at', now(),
        'reversion_motivo', v_motivo,
        'reversion_detalle', p_detalle,
        'reversion_dias_quitados', v_dias
      )
  where id = v_request.id;

  if v_historial.id is not null then
    update public.historial_pagos
    set estado = 'reversado',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'reversado_at', now(),
          'reversion_motivo', v_motivo,
          'reversion_detalle', p_detalle
        )
    where id = v_historial.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ya_estaba', false,
    'status', 'reversado',
    'solicitud_id', v_request.id,
    'usuario_id', v_request.usuario_id,
    'dias_quitados', v_dias,
    'plan_restaurado', v_plan_previo,
    'vencimiento_restaurado', v_venc_previo,
    'modulos_rebobinados', v_modulos_rebobinados,
    'armado_id', v_armado_id
  );
end;
$$;

revoke all on function public.eos_bancard_revertir_cobro_v95(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.eos_bancard_revertir_cobro_v95(text, text, jsonb)
  to service_role;

comment on function public.eos_bancard_revertir_cobro_v95(text, text, jsonb) is
  'Bancard v95: deshace un cobro revertido — plan, módulos del armado, armado, solicitud e historial — en una transacción y de forma idempotente.';
