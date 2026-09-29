-- v213: el tablero de los viernes.
--
-- Tarea metricas-01 del tablero de lanzamiento: los números que dicen si EOS
-- va bien, calculados siempre de la misma forma y sin armarlos a mano. Los
-- manda por correo interno el cron diario, solo los viernes
-- (lib/metricas/tablero-semanal.ts).
--
-- Solo cuentas reales (eos_analitica_usuario_v172, tipo = 'real'): ni QA ni
-- certificación. Devuelve conteos, nunca nombres ni correos.
--
-- La semana es [p_hasta - 7 días, p_hasta). Para comparar con la anterior se
-- llama dos veces.
--
-- Qué mide cada número:
--   nuevas          cuentas que se registraron en la semana.
--   cohorte_24h     cuentas registradas entre 8 y 1 días antes de p_hasta: ya
--                   tuvieron sus primeras 24 horas completas.
--   activadas_24h   de esa cohorte, las que tuvieron una acción completada
--                   dentro de sus primeras 24 horas.
--   activas         cuentas con al menos una acción completada en la semana.
--   acciones_ok     acciones completadas en la semana (la estrella polar es
--                   acciones_ok / activas).
--   acciones_error  acciones que terminaron en error en la semana.
--   pagando         cuentas con un módulo pagado vigente hoy.
--   base_30d        cuentas registradas hace 30 días o más.
--   retenidas_30d   de esas, las que tuvieron una acción completada o
--                   escribieron en la semana.
--   mensajes, mensajes_whatsapp   lo que escribieron las personas.
--   latencia_p50_ms, latencia_p90_ms   entre reservar y cerrar el cupo: el
--                   tiempo que el servidor tardó en contestar.

create or replace function public.eos_tablero_semanal_v213(p_hasta timestamptz default now())
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  with
    reales as (
      select usuario_id, registro, primera_accion_ok
      from public.eos_analitica_usuario_v172
      where tipo = 'real'
    ),
    semana as (
      select p_hasta - interval '7 days' as desde, p_hasta as hasta
    ),
    acciones as (
      select c.usuario_id, c.estado
      from public.eos_action_commands c, semana s
      where c.created_at >= s.desde and c.created_at < s.hasta
        and c.usuario_id in (select usuario_id from reales)
    ),
    -- mensajes.created_at es timestamp SIN zona, en UTC: se compara en UTC.
    escritos as (
      select m.usuario_id, m.origen
      from public.mensajes m, semana s
      where m.rol = 'usuario'
        and m.created_at >= (s.desde at time zone 'utc')
        and m.created_at < (s.hasta at time zone 'utc')
        and m.usuario_id in (select usuario_id from reales)
    ),
    cohorte as (
      select r.*
      from reales r
      where r.registro >= p_hasta - interval '8 days'
        and r.registro < p_hasta - interval '1 day'
    ),
    tiempos as (
      select extract(epoch from (u.consumed_at - u.created_at)) * 1000 as ms
      from public.eos_message_usage_v40 u, semana s
      where u.status = 'consumed'
        and u.created_at >= s.desde and u.created_at < s.hasta
        and u.consumed_at is not null
        and u.usuario_id in (select usuario_id from reales)
    )
  select jsonb_build_object(
    'desde', (select desde from semana),
    'hasta', (select hasta from semana),
    'reales', (select count(*) from reales),
    'nuevas', (
      select count(*) from reales r, semana s
      where r.registro >= s.desde and r.registro < s.hasta
    ),
    'cohorte_24h', (select count(*) from cohorte),
    'activadas_24h', (
      select count(*) from cohorte
      where primera_accion_ok is not null
        and primera_accion_ok < registro + interval '24 hours'
    ),
    'activas', (select count(distinct usuario_id) from acciones where estado = 'completada'),
    'acciones_ok', (select count(*) from acciones where estado = 'completada'),
    'acciones_error', (select count(*) from acciones where estado = 'error'),
    'pagando', (
      select count(distinct m.usuario_id)
      from public.eos_usuario_modulos m
      where m.origen = 'pago'
        and m.estado = 'activo'
        and (m.vencimiento is null or m.vencimiento > p_hasta)
        and m.usuario_id in (select usuario_id from reales)
    ),
    'base_30d', (
      select count(*) from reales
      where registro < p_hasta - interval '30 days'
    ),
    'retenidas_30d', (
      select count(*) from reales r
      where r.registro < p_hasta - interval '30 days'
        and (
          exists (select 1 from acciones a where a.usuario_id = r.usuario_id and a.estado = 'completada')
          or exists (select 1 from escritos e where e.usuario_id = r.usuario_id)
        )
    ),
    'mensajes', (select count(*) from escritos),
    'mensajes_whatsapp', (select count(*) from escritos where origen = 'whatsapp'),
    'latencia_p50_ms', (select round(percentile_cont(0.5) within group (order by ms)) from tiempos),
    'latencia_p90_ms', (select round(percentile_cont(0.9) within group (order by ms)) from tiempos)
  );
$$;

revoke all on function public.eos_tablero_semanal_v213(timestamptz) from public, anon, authenticated;
grant execute on function public.eos_tablero_semanal_v213(timestamptz) to service_role;

comment on function public.eos_tablero_semanal_v213(timestamptz) is
  'Los números de la semana [p_hasta - 7d, p_hasta) para el tablero de los viernes. Solo cuentas reales y solo conteos. Lo llama lib/metricas/tablero-semanal.ts.';
