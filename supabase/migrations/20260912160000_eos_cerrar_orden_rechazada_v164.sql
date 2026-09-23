-- EOS — Una orden que la regla de negocio rechaza se cierra con su motivo (v164)
--
-- ============================================================
-- LO QUE PASABA, MEDIDO EL 12/09/2026
-- ============================================================
--
-- De las 23 órdenes en `error` de producción, 21 decían `ACTION_TIMEOUT: la
-- ejecución no confirmó un resultado dentro de 15 minutos`. Las otras dos eran
-- de QA. Ningún rechazo de negocio quedó registrado con su motivo: ni el
-- producto que no estaba en el catálogo, ni el contacto que no existía.
--
-- La persona sí recibía el motivo en el chat. Lo que quedaba escrito era otro,
-- y desde la v163 eso iba a quedar además en la bitácora inmutable, donde no se
-- corrige nunca.
--
-- ============================================================
-- EL ARREGLO DEL 9/09 NUNCA FUNCIONÓ
-- ============================================================
--
-- `app/api/internal/action-effects/v1` ya intentaba cerrar la orden con su
-- motivo (commit 09a4adf, `cerrarConMotivo`), llamando a
-- `eos_finalize_action_command_v66` con la clave de servicio. Pero la v70 le
-- había sacado a `service_role` el permiso sobre esa función —a propósito, ver
-- abajo—, y cada llamada devolvía
--
--     42501 permission denied for function eos_finalize_action_command_v66
--
-- que la ruta mandaba a `console.error` para seguir de largo: "en el peor caso,
-- la cierra el barrido de siempre". El barrido la cerraba, con el motivo
-- equivocado. El 10/09 hubo dos timeouts más de REGISTRAR_VENTA, y el 12/09 una
-- sonda de "vendí 2 chipas a Rossana" quedó en `ejecutando` con un solo evento.
-- El 403 se reprodujo con el mismo tipo de cliente que usa la ruta.
--
-- ============================================================
-- POR QUÉ NO SE DEVUELVE EL PERMISO SOBRE v66
-- ============================================================
--
-- La v70 ("fencing hardening") revocó de `service_role` todos los cierres sin
-- lease —v64, v65, v66 y v68— y dejó uno solo,
-- `eos_finalize_action_command_v70`, que exige `lease_token` más el intento
-- vivo. Es lo que impide que un intento que se colgó vuelva más tarde y pise el
-- resultado del intento bueno. Devolver v66 reabriría esa puerta para TODA
-- orden.
--
-- Pero la rama interna nunca toma la orden con lease: la resuelve una sola
-- función de Postgres que termina en la misma transacción, y cuando esa función
-- levanta una excepción se deshace todo y no hay lease que presentar. v70 no la
-- puede cerrar y v66 no se puede llamar: esa orden no tenía salida.
--
-- ============================================================
-- LA PUERTA ANGOSTA
-- ============================================================
--
-- `eos_cerrar_orden_rechazada_v164` hace una sola cosa: cerrar con `error` una
-- orden que NUNCA se tomó con lease. Si tiene un evento `claim:%` se niega: esa
-- se cierra presentando su lease, como manda la v70. Todo lo demás lo decide
-- v66 por dentro, sin copiarlo —que la orden exista, que el gate la haya
-- autorizado, que siga abierta, que un segundo cierre igual sea idempotente y
-- uno distinto sea conflicto—.
--
-- Nada de lo cerrado antes se reescribe: las 21 órdenes con ACTION_TIMEOUT
-- quedan como están, porque su motivo real no se guardó en ningún lado.
create or replace function public.eos_cerrar_orden_rechazada_v164(
  p_command_id uuid,
  p_error_code text,
  p_error_message text
)
returns table (
  command_id uuid,
  estado text,
  idempotent boolean,
  resultado jsonb,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_command_id is null
     or nullif(btrim(coalesce(p_error_code, '')), '') is null
     or nullif(btrim(coalesce(p_error_message, '')), '') is null then
    raise exception 'EOS_ORDEN_RECHAZADA_ARGUMENTOS';
  end if;

  -- Se toma la orden antes de mirar sus eventos: el claim también la bloquea,
  -- así que entre la pregunta y el cierre nadie la puede tomar con lease.
  perform 1 from public.eos_action_commands as c where c.id = p_command_id for update;

  -- La que se tomó con lease se cierra con su lease (v70). Esta puerta no es para ella.
  if exists (
    select 1
    from public.eos_action_events as e
    where e.command_id = p_command_id
      and e.idempotency_key like 'claim:%'
  ) then
    raise exception 'EOS_ORDEN_RECHAZADA_TOMADA_CON_LEASE';
  end if;

  return query
  select f.command_id, f.estado, f.idempotent, f.resultado, f.completed_at
  from public.eos_finalize_action_command_v66(
    p_command_id,
    'error',
    '{}'::jsonb,
    left(btrim(p_error_code), 80),
    left(btrim(p_error_message), 500)
  ) as f;
end;
$$;

comment on function public.eos_cerrar_orden_rechazada_v164(uuid, text, text) is
  'v164: cierra con error una orden que nunca se tomó con lease, cuando la regla de negocio la rechazó. Delega en eos_finalize_action_command_v66. Solo service_role; las tomadas con lease se cierran con v70.';

revoke all on function public.eos_cerrar_orden_rechazada_v164(uuid, text, text) from public, anon, authenticated;
grant execute on function public.eos_cerrar_orden_rechazada_v164(uuid, text, text) to service_role;
