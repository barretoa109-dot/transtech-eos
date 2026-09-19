-- Reconstruir una acción de principio a fin con una sola consulta.
--
-- ============================================================
-- POR QUÉ
-- ============================================================
--
-- El encargo pide que cada comando sea trazable por `request_id`, `command_id`,
-- `usuario_id` y `conversacion_id`, y "nunca depender de logs dispersos para
-- reconstruir qué ocurrió". Todos los hechos ya se guardan, pero repartidos en
-- cuatro tablas con nombres de columna distintos:
--
--   * `eos_action_commands`       — el pedido y su estado actual.
--   * `eos_worker_gate_audit_v15` — qué decidió la puerta (allow, block, approval...).
--   * `eos_autonomy_events_v12`   — la autorización (auto_allowed, consumed, expired...).
--   * `eos_action_approvals_v12`  — la aprobación pedida a la persona.
--   * `eos_action_events`         — la ejecución (iniciada, completada, error).
--
-- Investigar por qué una acción "no se hizo" obligaba a abrir las cinco y
-- ordenarlas a mano. El 2026-09-09 los `ACTION_TIMEOUT` mandaron a buscar un
-- problema de red que era un producto no encontrado: el motivo real estaba en
-- otra tabla.
--
-- ============================================================
-- QUÉ ES
-- ============================================================
--
-- Una vista, una fila por HECHO, ordenable por `momento`:
--
--   select * from eos_traza_accion_v183 where request_id = '...' order by momento, paso;
--   select * from eos_traza_accion_v183 where command_id = '...' order by momento, paso;
--
-- Ordenar por `momento` y después por `paso` (1 pedido, 2 puerta, 3 autonomía,
-- 4 aprobación, 5 ejecución iniciada, 6 resultado): varios hechos comparten el
-- mismo instante y sin `paso` el empate se resolvería alfabéticamente.
--
-- `fuente` dice de qué tabla sale (orden, puerta, autonomia, aprobacion,
-- ejecucion) y `evento` qué pasó. No calcula nada nuevo ni inventa eventos: si
-- una acción no tiene aprobación, simplemente no hay filas de esa fuente.
--
-- Es una vista de operación: contiene datos de todas las cuentas, así que se
-- revoca de forma explícita (los default privileges de la v0 la abrirían a
-- anon y authenticated) y solo la lee `service_role`.

create or replace view public.eos_traza_accion_v183 as
with hechos as (
  select
    c.id as command_id,
    c.created_at as momento,
    'orden'::text as fuente,
    'solicitada'::text as evento,
    c.accion as detalle,
    null::integer as duracion_ms,
    1 as paso
  from public.eos_action_commands c

  union all

  select
    g.command_id,
    g.created_at,
    'puerta',
    g.decision,
    nullif(concat_ws(' · ', g.reason, g.error_code), ''),
    null,
    2
  from public.eos_worker_gate_audit_v15 g
  where g.command_id is not null

  union all

  select
    a.command_id,
    a.created_at,
    'autonomia',
    a.event_type,
    nullif(left(coalesce(a.detail::text, ''), 300), ''),
    null,
    3
  from public.eos_autonomy_events_v12 a
  where a.command_id is not null

  union all

  select
    p.command_id,
    p.created_at,
    'aprobacion',
    p.status,
    p.reason,
    null,
    4
  from public.eos_action_approvals_v12 p
  where p.command_id is not null

  union all

  select
    e.command_id,
    e.created_at,
    'ejecucion',
    e.tipo,
    nullif(concat_ws(' · ', e.error_code, e.error_message), ''),
    e.duration_ms,
    case when e.tipo = 'iniciada' then 5 else 6 end
  from public.eos_action_events e
)
select
  c.request_id,
  c.id as command_id,
  c.usuario_id,
  c.conversacion_id,
  c.accion,
  c.estado as estado_actual,
  h.momento,
  h.fuente,
  h.evento,
  h.detalle,
  h.duracion_ms,
  h.paso
from public.eos_action_commands c
join hechos h on h.command_id = c.id;

revoke all on table public.eos_traza_accion_v183 from public, anon, authenticated;
grant select on table public.eos_traza_accion_v183 to service_role;

comment on view public.eos_traza_accion_v183 is
  'Todos los hechos de una acción (pedido, puerta, autonomía, aprobación, ejecución) por request_id/command_id. Solo service_role.';
