-- v225: cambiar cuándo vence una venta a crédito, sin rehacer la venta.
--
-- (La hora del archivo es anterior a la v223 y la v224 a propósito: esta viaja
-- en el mismo PR que la v221 y la v222, que se mergea primero, y `db push` no
-- aplica una migración más vieja que la última del remoto.)
--
-- ============================================================
-- QUÉ PASÓ (28/09/2026, cuenta real)
-- ============================================================
--
-- Un sobrepedido de ₲950.000 a crédito aparecía como vencido y la clienta
-- quería pasar el vencimiento al 5 de noviembre. Por la pantalla lo intentó
-- OCHO veces: las ocho fallaron con EOS_DOCUMENTO_CON_COBRANZAS. Por el chat,
-- EOS le dijo que no tenía una acción segura para eso y le armó un correo
-- para soporte.
--
-- Editar una venta la ANULA y registra otra (`eos_erp_editar_venta`). Con una
-- seña ya cobrada eso no se puede, y está bien que no se pueda: movería plata.
-- Pero cambiar la fecha de vencimiento no toca stock, plata ni cobros. No
-- tiene por qué pasar por ese camino.
--
-- ============================================================
-- QUÉ AGREGA
-- ============================================================
--
--   · eos_erp_cambiar_vencimiento_v225: cambia solo `vence_el` de una venta a
--     crédito, no anulada, de esa persona. Lo usa la pantalla cuando lo único
--     que cambió es la fecha.
--   · eos_erp_vencimiento_por_chat_v225: encuentra la venta (el mismo
--     resolver que anular y corregir, con 90 días porque un crédito puede ser
--     viejo), lee la fecha con el mismo lector que el registro de ventas
--     ("el 5", "en 15 días", "2026-11-05") y la cambia.
--   · En el ejecutor, CORREGIR_VENTA con vencimiento y sin cantidad ni precio
--     va por acá. Todo lo demás de CORREGIR_VENTA queda igual.
--
-- Cambiar la misma fecha dos veces deja lo mismo: no hace falta marca de
-- idempotencia.

create or replace function public.eos_erp_cambiar_vencimiento_v225(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_vence_el date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_venta public.eos_erp_ventas%rowtype;
  v_contacto text;
begin
  if p_vence_el is null then
    raise exception 'EOS_ACCION_VENCIMIENTO_INVALIDO';
  end if;

  select * into v_venta
  from public.eos_erp_ventas
  where id = p_venta_id and usuario_id = p_usuario_id
  for update;

  if v_venta.id is null then
    raise exception 'EOS_VENTA_NO_EXISTE';
  end if;

  if v_venta.estado = 'anulada' then
    raise exception 'EOS_VENTA_YA_ANULADA';
  end if;

  if v_venta.condicion is distinct from 'credito' then
    raise exception 'EOS_ACCION_VENTA_NO_ES_CREDITO';
  end if;

  update public.eos_erp_ventas
  set vence_el = p_vence_el,
      actualizado_en = now()
  where id = v_venta.id;

  select c.nombre into v_contacto from public.eos_crm_contactos c where c.id = v_venta.contacto_id;

  return jsonb_build_object(
    'ok', true,
    'venta_id', v_venta.id,
    'vence_antes', v_venta.vence_el,
    'vence_el', p_vence_el,
    'total', v_venta.total,
    'moneda', v_venta.moneda,
    'contacto', v_contacto
  );
end;
$function$;

revoke all on function public.eos_erp_cambiar_vencimiento_v225(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.eos_erp_cambiar_vencimiento_v225(uuid, uuid, date) to service_role;

comment on function public.eos_erp_cambiar_vencimiento_v225(uuid, uuid, date) is
  'v225: cambia solo el vencimiento de una venta a credito, sin anularla ni rehacerla (funciona con cobros registrados). Solo service_role.';

create or replace function public.eos_erp_vencimiento_por_chat_v225(
  p_usuario_id uuid,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ref text;
  v_detalle jsonb;
  v_venta_id uuid;
  v_fecha date;
begin
  v_ref := nullif(btrim(coalesce(p_datos ->> 'referencia', p_datos ->> 'venta', '')), '');
  v_detalle := public.eos_erp_resolver_venta(p_usuario_id, v_ref, 90);
  v_venta_id := nullif(v_detalle ->> 'venta_id', '')::uuid;

  if v_venta_id is null then
    raise exception 'EOS_ACCION_VENTA_NO_ENCONTRADA: %', coalesce(v_ref, 'la última');
  end if;

  v_fecha := public.eos_vencimiento_desde_datos_v182(p_datos, 'credito');

  if v_fecha is null then
    raise exception 'EOS_ACCION_VENCIMIENTO_INVALIDO';
  end if;

  return public.eos_erp_cambiar_vencimiento_v225(p_usuario_id, v_venta_id, v_fecha)
    || jsonb_build_object('candidatos', v_detalle -> 'candidatos', 'capa', v_detalle -> 'capa');
end;
$function$;

revoke all on function public.eos_erp_vencimiento_por_chat_v225(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_erp_vencimiento_por_chat_v225(uuid, jsonb) to service_role;

comment on function public.eos_erp_vencimiento_por_chat_v225(uuid, jsonb) is
  'v225: CORREGIR_VENTA con solo un vencimiento (vence_el / vence_dia / vence_en_dias). Resuelve la venta (90 dias) y cambia la fecha. Solo service_role.';

-- En el ejecutor: CORREGIR_VENTA con vencimiento y sin cantidad ni precio va
-- por la función nueva. En su lugar, desde `pg_get_functiondef`; el llamado a
-- la corrección de siempre tiene que aparecer una sola vez. Idempotente.
do $v225$
declare
  v_oid oid;
  v_def text;
  v_nuevo text;
begin
  select p.oid into v_oid
  from pg_proc p
  where p.proname = 'eos_execute_internal_effect_v64'
    and p.pronamespace = 'public'::regnamespace;

  v_def := pg_get_functiondef(v_oid);

  if position('eos_erp_vencimiento_por_chat_v225' in v_def) > 0 then
    raise notice 'v225: el ejecutor ya cambia vencimientos; no se toca.';
    return;
  end if;

  if (length(v_def) - length(replace(v_def, 'public.eos_erp_corregir_venta_por_chat_v162(', '')))
     / length('public.eos_erp_corregir_venta_por_chat_v162(') <> 1 then
    raise exception 'v225: el llamado a eos_erp_corregir_venta_por_chat_v162 no aparece una sola vez. No se cambió nada.';
  end if;

  v_nuevo := regexp_replace(
    v_def,
    'v_rpc := public\.eos_erp_corregir_venta_por_chat_v162\([^;]*?\);',
    $n$-- v225: cambiar solo cuándo vence no rehace la venta.
    if (v_data ? 'vence_el' or v_data ? 'vence_dia' or v_data ? 'vence_en_dias')
       and nullif(btrim(coalesce(v_data ->> 'cantidad', '')), '') is null
       and nullif(btrim(coalesce(v_data ->> 'precio_unitario', '')), '') is null then
      v_rpc := public.eos_erp_vencimiento_por_chat_v225(v_command.usuario_id, v_data);
    else
      \&
    end if;$n$
  );

  if v_nuevo = v_def then
    raise exception 'v225: no encontré el llamado a la corrección; no se cambió nada.';
  end if;

  execute v_nuevo;
end;
$v225$;
