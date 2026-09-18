-- Qué cuenta es real, y qué hizo cada una: la base de las métricas de producto.
--
-- ============================================================
-- POR QUÉ
-- ============================================================
--
-- Auditado el 2026-09-18: `usuarios` tiene 70 filas contra 18 en `auth.users`
-- (56 son restos de borrados crudos, todos free), y entre las 18 hay cuentas
-- de prueba (`prueba-*@ejemplo.com`, `claude-latencia-qa-*@transtech-eos-qa.test`,
-- la demo de Bancard). Nada las distingue de una persona real, así que
-- cualquier conteo —activos, retención, conversión, costo de IA por usuario—
-- las suma como si fueran clientes.
--
-- Esta migración NO borra ni modifica ninguna fila existente. Agrega:
--
--   1. `eos_cuenta_tipo_v172`: marca explícita (real, qa, certificacion,
--      interna, legacy). Sin marca, el tipo se deduce en la vista.
--   2. `eos_cuentas_v172`: el tipo de CADA cuenta, resuelto.
--   3. `eos_analitica_usuario_v172`: una fila por cuenta con los hitos del
--      embudo (primer mensaje, primera acción exitosa, primera venta...).
--   4. `eos_costo_ia_v172`: costo de IA por mes y plan, solo cuentas reales.
--
-- No hay trigger sobre `auth.users` a propósito: un trigger nuevo ahí que
-- falle tumba el registro de todos. El tipo se deduce al LEER.
--
-- ============================================================
-- LA DEFINICIÓN DE "ACTIVADO" ES PROVISIONAL
-- ============================================================
--
-- `activado_v0` = onboarding completo + al menos una acción exitosa + al menos
-- una memoria + uso en dos días distintos. Es una hipótesis para medir, no una
-- verdad: hay que validarla contra quién de verdad vuelve.
--
-- ============================================================
-- PERMISOS
-- ============================================================
--
-- Las tablas y vistas nuevas nacen con acceso para anon/authenticated por el
-- `alter default privileges` de la v0. Estas cuatro contienen datos de todos
-- los usuarios: se revoca de forma explícita, nombrando los roles (y PUBLIC),
-- y solo `service_role` las lee.

create table if not exists public.eos_cuenta_tipo_v172 (
  usuario_id uuid primary key references auth.users (id) on delete cascade,
  tipo text not null
    check (tipo in ('real', 'qa', 'certificacion', 'interna', 'legacy')),
  motivo text,
  marcado_en timestamptz not null default now()
);

alter table public.eos_cuenta_tipo_v172 enable row level security;

revoke all on table public.eos_cuenta_tipo_v172 from public, anon, authenticated;
grant select, insert, update, delete on table public.eos_cuenta_tipo_v172 to service_role;

comment on table public.eos_cuenta_tipo_v172 is
  'Marca explícita del tipo de cuenta. Sin fila, el tipo se deduce en eos_cuentas_v172. Solo service_role.';

-- Marcas explícitas de lo que ya se sabe que no es un cliente.
insert into public.eos_cuenta_tipo_v172 (usuario_id, tipo, motivo)
select a.id, 'certificacion', 'cuenta demo de la certificación de Bancard'
from auth.users a
where lower(a.email) = 'demo@transtech.com.py'
on conflict (usuario_id) do nothing;

insert into public.eos_cuenta_tipo_v172 (usuario_id, tipo, motivo)
select a.id, 'interna', 'cuenta del arnés de QA de RC1 (memorias y tareas de prueba)'
from auth.users a
where lower(a.email) = 'transtecheos@gmail.com'
on conflict (usuario_id) do nothing;

-- El tipo de cada cuenta: marca explícita, o deducido.
create or replace view public.eos_cuentas_v172 as
select
  a.id as usuario_id,
  coalesce(
    t.tipo,
    case
      when a.email ~* '(@example\.com|@ejemplo\.com|@transtech-eos-qa\.test)$' then 'qa'
      when a.email ~* '^(prueba|qa|test)-' then 'qa'
      else 'real'
    end
  ) as tipo
from auth.users a
left join public.eos_cuenta_tipo_v172 t on t.usuario_id = a.id
union all
-- Filas de `usuarios` sin cuenta de acceso: restos de borrados crudos.
select u.id, 'legacy'
from public.usuarios u
where not exists (select 1 from auth.users a where a.id = u.id);

revoke all on table public.eos_cuentas_v172 from public, anon, authenticated;
grant select on table public.eos_cuentas_v172 to service_role;

-- Una fila por cuenta con los hitos del embudo.
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
  ) as activado_v0
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

revoke all on table public.eos_analitica_usuario_v172 from public, anon, authenticated;
grant select on table public.eos_analitica_usuario_v172 to service_role;

-- Costo de IA por mes y plan, solo cuentas reales.
create or replace view public.eos_costo_ia_v172 as
select
  m.periodo,
  coalesce(u.plan, 'sin_plan') as plan,
  count(distinct m.usuario_id) as usuarios,
  sum(m.mensajes_usados) as mensajes,
  sum(m.tokens_entrada) as tokens_entrada,
  sum(m.tokens_salida) as tokens_salida,
  round(sum(m.costo_estimado_usd)::numeric, 4) as costo_usd,
  round((sum(m.costo_estimado_usd) / nullif(count(distinct m.usuario_id), 0))::numeric, 4)
    as costo_usd_por_usuario
from public.uso_mensual m
join public.eos_cuentas_v172 c on c.usuario_id = m.usuario_id and c.tipo = 'real'
left join public.usuarios u on u.id = m.usuario_id
group by m.periodo, coalesce(u.plan, 'sin_plan');

revoke all on table public.eos_costo_ia_v172 from public, anon, authenticated;
grant select on table public.eos_costo_ia_v172 to service_role;
