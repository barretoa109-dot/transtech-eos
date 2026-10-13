-- Primer paso de "comprobante de transferencia por WhatsApp, un toque para
-- confirmar el cobro" (13/10/2026): una búsqueda de solo lectura de las
-- ventas pendientes de un contacto, para saber a qué venta corresponde un
-- comprobante antes de siquiera pensar en pedirle al dueño que lo confirme.
--
-- Mismo criterio que ya usa eos_erp_cobranza_por_chat_v151 para encontrar lo
-- pendiente (estado <> 'anulada' y saldo > 0 por eos_erp_saldo_documento_v107),
-- pero acá SOLO lee: no cobra nada, no toca eos_movimientos_financieros ni
-- eos_erp_cuenta_movimientos_v107. Esa función sigue siendo la única que
-- ejecuta un cobro de verdad, y sigue yendo siempre detrás de una aprobación.

create or replace function public.eos_erp_ventas_pendientes_v245(
  p_usuario_id uuid,
  p_contacto_id uuid
)
returns table(venta_id uuid, total numeric, saldo numeric, moneda text, fecha date)
language sql
stable
security definer
set search_path to ''
as $function$
  select v.id, v.total, public.eos_erp_saldo_documento_v107(v.id, null), v.moneda, v.fecha
  from public.eos_erp_ventas v
  where v.usuario_id = p_usuario_id
    and v.contacto_id = p_contacto_id
    and v.estado <> 'anulada'
    and public.eos_erp_saldo_documento_v107(v.id, null) > 0
  order by v.fecha;
$function$;

revoke all on function public.eos_erp_ventas_pendientes_v245(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.eos_erp_ventas_pendientes_v245(uuid, uuid)
  to service_role;

comment on function public.eos_erp_ventas_pendientes_v245(uuid, uuid) is
  'v245: ventas pendientes de un contacto (estado <> anulada, saldo > 0), de sólo lectura. No cobra nada.';
