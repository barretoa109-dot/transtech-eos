-- Cuándo una cuenta real empieza a usar Personal, no solo el negocio.
--
-- El 08/10/2026 el diagnóstico (docs/auditoria-general.md) corrió
-- auditar-areas.mts contra producción y encontró que Personal, que el
-- 10/09/2026 estaba en cero, ya tiene datos reales: 4 de 5 cuentas reales
-- declararon una cuenta, una tarjeta o un gasto fijo. No había forma de medir
-- CUÁNDO pasó eso por primera vez, solo cuántas filas hay hoy.
--
-- La vista ya resuelve exactamente este problema para el negocio
-- (`primer_movimiento`, `primera_venta`, `primer_producto`): un CTE por área
-- que toma el primer `created_at` de la tabla real. Esto agrega el mismo
-- patrón para las cuatro áreas de Personal, filtrando `ambito = 'personal'`
-- porque tarjetas, cuentas, deudas y fijos son compartidos con el negocio
-- desde la v136/v143.
--
-- No se toca `activado_v0` ni `activado_v1`: son el umbral de activación ya
-- validado, y cambiar qué cuenta como "activado" es una decisión de producto
-- aparte, no algo que este cambio deba decidir de paso.
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
  ),
  cue_p as (
    select usuario_id, min(created_at) as primera_cuenta_personal
    from public.eos_finanzas_cuentas where ambito = 'personal' group by usuario_id
  ),
  tar_p as (
    select usuario_id, min(created_at) as primera_tarjeta_personal
    from public.eos_finanzas_tarjetas where ambito = 'personal' group by usuario_id
  ),
  fij_p as (
    select usuario_id, min(created_at) as primer_fijo_personal
    from public.eos_finanzas_fijos where ambito = 'personal' group by usuario_id
  ),
  deu_p as (
    select usuario_id, min(created_at) as primera_deuda_personal
    from public.eos_finanzas_deudas where ambito = 'personal' group by usuario_id
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
  ) as activado_v1,
  -- Las cuatro columnas nuevas van AL FINAL, después de activado_v0 y
  -- activado_v1: `create or replace view` no permite cambiar la posición de
  -- una columna existente, solo agregar al final (probado contra producción
  -- el 09/10/2026 -- la primera versión las puso antes de activado_v0 y
  -- Postgres lo rechazó con "cannot change name of view column").
  cue_p.primera_cuenta_personal,
  tar_p.primera_tarjeta_personal,
  fij_p.primer_fijo_personal,
  deu_p.primera_deuda_personal
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
left join pag on pag.usuario_id = c.usuario_id
left join cue_p on cue_p.usuario_id = c.usuario_id
left join tar_p on tar_p.usuario_id = c.usuario_id
left join fij_p on fij_p.usuario_id = c.usuario_id
left join deu_p on deu_p.usuario_id = c.usuario_id;
