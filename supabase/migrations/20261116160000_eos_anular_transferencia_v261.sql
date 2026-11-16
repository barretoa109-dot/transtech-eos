-- Anular un pago por transferencia que se aprobó y no correspondía (v261).
--
-- ============================================================
-- EL AGUJERO
-- ============================================================
--
-- Desde el 2026-11-16 EOS cobra solo por transferencia, y un agente puede
-- activar un plan mirando el comprobante cuando el dueño no contesta. El
-- agente ve una captura, no la cuenta del banco: alguna vez va a activar un
-- plan que nadie pagó. Y el dueño también puede tocar "aprobar" en la fila
-- equivocada.
--
-- Para cualquiera de los dos casos no había vuelta atrás: `/admin/pagos` solo
-- aprueba o rechaza lo que está `en_revision`. Una vez `pagado`, el plan
-- quedaba activo hasta que alguien lo corrigiera a mano en la base.
--
-- ============================================================
-- QUÉ DESHACE
-- ============================================================
--
-- Lo mismo que la v95 deshace para Bancard, y por el mismo motivo se hace todo
-- o nada, en una transacción:
--
--   1. `solicitudes_pago.estado`: de `pagado` a `reversado`.
--   2. La fila de `historial_pagos`.
--   3. El plan del usuario: vuelve al plan, inicio y vencimiento que tenía.
--   4. Si el pedido era de un armado: sus módulos pierden los días que sumó
--      este pago, y el armado queda `reversado`.
--
-- Para volver al plan anterior hace falta saber cuál era, y la aprobación no
-- lo guardaba. La parte 1 de esta migración se lo agrega (`plan_previo`,
-- `inicio_previo`), sin cambiar su firma ni su comportamiento. Al escribir
-- esto no hay en producción NINGÚN pago por transferencia aprobado, así que no
-- existen pagos viejos sin ese dato; si apareciera uno, la anulación es
-- conservadora igual que la v95: rebobina el vencimiento y no toca el plan.
--
-- NO devuelve plata: eso es una transferencia que hace el dueño desde su banco.

-- ============================================================
-- 1) Que la aprobación guarde el plan anterior
-- ============================================================
--
-- Idéntica a la v45 salvo por `plan_previo` e `inicio_previo` en la metadata
-- del historial. Se reproduce entera porque `create or replace` no admite
-- parches parciales. Comprobado contra producción antes de escribirla: la
-- función vigente era la v45.

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
  v_duration_days integer;
  v_reference text;
  v_plan_state jsonb;
  v_history_id uuid;
  v_history_request_id uuid;
  v_previous_plan text;
  v_previous_start timestamptz;
  v_previous_expiry timestamptz;
  v_same_active_plan boolean := false;
begin
  if p_solicitud_id is null then raise exception 'EOS_PAYMENT_REQUEST_ID_REQUIRED'; end if;
  if v_action not in ('aprobar', 'rechazar') then raise exception 'EOS_PAYMENT_ACTION_INVALID'; end if;
  if v_admin = '' then raise exception 'EOS_PAYMENT_ADMIN_REQUIRED'; end if;

  select s.* into v_request
  from public.solicitudes_pago s
  where s.id = p_solicitud_id
  for update;

  if not found then raise exception 'EOS_PAYMENT_REQUEST_NOT_FOUND'; end if;
  if lower(coalesce(v_request.proveedor, '')) <> 'transferencia' then raise exception 'EOS_PAYMENT_PROVIDER_INVALID'; end if;

  select lower(coalesce(u.plan, 'free')), u.plan_inicio, u.plan_vencimiento
    into v_previous_plan, v_previous_start, v_previous_expiry
  from public.usuarios u
  where u.id = v_request.usuario_id
  for update;

  if not found then raise exception 'EOS_PAYMENT_USER_NOT_FOUND'; end if;

  if v_action = 'aprobar' then
    if v_request.estado = 'pagado' then
      select h.id into v_history_id
      from public.historial_pagos h
      where h.solicitud_pago_id = v_request.id
      order by h.created_at desc
      limit 1;

      return jsonb_build_object(
        'ok', true, 'action', 'aprobar', 'status', 'pagado', 'idempotent', true,
        'solicitud_id', v_request.id, 'usuario_id', v_request.usuario_id,
        'plan_codigo', v_request.plan_codigo, 'history_id', v_history_id
      );
    end if;

    if v_request.estado = 'rechazado' then raise exception 'EOS_PAYMENT_TERMINAL_CONFLICT'; end if;
    if v_request.estado <> 'en_revision' then raise exception 'EOS_PAYMENT_NOT_REVIEWABLE'; end if;
    if lower(coalesce(v_request.periodicidad, '')) not in ('mensual', 'anual') then raise exception 'EOS_PAYMENT_PERIOD_INVALID'; end if;

    v_duration_days := case when lower(v_request.periodicidad) = 'anual' then 365 else 30 end;
    v_reference := coalesce(
      nullif(btrim(v_request.referencia_externa), ''),
      nullif(btrim(v_request.referencia_interna), ''),
      'transferencia-' || v_request.id::text
    );

    select h.id, h.solicitud_pago_id
      into v_history_id, v_history_request_id
    from public.historial_pagos h
    where h.proveedor = 'transferencia'
      and h.referencia_externa = v_reference
    for update;

    if found and v_history_request_id is distinct from v_request.id then
      raise exception 'EOS_PAYMENT_REFERENCE_CONFLICT';
    end if;

    v_same_active_plan :=
      v_previous_plan = lower(v_request.plan_codigo)
      and v_previous_expiry is not null
      and v_previous_expiry > now();

    v_plan_state := public.asignar_plan_eos(
      v_request.usuario_id,
      v_request.plan_codigo,
      v_duration_days
    );

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
        referencia_externa = v_reference,
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'procesado_por_admin', v_admin,
          'procesado_at', now(),
          'manual_payment_atomic_version', 'v45',
          'same_plan_renewal', v_same_active_plan,
          'dias_acreditados', v_duration_days
        )
    where id = v_request.id
    returning * into v_request;

    insert into public.historial_pagos (
      solicitud_pago_id, usuario_id, plan_codigo, periodicidad, monto, moneda,
      proveedor, referencia_externa, estado, pagado_at, metadata
    ) values (
      v_request.id, v_request.usuario_id, v_request.plan_codigo, v_request.periodicidad,
      v_request.monto, v_request.moneda, 'transferencia', v_reference, 'pagado',
      v_request.pagado_at,
      jsonb_build_object(
        'origen', 'aprobacion_manual_admin',
        'procesado_por_admin', v_admin,
        'manual_payment_atomic_version', 'v45',
        'same_plan_renewal', v_same_active_plan,
        'dias_acreditados', v_duration_days,
        'vencimiento_previo', v_previous_expiry,
        -- Lo único que agrega la v261: sin esto, una anulación no sabe a qué
        -- plan volver y tiene que adivinar. Mismo arreglo que la v95 en Bancard.
        'plan_previo', v_previous_plan,
        'inicio_previo', v_previous_start
      )
    )
    on conflict (proveedor, referencia_externa) do update set
      estado = excluded.estado,
      pagado_at = excluded.pagado_at,
      metadata = public.historial_pagos.metadata || excluded.metadata
    where public.historial_pagos.solicitud_pago_id = excluded.solicitud_pago_id
    returning id into v_history_id;

    if v_history_id is null then raise exception 'EOS_PAYMENT_REFERENCE_CONFLICT'; end if;

    return jsonb_build_object(
      'ok', true, 'action', 'aprobar', 'status', 'pagado', 'idempotent', false,
      'solicitud_id', v_request.id, 'usuario_id', v_request.usuario_id,
      'plan_codigo', v_request.plan_codigo, 'history_id', v_history_id,
      'same_plan_renewal', v_same_active_plan,
      'credited_days', v_duration_days,
      'plan_state', v_plan_state
    );
  end if;

  if v_request.estado = 'rechazado' then
    return jsonb_build_object(
      'ok', true, 'action', 'rechazar', 'status', 'rechazado', 'idempotent', true,
      'solicitud_id', v_request.id, 'usuario_id', v_request.usuario_id,
      'plan_codigo', v_request.plan_codigo
    );
  end if;

  if v_request.estado = 'pagado' then raise exception 'EOS_PAYMENT_TERMINAL_CONFLICT'; end if;
  if v_request.estado <> 'en_revision' then raise exception 'EOS_PAYMENT_NOT_REVIEWABLE'; end if;

  update public.solicitudes_pago
  set estado = 'rechazado',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'procesado_por_admin', v_admin,
        'procesado_at', now(),
        'rechazado_manualmente', true,
        'manual_payment_atomic_version', 'v45'
      )
  where id = v_request.id;

  return jsonb_build_object(
    'ok', true, 'action', 'rechazar', 'status', 'rechazado', 'idempotent', false,
    'solicitud_id', v_request.id, 'usuario_id', v_request.usuario_id,
    'plan_codigo', v_request.plan_codigo
  );
end;
$$;

revoke all on function public.eos_process_manual_payment_v42(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_process_manual_payment_v42(uuid, text, text)
  to service_role;

comment on function public.eos_process_manual_payment_v42(uuid, text, text) is
  'RC1 v45 + v261: pago manual atomico/idempotente; guarda plan_previo e inicio_previo en el historial para poder anularlo (eos_anular_transferencia_v261).';

-- ============================================================
-- 2) Anularlo
-- ============================================================

create or replace function public.eos_anular_transferencia_v261(
  p_solicitud_id uuid,
  p_motivo text,
  p_admin_email text
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
  v_admin text := left(lower(btrim(coalesce(p_admin_email, ''))), 320);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if p_solicitud_id is null then
    raise exception 'EOS_PAYMENT_REQUEST_ID_REQUIRED';
  end if;

  if v_admin = '' then
    raise exception 'EOS_PAYMENT_ADMIN_REQUIRED';
  end if;

  -- El motivo es obligatorio: una anulación sin motivo es imposible de
  -- explicarle después al cliente que pregunta por qué se le apagó EOS.
  if v_motivo is null then
    raise exception 'EOS_REVERSION_MOTIVO_REQUERIDO';
  end if;
  v_motivo := left(v_motivo, 500);

  select s.* into v_request
  from public.solicitudes_pago s
  where s.id = p_solicitud_id
  for update;

  if not found then
    raise exception 'EOS_PAYMENT_REQUEST_NOT_FOUND';
  end if;

  -- Un cobro de Bancard tiene su propia reversión (v95), que además conoce
  -- el rollback del banco. Esta puerta es solo para transferencias.
  if lower(coalesce(v_request.proveedor, '')) <> 'transferencia' then
    raise exception 'EOS_PAYMENT_PROVIDER_INVALID';
  end if;

  -- Dos clics seguidos no pueden descontarle los días dos veces a nadie.
  if v_request.estado = 'reversado' then
    return jsonb_build_object(
      'ok', true, 'ya_estaba', true, 'status', 'reversado',
      'solicitud_id', v_request.id, 'usuario_id', v_request.usuario_id
    );
  end if;

  -- Solo se anula lo que se aprobó. Un rechazado o uno en revisión no dejó
  -- nada que deshacer.
  if v_request.estado <> 'pagado' then
    raise exception 'EOS_PAYMENT_NO_ESTABA_PAGADO: %', v_request.estado;
  end if;

  select h.* into v_historial
  from public.historial_pagos h
  where h.solicitud_pago_id = v_request.id
  order by h.created_at desc
  limit 1
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
    -- No había plan: este pago fue el que lo estrenó, así que se apaga.
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
          -- Una cortesía o un módulo interno no salió de este pago: no se toca.
          and origen = 'pago';

        if found then v_modulos_rebobinados := v_modulos_rebobinados + 1; end if;
      end loop;

      update public.eos_planes_armados
      set estado = 'reversado', actualizado_en = now()
      where id = v_armado.id;
    end if;
  end if;

  -- ---------- Los rastros del pago ----------
  update public.solicitudes_pago
  set estado = 'reversado',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'reversado_at', now(),
        'reversion_motivo', v_motivo,
        'reversion_por_admin', v_admin,
        'reversion_dias_quitados', v_dias
      )
  where id = v_request.id;

  if v_historial.id is not null then
    update public.historial_pagos
    set estado = 'reversado',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'reversado_at', now(),
          'reversion_motivo', v_motivo,
          'reversion_por_admin', v_admin
        )
    where id = v_historial.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ya_estaba', false,
    'status', 'reversado',
    'solicitud_id', v_request.id,
    'usuario_id', v_request.usuario_id,
    'plan_codigo', v_request.plan_codigo,
    'dias_quitados', v_dias,
    'plan_restaurado', v_plan_previo,
    'vencimiento_restaurado', v_venc_previo,
    'modulos_rebobinados', v_modulos_rebobinados,
    'armado_id', v_armado_id
  );
end;
$$;

revoke all on function public.eos_anular_transferencia_v261(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_anular_transferencia_v261(uuid, text, text)
  to service_role;

comment on function public.eos_anular_transferencia_v261(uuid, text, text) is
  'v261: anula un pago por transferencia ya aprobado — plan, módulos del armado, armado, solicitud e historial — en una transacción y de forma idempotente. No devuelve plata.';
