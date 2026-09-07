-- La compra decía que sumó stock a un producto que no lleva stock.
--
-- Encontrado a los diez minutos de salir la v134, probándola: se registró
-- "compré 20 chipas a 2.600" sobre un producto que sí está en el catálogo, y
-- la confirmación dijo:
--
--   "A «chipas» le sumé el stock y le actualicé el costo."
--
-- El costo sí. El stock no: ese producto tiene `controla_stock = false`, y
-- `eos_erp_registrar_compra` —correctamente— solo mueve el saldo de los que lo
-- llevan. La afirmación era falsa, y de la peor clase: la que hace que alguien
-- deje de contar sus existencias porque cree que el sistema las está contando.
--
-- La causa es que la v134 devolvía `en_catalogo`, que responde a otra
-- pregunta. Que un producto exista y que lleve inventario son dos cosas
-- distintas, y la frase necesitaba la segunda.
--
-- Ahora el detalle trae las dos: `en_catalogo` para saber si quedó como
-- concepto suelto, y `mueve_stock` para poder decir la verdad sobre el
-- inventario. Es el mismo arreglo que la v132, con otro nombre: que la
-- confirmación se arme con lo que pasó y no con lo que se supone que pasa.

create or replace function public.eos_erp_registrar_compra_chat_v134(
  p_usuario_id uuid,
  p_command_id uuid,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item jsonb;
  v_lista jsonb;
  v_items jsonb := '[]'::jsonb;
  v_concepto text;
  v_cantidad numeric;
  v_unitario numeric;
  v_total numeric;
  v_iva integer;
  v_producto uuid;
  v_lleva_stock boolean;
  v_contacto uuid;
  v_proveedor text;
  v_detalle jsonb := '[]'::jsonb;
  v_sin_catalogo jsonb := '[]'::jsonb;
  v_cuantos integer := 0;
  v_rpc jsonb;
  v_compra_id uuid;
  v_condicion text;
  v_fecha date;
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  v_lista := case
    when jsonb_typeof(p_datos -> 'items') = 'array' then p_datos -> 'items'
    when jsonb_typeof(p_datos -> 'conceptos') = 'array' then p_datos -> 'conceptos'
    when jsonb_typeof(p_datos -> 'gastos') = 'array' then p_datos -> 'gastos'
    else null
  end;

  if v_lista is null or jsonb_array_length(v_lista) = 0 then
    raise exception 'EOS_ACCION_COMPRA_SIN_ITEMS';
  end if;

  for v_item in select * from jsonb_array_elements(v_lista)
  loop
    v_cuantos := v_cuantos + 1;

    if v_cuantos > 20 then
      raise exception 'EOS_ACCION_COMPRA_DEMASIADOS';
    end if;

    v_concepto := nullif(btrim(coalesce(
      v_item ->> 'concepto',
      v_item ->> 'descripcion',
      v_item ->> 'producto',
      v_item ->> 'nombre',
      ''
    )), '');

    if v_concepto is null then
      raise exception 'EOS_ACCION_COMPRA_SIN_CONCEPTO';
    end if;

    v_cantidad := nullif(regexp_replace(coalesce(v_item ->> 'cantidad', ''), '[^0-9.]', '', 'g'), '')::numeric;
    if v_cantidad is null or v_cantidad <= 0 then v_cantidad := 1; end if;

    v_unitario := nullif(regexp_replace(coalesce(
      v_item ->> 'precio_unitario', v_item ->> 'costo_unitario', v_item ->> 'costo', ''
    ), '[^0-9.]', '', 'g'), '')::numeric;

    v_total := nullif(regexp_replace(coalesce(
      v_item ->> 'total', v_item ->> 'monto', v_item ->> 'monto_total', ''
    ), '[^0-9.]', '', 'g'), '')::numeric;

    if v_unitario is null and v_total is not null then
      v_unitario := v_total / v_cantidad;
    end if;

    if v_unitario is null or v_unitario <= 0 then
      raise exception 'EOS_ACCION_COMPRA_SIN_MONTO: %', v_concepto;
    end if;

    v_iva := nullif(regexp_replace(coalesce(v_item ->> 'iva', ''), '[^0-9]', '', 'g'), '')::integer;
    if v_iva is null or v_iva not in (0, 5, 10) then v_iva := 10; end if;

    v_producto := public.eos_erp_resolver_producto(p_usuario_id, v_concepto);
    v_lleva_stock := false;

    if v_producto is null then
      v_sin_catalogo := v_sin_catalogo || to_jsonb(v_concepto);
    else
      -- Existir en el catálogo y llevar inventario son dos cosas distintas, y
      -- la confirmación necesita la segunda. Ver la cabecera.
      select p.controla_stock into v_lleva_stock
      from public.eos_erp_productos p
      where p.id = v_producto;

      v_lleva_stock := coalesce(v_lleva_stock, false);
    end if;

    v_items := v_items || jsonb_build_object(
      'producto_id', v_producto,
      'descripcion', left(v_concepto, 200),
      'cantidad', v_cantidad,
      'precio_unitario', v_unitario,
      'iva', v_iva
    );

    v_detalle := v_detalle || jsonb_build_object(
      'concepto', v_concepto,
      'cantidad', v_cantidad,
      'total', round(v_cantidad * v_unitario),
      'en_catalogo', v_producto is not null,
      'mueve_stock', v_lleva_stock
    );
  end loop;

  v_proveedor := nullif(btrim(coalesce(p_datos ->> 'proveedor', p_datos ->> 'contacto', '')), '');
  if v_proveedor is not null then
    v_contacto := public.eos_crm_resolver_contacto(p_usuario_id, v_proveedor);
  end if;

  v_condicion := case when lower(coalesce(p_datos ->> 'condicion', '')) = 'credito' then 'credito' else 'contado' end;

  v_fecha := case
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'fecha')::date
    else null
  end;

  v_rpc := public.eos_erp_registrar_compra(
    p_usuario_id,
    v_items,
    v_contacto,
    v_fecha,
    'PYG',
    v_condicion,
    v_condicion = 'contado',
    null,
    nullif(btrim(coalesce(p_datos ->> 'notas', '')), '')
  );

  v_compra_id := coalesce(
    (v_rpc ->> 'compra_id')::uuid,
    (v_rpc ->> 'id')::uuid,
    (v_rpc -> 'compra' ->> 'id')::uuid
  );

  if v_compra_id is null then
    raise exception 'EOS_ACCION_COMPRA_SIN_ID';
  end if;

  update public.eos_erp_compras
  set action_command_id = p_command_id
  where id = v_compra_id and usuario_id = p_usuario_id;

  return jsonb_build_object(
    'primero', v_compra_id,
    'compra', v_detalle,
    'total_compra', (v_rpc ->> 'total')::numeric,
    'sin_catalogo', v_sin_catalogo,
    'proveedor', case when v_proveedor is null then null else jsonb_build_object(
      'nombre', v_proveedor,
      'agendado', v_contacto is not null
    ) end
  );
end;
$function$;

comment on function public.eos_erp_registrar_compra_chat_v134(uuid, uuid, jsonb) is
  'v135: registra una compra dictada por chat. Devuelve por ítem si movió stock de verdad, no solo si el producto existe.';
