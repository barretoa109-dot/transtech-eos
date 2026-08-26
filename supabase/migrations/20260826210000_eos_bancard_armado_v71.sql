-- EOS — cobrar con tarjeta el plan que armó el usuario
--
-- ============================================================
-- EL AGUJERO QUE ESTO CIERRA
-- ============================================================
--
-- Desde la v66 el usuario arma su EOS función por función y paga la suma. Pero
-- de los dos caminos de pago solo la TRANSFERENCIA sabía cobrar ese monto: la
-- tarjeta —que es el camino principal— seguía cobrando el precio del plan.
--
-- En la práctica eso significaba que alguien que armaba un EOS de Gs. 340.000 y
-- pagaba con tarjeta era cobrado por el tramo de conversaciones nomás, y
-- recibía igual todos los módulos que eligió, porque el trigger de la v66 los
-- activa mirando el `metadata`. Cobrar de menos y entregar de más no es un bug
-- de contabilidad: es el producto regalándose solo.
--
-- Lo mismo con la RENOVACIÓN. El cobro recurrente lee el precio del plan, así
-- que el mes dos en adelante cobraría el tramo y no el armado. Un agujero que
-- crece con cada usuario y con cada mes.
--
-- ============================================================
-- POR QUÉ SON FUNCIONES NUEVAS Y NO UN PARCHE A LAS DE BANCARD
-- ============================================================
--
-- `eos_bancard_crear_cobro_v51` y `eos_bancard_crear_pago_ocasional_v52` están
-- en certificación con Bancard. Tocarlas obligaría a volver a certificar un
-- camino que ya funciona, y por un motivo que no tiene nada que ver con la
-- pasarela: de dónde sale el monto.
--
-- Entonces esta función hace exactamente lo mismo que aquellas —misma secuencia
-- de `shop_process_id`, misma forma de `solicitudes_pago`, mismo formato de
-- `referencia_interna`— y lo único que cambia es que el monto viene del armado.
-- La confirmación, el token y el webhook no se enteran de nada.
--
-- El `plan_codigo` sigue siendo uno de los de siempre —el del tramo de
-- conversaciones elegido— para que `asignar_plan_eos` fije el plan y el cupo de
-- mensajes como toda la vida. Los módulos extra los activa el trigger de la v66
-- al ver `armado_id` en el metadata.

create or replace function public.eos_bancard_crear_pago_armado_v71(
  p_usuario_id uuid,
  p_armado_id uuid,
  -- Sin tarjeta = pago ocasional (el usuario va a tipear los datos).
  -- Con tarjeta = cobro sobre una tarjeta ya catastrada.
  p_tarjeta_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_armado public.eos_planes_armados%rowtype;
  v_tarjeta public.eos_bancard_tarjetas_v51%rowtype;
  v_plan text;
  v_shop_process_id bigint;
  v_solicitud_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if p_usuario_id is null then
    raise exception 'EOS_BANCARD_USER_REQUIRED';
  end if;

  perform 1 from public.usuarios u where u.id = p_usuario_id for update;

  if not found then
    raise exception 'EOS_BANCARD_USER_NOT_FOUND';
  end if;

  select * into v_armado
  from public.eos_planes_armados
  where id = p_armado_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_ARMADO_NO_EXISTE';
  end if;

  if v_armado.monto <= 0 then
    raise exception 'EOS_ARMADO_MONTO_INVALIDO';
  end if;

  if p_tarjeta_id is not null then
    select t.* into v_tarjeta
    from public.eos_bancard_tarjetas_v51 t
    where t.id = p_tarjeta_id
      and t.usuario_id = p_usuario_id
      and t.estado = 'activa';

    if not found then
      raise exception 'EOS_BANCARD_CARD_NOT_FOUND';
    end if;
  end if;

  -- El plan del tramo de conversaciones elegido, o el de entrada si no eligió
  -- ninguno: se puede tener EOS sin chatear.
  select coalesce(m.plan_equivalente, 'free')
    into v_plan
  from public.eos_modulos m
  where m.codigo = any(v_armado.modulos)
    and m.plan_equivalente is not null
  order by m.precio_mensual_pyg desc
  limit 1;

  v_plan := coalesce(v_plan, 'free');

  v_shop_process_id := nextval('public.eos_bancard_shop_process_id_seq');

  insert into public.solicitudes_pago (
    usuario_id, plan_codigo, periodicidad, moneda, monto,
    proveedor, estado, referencia_interna, referencia_externa,
    vencimiento_pago, metadata
  ) values (
    p_usuario_id, v_plan, v_armado.periodicidad, v_armado.moneda, v_armado.monto,
    'bancard', 'pendiente',
    'EOSBC' || v_shop_process_id::text,
    v_shop_process_id::text,
    now() + interval '1 hour',
    jsonb_build_object(
      'bancard_shop_process_id', v_shop_process_id,
      'modalidad', case when p_tarjeta_id is null then 'pago_ocasional' else 'cobro_tarjeta' end,
      'cobro_version', 'v71',
      -- Lo que hace que el trigger de la v66 active los módulos al confirmarse.
      'armado_id', p_armado_id,
      'armado_modulos', to_jsonb(v_armado.modulos),
      'tarjeta_id', p_tarjeta_id,
      'bancard_card_id', v_tarjeta.bancard_card_id
    )
  )
  returning id into v_solicitud_id;

  return jsonb_build_object(
    'ok', true,
    'solicitud_id', v_solicitud_id,
    'shop_process_id', v_shop_process_id,
    'monto', v_armado.monto,
    'plan_codigo', v_plan,
    'periodicidad', v_armado.periodicidad,
    'armado_id', p_armado_id
  );
end;
$$;

revoke all on function public.eos_bancard_crear_pago_armado_v71(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.eos_bancard_crear_pago_armado_v71(uuid, uuid, uuid)
  to service_role;

comment on function public.eos_bancard_crear_pago_armado_v71(uuid, uuid, uuid) is
  'Bancard v71: solicitud de pago por el monto del EOS armado. Igual que v51/v52 salvo de dónde sale el monto.';

-- ============================================================
-- Qué armado hay que renovarle a este usuario
-- ============================================================
--
-- La renovación necesita saber CUÁNTO cobrar, y ese número vive en el armado
-- vigente, no en el plan. Se expone como función y no como consulta directa
-- para que el cron no tenga que conocer la tabla ni sus estados: el día que se
-- agregue un estado nuevo —una pausa, una prueba— se corrige acá y no en cada
-- lugar que renueva.

create or replace function public.eos_armado_vigente(p_usuario_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'armado_id', a.id,
    'modulos', to_jsonb(a.modulos),
    'monto', a.monto,
    'moneda', a.moneda,
    'periodicidad', a.periodicidad
  )
  from public.eos_planes_armados a
  where a.usuario_id = p_usuario_id
    and a.estado = 'vigente'
  order by a.actualizado_en desc
  limit 1;
$$;

revoke all on function public.eos_armado_vigente(uuid) from public, anon, authenticated;
grant execute on function public.eos_armado_vigente(uuid) to service_role;

comment on function public.eos_armado_vigente(uuid) is
  'El armado que hay que renovarle a un usuario, con su monto congelado. NULL si no armó ninguno.';
