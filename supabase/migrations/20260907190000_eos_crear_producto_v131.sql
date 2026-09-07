-- El verbo que faltaba: cargar productos por chat.
--
-- ============================================================
-- LO QUE PASÓ, CON NOMBRE Y HORA
-- ============================================================
--
-- El 7 de septiembre de 2026 a las 17:06, una usuaria le escribió a EOS:
--
--   "Podes ahora agregar en productos
--    El azul vendo a 168.000gs
--    Conjunto amarillo 165.000gs
--    Conjunto cosmina 165.000gs
--    Top negro sobrepedido 85.000gs"
--
-- EOS contestó "Entendido. Voy a guardar estos productos con sus precios de
-- venta…" y **guardó una memoria**. Ningún producto entró al catálogo.
--
-- No fue el modelo, ni la puerta de autonomía, ni falta de datos: la acción
-- no existía. Las tres del negocio eran REGISTRAR_VENTA, AJUSTAR_STOCK y
-- CREAR_CONTACTO. Pedir "agregá estos productos" no tenía a dónde ir, y el
-- modelo hizo lo más parecido que sí podía —GUARDAR_MEMORIA—, que además
-- funciona, así que la respuesta sonó a que había quedado hecho.
--
-- Es la peor forma de fallar: la acción que sí existe tapa a la que falta.
--
-- Y no es un caso de borde. Sin productos en el catálogo, REGISTRAR_VENTA
-- tampoco puede resolver nada: el verbo que faltaba bloqueaba al que ya
-- estaba.
--
-- ============================================================
-- ACEPTA UNA LISTA, NO UN PRODUCTO
-- ============================================================
--
-- La usuaria nombró CUATRO en un solo mensaje, que es como habla cualquiera
-- que está cargando su catálogo. Si la acción tomara uno solo, el modelo
-- tendría que emitir cuatro acciones para un pedido, gastar cuatro veces el
-- presupuesto diario de riesgo, y el usuario recibiría cuatro confirmaciones
-- para una sola frase.
--
-- Igual que `REGISTRAR_VENTA` con sus `items`: una acción, una lista.
--
-- ============================================================
-- CREAR NO ES EDITAR
-- ============================================================
--
-- Si el nombre ya existe en el catálogo, no se toca nada y se informa. Es
-- deliberado: "agregá el azul a 168.000" sobre un producto que ya está a
-- 150.000 sería un cambio de precio silencioso, y el precio de un producto es
-- de donde sale el margen de todo lo que se venda después.
--
-- Cambiar un precio es otro verbo y va a tener su propia confirmación.
--
-- ============================================================
-- SIN PRECIO NO SE CREA
-- ============================================================
--
-- Un producto sin precio es una trampa puesta a futuro: el día que alguien
-- diga "vendí dos" se registra una venta de cero guaraníes, que ensucia el
-- margen, el panel financiero y el informe del mes de una forma que nadie
-- relaciona con este momento.
--
-- Si el modelo no tiene el precio, tiene que preguntarlo. Para eso está
-- `EOS_ACCION_PRODUCTO_SIN_PRECIO`, que la aplicación traduce a "decime a
-- cuánto lo vendés".

-- ============================================================
-- 1) El catálogo de acciones permitidas
-- ============================================================

alter table public.eos_action_commands
  drop constraint if exists eos_action_commands_accion_check;

alter table public.eos_action_commands
  add constraint eos_action_commands_accion_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO', 'CREAR_PRODUCTO'
  ]));

alter table public.eos_autonomy_rules_v12
  drop constraint if exists eos_autonomy_rules_action_check;

alter table public.eos_autonomy_rules_v12
  add constraint eos_autonomy_rules_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO', 'CREAR_PRODUCTO'
  ]));

alter table public.eos_worker_gate_audit_v15
  drop constraint if exists eos_worker_gate_audit_action_check;

alter table public.eos_worker_gate_audit_v15
  add constraint eos_worker_gate_audit_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO', 'CREAR_PRODUCTO'
  ]));

-- ============================================================
-- 2) De qué comando salió cada producto
-- ============================================================
--
-- Sin esto no hay idempotencia: el ejecutor se reintenta —para eso tiene
-- `max_attempts`— y el mismo catálogo entraría dos veces. Mismo patrón que
-- ventas, movimientos de stock y contactos.

alter table public.eos_erp_productos
  add column if not exists action_command_id uuid
    references public.eos_action_commands (id) on delete set null;

-- Índice y no restricción única: un solo comando crea VARIOS productos, así
-- que el id se repite a propósito entre las filas de una misma tanda.
create index if not exists eos_erp_productos_action_command_idx
  on public.eos_erp_productos (action_command_id)
  where action_command_id is not null;

-- ============================================================
-- 3) Crear la tanda
-- ============================================================
--
-- Devuelve el id del PRIMER producto de la tanda —el ejecutor tiene que
-- devolver un `effect_id` y ese es el contrato— y la lista completa en el
-- resultado, para que el chat pueda decir cuántos entraron y cuáles ya
-- estaban.

create or replace function public.eos_erp_crear_productos_v131(
  p_usuario_id uuid,
  p_command_id uuid,
  p_productos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item jsonb;
  v_nombre text;
  v_precio numeric;
  v_costo numeric;
  v_stock numeric;
  v_iva integer;
  v_moneda text;
  v_existente uuid;
  v_id uuid;
  v_primero uuid;
  v_creados jsonb := '[]'::jsonb;
  v_repetidos jsonb := '[]'::jsonb;
  v_cuantos integer := 0;
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  if jsonb_typeof(p_productos) <> 'array' or jsonb_array_length(p_productos) = 0 then
    raise exception 'EOS_ACCION_PRODUCTO_SIN_DATOS';
  end if;

  for v_item in select * from jsonb_array_elements(p_productos)
  loop
    v_cuantos := v_cuantos + 1;

    -- Un tope por tanda: diez es un catálogo dictado de corrido, cien es un
    -- modelo en un bucle. Lo grande se importa por planilla, que además
    -- muestra la vista previa antes de escribir.
    if v_cuantos > 10 then
      raise exception 'EOS_ACCION_PRODUCTO_DEMASIADOS';
    end if;

    v_nombre := nullif(btrim(coalesce(v_item ->> 'nombre', v_item ->> 'producto', '')), '');

    if v_nombre is null then
      raise exception 'EOS_ACCION_PRODUCTO_SIN_NOMBRE';
    end if;

    v_precio := nullif(regexp_replace(coalesce(v_item ->> 'precio_venta', v_item ->> 'precio', ''), '[^0-9.\-]', '', 'g'), '')::numeric;

    if v_precio is null or v_precio <= 0 then
      raise exception 'EOS_ACCION_PRODUCTO_SIN_PRECIO: %', v_nombre;
    end if;

    -- Ya existe: no se toca. Crear no es editar; ver la cabecera.
    v_existente := public.eos_erp_resolver_producto(p_usuario_id, v_nombre);

    if v_existente is not null then
      v_repetidos := v_repetidos || to_jsonb(v_nombre);
      if v_primero is null then v_primero := v_existente; end if;
      continue;
    end if;

    v_costo := nullif(regexp_replace(coalesce(v_item ->> 'costo', ''), '[^0-9.\-]', '', 'g'), '')::numeric;
    v_stock := coalesce(nullif(regexp_replace(coalesce(v_item ->> 'stock', v_item ->> 'stock_actual', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0);

    -- El IVA de Paraguay: 10 salvo que digan otra cosa. `0` es exenta, y hay
    -- que poder decirlo: la usuaria tenía un producto exento en su catálogo.
    v_iva := coalesce(nullif(regexp_replace(coalesce(v_item ->> 'iva', ''), '[^0-9]', '', 'g'), '')::integer, 10);
    if v_iva not in (0, 5, 10) then v_iva := 10; end if;

    v_moneda := upper(nullif(btrim(coalesce(v_item ->> 'moneda', '')), ''));
    if v_moneda is null or length(v_moneda) <> 3 then v_moneda := 'PYG'; end if;

    insert into public.eos_erp_productos (
      usuario_id, nombre, precio_venta, costo, moneda, iva,
      controla_stock, stock_actual, stock_minimo, activo, action_command_id
    ) values (
      p_usuario_id,
      left(v_nombre, 160),
      v_precio,
      v_costo,
      v_moneda,
      v_iva,
      true,
      v_stock,
      0,
      true,
      p_command_id
    )
    returning id into v_id;

    if v_primero is null then v_primero := v_id; end if;
    v_creados := v_creados || jsonb_build_object('id', v_id, 'nombre', v_nombre, 'precio_venta', v_precio);
  end loop;

  if v_primero is null then
    raise exception 'EOS_ACCION_PRODUCTO_SIN_DATOS';
  end if;

  return jsonb_build_object(
    'primero', v_primero,
    'creados', v_creados,
    'ya_existian', v_repetidos
  );
end;
$function$;

revoke all on function public.eos_erp_crear_productos_v131(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_erp_crear_productos_v131(uuid, uuid, jsonb) to service_role;

comment on function public.eos_erp_crear_productos_v131(uuid, uuid, jsonb) is
  'v131: crea una tanda de productos desde el chat. No pisa lo que ya existe y exige precio. Ver la cabecera de la migración.';
