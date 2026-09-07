-- El segundo verbo que faltaba: poner el costo y corregir el precio.
--
-- ============================================================
-- LO QUE PASÓ, CON NOMBRE Y HORA
-- ============================================================
--
-- El 7 de septiembre de 2026, entre las 17:04 y las 17:08, una usuaria estuvo
-- calculando con EOS el costo real de cuatro prendas. Le pasó el precio de
-- cada una y el envío de cada una, y le pidió sumarlos:
--
--   "Envío del azul 39.976 / Envío cosmina 47.486,6 / Envío top negro
--    13.325,3 / Conjunto amarillo 44.942,7
--    Ahora suma el precio de la prenda + el envío"
--
-- EOS sumó bien, los cuatro. Después ella pidió "Quiero también el margen que
-- me dejan", y EOS calculó los cuatro márgenes, bien también.
--
-- Y después guardó todo en una MEMORIA:
--
--   "Márgenes de productos: Conjunto azul: precio venta 168.000, costo total
--    122.414,5, ganancia 45.585,5, margen sobre venta 27,13%…"
--
-- Un párrafo de texto. La columna `costo` de esos cuatro productos siguió en
-- NULL, el panel de rentabilidad siguió sin poder calcular nada, y el margen
-- que ella acababa de ver quedó como una frase en una conversación en vez de
-- como un número del sistema.
--
-- Es exactamente el reporte que llegó: "le pide a EOS que registre sus
-- operaciones y este nunca lo hace, no lo anota ni lo registra en el ERP".
-- No faltaban datos —ella dio precio, envío, costo y margen de cuatro
-- productos, uno por uno— faltaba el verbo. Con `CREAR_PRODUCTO` (v131) EOS
-- ya podía dar de alta lo que no existía; sobre lo que YA existe no tenía
-- ninguna acción, y volvía a caer en `GUARDAR_MEMORIA`, que es la acción que
-- siempre funciona y por eso siempre tapa a la que falta.
--
-- ============================================================
-- LO QUE ESTA ACCIÓN NO TOCA, Y POR QUÉ
-- ============================================================
--
-- **El stock, nunca.** Para eso está `AJUSTAR_STOCK`, que además de mover el
-- saldo deja el movimiento asentado. Si esta acción escribiera `stock_actual`
-- directamente, el inventario cambiaría sin que quede registrado de dónde
-- salió la diferencia: el mismo agujero que un ajuste manual en la base.
--
-- **La moneda, nunca.** Cambiarle la moneda a un producto que ya tiene ventas
-- reinterpreta todo lo vendido antes: los mismos números pasan a significar
-- otra cosa, hacia atrás y en silencio.
--
-- Quedan `precio_venta`, `costo` e `iva`. Los tres cambian el futuro y ninguno
-- reescribe el pasado.
--
-- ============================================================
-- SI NO ENCUENTRA UNO, HACE LOS OTROS
-- ============================================================
--
-- Cuatro productos en un mensaje y un nombre mal escrito no puede tirar abajo
-- los otros tres: los que se resuelven se actualizan, y los que no vuelven por
-- nombre en `no_encontrados` para que la respuesta los pregunte. Falla entera
-- solamente cuando no se resolvió ninguno.

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
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO'
  ]));

alter table public.eos_autonomy_rules_v12
  drop constraint if exists eos_autonomy_rules_action_check;

alter table public.eos_autonomy_rules_v12
  add constraint eos_autonomy_rules_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO'
  ]));

alter table public.eos_worker_gate_audit_v15
  drop constraint if exists eos_worker_gate_audit_action_check;

alter table public.eos_worker_gate_audit_v15
  add constraint eos_worker_gate_audit_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO'
  ]));

-- ============================================================
-- 2) Actualizar la tanda
-- ============================================================
--
-- Devuelve, además del `primero` que el ejecutor necesita como `effect_id`,
-- el ANTES y el DESPUÉS de cada campo que cambió. Sin el antes, la
-- confirmación no puede decir "de 165.000 a 200.000" y queda en "listo", que
-- es la clase de respuesta con la que nadie se entera de lo que pasó.

create or replace function public.eos_erp_actualizar_productos_v133(
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
  v_iva integer;
  v_id uuid;
  v_primero uuid;
  v_antes public.eos_erp_productos%rowtype;
  v_cambios jsonb;
  v_actualizados jsonb := '[]'::jsonb;
  v_no_encontrados jsonb := '[]'::jsonb;
  v_sin_cambios jsonb := '[]'::jsonb;
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

    -- Mismo tope que al crear, por la misma razón: diez es un catálogo
    -- dictado de corrido, cien es un modelo en un bucle.
    if v_cuantos > 10 then
      raise exception 'EOS_ACCION_PRODUCTO_DEMASIADOS';
    end if;

    v_nombre := nullif(btrim(coalesce(v_item ->> 'nombre', v_item ->> 'producto', '')), '');

    if v_nombre is null then
      raise exception 'EOS_ACCION_PRODUCTO_SIN_NOMBRE';
    end if;

    v_id := public.eos_erp_resolver_producto(p_usuario_id, v_nombre);

    -- No está, o hay dos que se llaman parecido. No se crea: crear es el otro
    -- verbo, y adivinar acá convertiría un error de tipeo en un producto
    -- nuevo con nombre equivocado.
    if v_id is null then
      v_no_encontrados := v_no_encontrados || to_jsonb(v_nombre);
      continue;
    end if;

    select * into v_antes
    from public.eos_erp_productos
    where id = v_id and usuario_id = p_usuario_id;

    if v_antes.id is null then
      v_no_encontrados := v_no_encontrados || to_jsonb(v_nombre);
      continue;
    end if;

    v_precio := nullif(regexp_replace(coalesce(v_item ->> 'precio_venta', v_item ->> 'precio', ''), '[^0-9.]', '', 'g'), '')::numeric;
    v_costo := nullif(regexp_replace(coalesce(v_item ->> 'costo', v_item ->> 'costo_total', ''), '[^0-9.]', '', 'g'), '')::numeric;
    v_iva := nullif(regexp_replace(coalesce(v_item ->> 'iva', ''), '[^0-9]', '', 'g'), '')::integer;

    if v_precio is not null and v_precio <= 0 then
      raise exception 'EOS_ACCION_PRODUCTO_SIN_PRECIO: %', v_nombre;
    end if;

    if v_iva is not null and v_iva not in (0, 5, 10) then
      v_iva := null;
    end if;

    v_cambios := '{}'::jsonb;

    if v_precio is not null and v_precio is distinct from v_antes.precio_venta then
      v_cambios := v_cambios || jsonb_build_object(
        'precio_venta', jsonb_build_object('antes', v_antes.precio_venta, 'despues', v_precio));
    end if;

    if v_costo is not null and v_costo is distinct from v_antes.costo then
      v_cambios := v_cambios || jsonb_build_object(
        'costo', jsonb_build_object('antes', v_antes.costo, 'despues', v_costo));
    end if;

    if v_iva is not null and v_iva is distinct from v_antes.iva then
      v_cambios := v_cambios || jsonb_build_object(
        'iva', jsonb_build_object('antes', v_antes.iva, 'despues', v_iva));
    end if;

    -- Nada que cambiar no es un error: puede ser que ya estuviera así. Se
    -- informa aparte para que la respuesta no diga que lo cambió.
    if v_cambios = '{}'::jsonb then
      v_sin_cambios := v_sin_cambios || to_jsonb(v_antes.nombre);
      if v_primero is null then v_primero := v_id; end if;
      continue;
    end if;

    update public.eos_erp_productos
    set precio_venta = coalesce(v_precio, precio_venta),
        costo = coalesce(v_costo, costo),
        iva = coalesce(v_iva, iva),
        actualizado_en = now()
    where id = v_id and usuario_id = p_usuario_id;

    if v_primero is null then v_primero := v_id; end if;

    v_actualizados := v_actualizados || jsonb_build_object(
      'id', v_id,
      'nombre', v_antes.nombre,
      'cambios', v_cambios
    );
  end loop;

  -- Ninguno se pudo resolver: eso sí es un error, y el mensaje lleva los
  -- nombres para que la respuesta pueda preguntar por ellos.
  if v_primero is null then
    if jsonb_array_length(v_no_encontrados) > 0 then
      raise exception 'EOS_ACCION_PRODUCTO_NO_RESUELTO: %',
        (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(v_no_encontrados) x);
    end if;
    raise exception 'EOS_ACCION_PRODUCTO_SIN_DATOS';
  end if;

  return jsonb_build_object(
    'primero', v_primero,
    'actualizados', v_actualizados,
    'no_encontrados', v_no_encontrados,
    'sin_cambios', v_sin_cambios
  );
end;
$function$;

revoke all on function public.eos_erp_actualizar_productos_v133(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_erp_actualizar_productos_v133(uuid, uuid, jsonb) to service_role;

comment on function public.eos_erp_actualizar_productos_v133(uuid, uuid, jsonb) is
  'v133: pone costo y corrige precio/IVA de productos que ya existen. No toca stock ni moneda. Ver la cabecera de la migración.';
