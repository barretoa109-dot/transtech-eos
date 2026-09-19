-- v178: corregir una venta ya no borra su vencimiento, y se puede cambiar.
--
-- ============================================================
-- EL DEFECTO
-- ============================================================
--
-- `eos_erp_editar_venta` (v116) anula la venta vieja y registra una nueva con
-- los datos corregidos. Cuando la v168 le dio a la venta un `vence_el`, esta
-- función siguió llamando a `eos_erp_registrar_venta` con los ocho argumentos
-- de antes, sin el noveno. Consecuencia: toda venta a crédito con vencimiento
-- que se corregía —por la pantalla o por el chat (CORREGIR_VENTA)— volvía a
-- nacer SIN fecha de vencimiento, y el aviso de cobro demorado caía de nuevo en
-- el plazo de respaldo de 30 días. Corregir una cantidad borraba un plazo que
-- alguien había pactado.
--
-- ============================================================
-- LA REGLA
-- ============================================================
--
--   · `p_vence_el` nuevo   → se usa ese.
--   · `p_vence_el` nulo    → se CONSERVA el de la venta original.
--
-- Esto arregla de un tirón a los tres que llaman: la pantalla, el chat
-- (`eos_erp_corregir_venta_por_chat_v162` pasa diez argumentos y sigue
-- funcionando, porque el nuevo es opcional) y cualquier otro.
--
-- Costo de la regla: con esto no se puede QUITAR un vencimiento al corregir.
-- Es a propósito: es más común corregir una cantidad que borrar un plazo, y
-- perder el plazo sin querer es el error que se acaba de encontrar. Si hace
-- falta quitarlo, se anula y se vuelve a cargar la venta.
--
-- Al contado el vencimiento no tiene sentido y `eos_erp_registrar_venta` ya lo
-- ignora, así que acá no hace falta filtrarlo.
--
-- Nota de mantenimiento: es un parámetro NUEVO, así que `create or replace`
-- dejaría las dos versiones conviviendo y una llamada con diez argumentos sería
-- ambigua. Por eso se borra la firma vieja primero y se vuelven a dar los
-- permisos (un `drop` los pierde).

drop function if exists public.eos_erp_editar_venta(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text);

create or replace function public.eos_erp_editar_venta(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_items jsonb,
  p_contacto_id uuid default null,
  p_fecha date default null,
  p_moneda text default 'PYG',
  p_condicion text default 'contado',
  p_cobrada boolean default false,
  p_notas text default null,
  p_motivo text default null,
  p_vence_el date default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_estado_actual text;
  v_vence_original date;
  v_registro jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select estado, vence_el into v_estado_actual, v_vence_original
  from public.eos_erp_ventas
  where id = p_venta_id and usuario_id = p_usuario_id;

  if not found then
    raise exception 'EOS_VENTA_NO_EXISTE';
  end if;

  if v_estado_actual = 'anulada' then
    raise exception 'EOS_VENTA_YA_ANULADA';
  end if;

  -- Devuelve stock, borra el ingreso vinculado y rechaza sola si hay una
  -- factura activa. Nada de esto se repite acá a propósito: ver el porqué
  -- arriba.
  perform public.eos_erp_anular_venta(
    p_usuario_id, p_venta_id, coalesce(nullif(btrim(p_motivo), ''), 'Editada')
  );

  v_registro := public.eos_erp_registrar_venta(
    p_usuario_id, p_items, p_contacto_id, p_fecha, p_moneda, p_condicion, p_cobrada, p_notas,
    -- Nuevo si lo hay; si no, el que ya tenía: corregir un número no puede
    -- borrar un plazo pactado.
    coalesce(p_vence_el, v_vence_original)
  );

  return jsonb_build_object(
    'ok', true,
    'venta_anterior_id', p_venta_id,
    'venta_id', v_registro ->> 'venta_id',
    'subtotal', v_registro -> 'subtotal',
    'iva_total', v_registro -> 'iva_total',
    'total', v_registro -> 'total',
    'estado', v_registro -> 'estado'
  );
end;
$function$;

revoke all on function public.eos_erp_editar_venta(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text, date)
  from public, anon, authenticated;
grant execute on function public.eos_erp_editar_venta(uuid, uuid, jsonb, uuid, date, text, text, boolean, text, text, date)
  to service_role, postgres;
