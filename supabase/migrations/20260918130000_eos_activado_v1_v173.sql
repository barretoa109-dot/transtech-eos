-- "Activado" v1: el onboarding no es la puerta del valor.
--
-- La v172 definió `activado_v0` = onboarding completo + una acción exitosa + una
-- memoria + dos días de uso, y avisó que era una hipótesis a validar. Validada
-- contra las 7 cuentas reales el 2026-09-18: las DOS que de verdad usan EOS todos
-- los días (14 y 16 días activos, 11 y 22 acciones exitosas, plan pro) son
-- anteriores al onboarding y nunca lo completaron, así que v0 las descartaba y
-- daba 0 activados. Exigir un paso que quienes retienen jamás hicieron mide
-- cuánta gente pasó por el onboarding, no cuánta recibió valor.
--
-- `activado_v1` = al menos una acción exitosa + una memoria + uso en dos días
-- distintos. Sigue siendo una hipótesis (con 7 cuentas no hay estadística): se
-- agrega AL FINAL de la vista, sin tocar el resto, y v0 se conserva para poder
-- comparar. `onboarding_completo_en` sigue disponible como hito propio.
--
-- `create or replace view` conserva los permisos (solo service_role).

create or replace view public.eos_analitica_usuario_v172 as
with
  msg as (
    select
      usuario_id,
      min(created_at) as primer_mensaje,
      max(created_at) as ultimo_mensaje,
      count(*) as mensajes_usuario,
      count(*) filter (where origen = 'whatsapp') as mensajes_whatsapp,
      min(created_at) filter (where origen = 'whatsapp') as primer_whatsapp_mensaje,
      count(distinct (created_at at time zone 'America/Asuncion')::date) as dias_activos
    from public.mensajes
    where rol = 'usuario'
    group by usuario_id
  ),
  acc as (
    select
      usuario_id,
      min(created_at) as primera_accion,
      min(completed_at) filter (where estado = 'completada') as primera_accion_ok,
      count(*) filter (where estado = 'completada') as acciones_ok,
      count(*) filter (where estado = 'error') as acciones_error
    from public.eos_action_commands
    group by usuario_id
  ),
  fin as (
    select usuario_id, min(created_at) as primer_movimiento
    from public.eos_movimientos_financieros group by usuario_id
  ),
  ven as (
    select usuario_id, min(creado_en) as primera_venta
    from public.eos_erp_ventas where estado <> 'anulada' group by usuario_id
  ),
  pro as (
    select usuario_id, min(creado_en) as primer_producto
    from public.eos_erp_productos group by usuario_id
  ),
  mem as (
    select usuario_id, min(created_at) as primera_memoria, count(*) as memorias
    from public.eos_memory group by usuario_id
  ),
  obj as (
    select usuario_id, min(created_at) as primer_objetivo
    from public.eos_goals group by usuario_id
  ),
  bri as (
    select usuario_id, min(created_at) as primer_briefing
    from public.eos_daily_briefings group by usuario_id
  ),
  wa as (
    select usuario_id, min(verificado_at) as primer_whatsapp_vinculado
    from public.eos_whatsapp_vinculos_v162 where verificado_at is not null group by usuario_id
  ),
  pag as (
    select usuario_id, min(pagado_at) as primer_pago
    from public.solicitudes_pago where estado = 'pagado' group by usuario_id
  )
select
  c.usuario_id,
  c.tipo,
  u.plan,
  coalesce(u.created_at, a.created_at) as registro,
  o.completado_en as onboarding_completo_en,
  msg.primer_mensaje,
  msg.ultimo_mensaje,
  coalesce(msg.mensajes_usuario, 0) as mensajes_usuario,
  coalesce(msg.mensajes_whatsapp, 0) as mensajes_whatsapp,
  coalesce(msg.dias_activos, 0) as dias_activos,
  acc.primera_accion,
  acc.primera_accion_ok,
  coalesce(acc.acciones_ok, 0) as acciones_ok,
  coalesce(acc.acciones_error, 0) as acciones_error,
  fin.primer_movimiento,
  ven.primera_venta,
  pro.primer_producto,
  mem.primera_memoria,
  coalesce(mem.memorias, 0) as memorias,
  obj.primer_objetivo,
  bri.primer_briefing,
  coalesce(wa.primer_whatsapp_vinculado, msg.primer_whatsapp_mensaje) as primer_whatsapp,
  pag.primer_pago,
  (
    o.completado_en is not null
    and coalesce(acc.acciones_ok, 0) >= 1
    and coalesce(mem.memorias, 0) >= 1
    and coalesce(msg.dias_activos, 0) >= 2
  ) as activado_v0,
  (
    coalesce(acc.acciones_ok, 0) >= 1
    and coalesce(mem.memorias, 0) >= 1
    and coalesce(msg.dias_activos, 0) >= 2
  ) as activado_v1
from public.eos_cuentas_v172 c
left join auth.users a on a.id = c.usuario_id
left join public.usuarios u on u.id = c.usuario_id
left join public.eos_onboarding o on o.usuario_id = c.usuario_id
left join msg on msg.usuario_id = c.usuario_id
left join acc on acc.usuario_id = c.usuario_id
left join fin on fin.usuario_id = c.usuario_id
left join ven on ven.usuario_id = c.usuario_id
left join pro on pro.usuario_id = c.usuario_id
left join mem on mem.usuario_id = c.usuario_id
left join obj on obj.usuario_id = c.usuario_id
left join bri on bri.usuario_id = c.usuario_id
left join wa on wa.usuario_id = c.usuario_id
left join pag on pag.usuario_id = c.usuario_id;
