-- v228: un tramo de conversaciones PAGO y vigente cuenta para el cupo.
--
-- ============================================================
-- QUÉ PASÓ (INC-09 de la auditoría del 01/10/2026)
-- ============================================================
--
-- La reserva de cupo (`eos_reserve_message_quota_server_v75`) decide el plan
-- leyendo solo `usuarios.plan`. Ese campo lo escribe la confirmación de cada
-- pago con el `plan_codigo` de la solicitud, y un armado SIN tramo de
-- conversaciones (por ejemplo, solo ERP) lleva `plan_codigo = 'free'`
-- (`eos_precio_armado`, v66). Resultado: quien tenía el tramo de conversaciones
-- pago y vigente y después compró un armado sin conversaciones quedó con el
-- cupo del plan gratuito, aunque el módulo `conversaciones*` seguía activo y
-- pagado. Pasó en la cuenta de certificación de Bancard (28/08 al 26/09).
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- 1) `eos_plan_efectivo_v228(usuario)`: UNA sola respuesta a "¿con qué plan
--    cuenta esta persona hoy?":
--      * el plan de la cuenta, o `free` si su suscripción ya no está vigente
--        (lo mismo que hacía la reserva desde la v125);
--      * si tiene un módulo de conversaciones (`plan_equivalente` no nulo)
--        con origen `pago`, activo y con vencimiento futuro, cuenta el mayor
--        de los dos.
--    Las CORTESÍAS no suben el plan: todas las cuentas anteriores a la v66
--    tienen los tres tramos de conversaciones de regalo y sin vencimiento, y
--    contarlas daría a todo el mundo el tramo más alto.
--
-- 2) La reserva usa esa función. Se parcha en su lugar, desde
--    `pg_get_functiondef`, con una sola línea de ancla. Si el plan efectivo
--    coincide con lo que ya resolvía, no cambia nada.
--
-- No toca ninguna función de cobro, ni `usuarios.plan`, ni la renovación.
--
-- Rollback: volver a crear la reserva desde el cuerpo de la v125 y
-- `drop function public.eos_plan_efectivo_v228(uuid)`.

create or replace function public.eos_plan_efectivo_v228(p_usuario_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_modulo text;
begin
  select p.codigo into v_base
  from public.usuarios u
  join public.planes p on p.codigo = lower(coalesce(u.plan, 'free')) and p.activo = true
  where u.id = p_usuario_id;

  if v_base is null then
    return null;
  end if;

  if v_base <> 'free' and not public.eos_suscripcion_vigente_internal_v1(p_usuario_id) then
    v_base := 'free';
  end if;

  select p.codigo into v_modulo
  from public.eos_usuario_modulos um
  join public.eos_modulos m on m.codigo = um.modulo_codigo and m.plan_equivalente is not null
  join public.planes p on p.codigo = m.plan_equivalente and p.activo = true
  where um.usuario_id = p_usuario_id
    and um.estado = 'activo'
    and um.origen = 'pago'
    and um.vencimiento is not null
    and um.vencimiento > now()
  order by case when p.limite_mensajes is null or p.limite_mensajes < 0
                then 2147483647 else p.limite_mensajes end desc
  limit 1;

  if v_modulo is null or v_modulo = v_base then
    return v_base;
  end if;

  if v_base = 'free' then
    return v_modulo;
  end if;

  -- Dos planes pagos: el que más mensajes da (sin tope gana).
  return (
    select p.codigo
    from public.planes p
    where p.codigo in (v_base, v_modulo)
    order by case when p.limite_mensajes is null or p.limite_mensajes < 0
                  then 2147483647 else p.limite_mensajes end desc
    limit 1
  );
end;
$$;

revoke all on function public.eos_plan_efectivo_v228(uuid) from public, anon, authenticated;
grant execute on function public.eos_plan_efectivo_v228(uuid) to service_role;

comment on function public.eos_plan_efectivo_v228(uuid) is
  'Plan con el que cuenta la persona hoy: el de la cuenta (free si venció) o el de un tramo de conversaciones pago y vigente, el mayor. Las cortesías no cuentan.';

do $parche$
declare
  v_oid regprocedure := 'public.eos_reserve_message_quota_server_v75(uuid,uuid)'::regprocedure;
  v_def text;
  v_ancla text := '  v_subscription_active := public.eos_suscripcion_vigente_internal_v1(p_usuario_id);';
  v_veces integer;
begin
  v_def := replace(pg_get_functiondef(v_oid), chr(13), '');

  if position('eos_plan_efectivo_v228' in v_def) > 0 then
    raise notice 'v228: la reserva ya usa el plan efectivo; no se toca.';
    return;
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  if v_veces <> 1 then
    raise exception 'v228: el ancla aparece % veces, no 1. No se cambió nada.', v_veces;
  end if;

  execute replace(
    v_def,
    v_ancla,
    v_ancla || $n$

  -- v228: un tramo de conversaciones pago y vigente cuenta (ver la migración).
  if public.eos_plan_efectivo_v228(p_usuario_id) is not null
     and public.eos_plan_efectivo_v228(p_usuario_id) is distinct from
     (case when v_subscription_active then v_plan.codigo else 'free' end) then
    select p.* into v_plan
    from public.planes p
    where p.codigo = public.eos_plan_efectivo_v228(p_usuario_id) and p.activo = true
    limit 1;
    v_subscription_active := true;
  end if;$n$
  );

  raise notice 'v228: la reserva cuenta el tramo de conversaciones pago.';
end;
$parche$;
