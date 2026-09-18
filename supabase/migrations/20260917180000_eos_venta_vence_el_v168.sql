-- Una venta a crédito puede declarar cuándo vence.
--
-- ============================================================
-- POR QUÉ, Y POR QUÉ RECIÉN AHORA
-- ============================================================
--
-- `eos_erp_ventas.vence_el` existe desde la v107 (cuenta corriente), y
-- `lib/kpi/leer.ts` y `lib/erp/cartera.ts` ya lo leen correctamente —
-- `CARTERA_VENCIDA` y la pantalla de Cartera calculan "vencido" a partir de
-- esa columna, y correctamente NO tratan un documento sin fecha pactada como
-- atrasado ("null no es lo mismo que vencido").
--
-- Lo que faltaba, verificado leyendo cada camino de escritura, es que
-- NINGUNO escribe esa columna: ni `eos_erp_registrar_venta` (esta función),
-- ni el formulario de Ventas, ni el verbo de chat REGISTRAR_VENTA. La
-- columna existe, se lee bien, y siempre está en null. El aviso proactivo de
-- "cobros demorados" (`lib/erp/riesgos-negocio.ts`) por eso nunca pudo
-- usarla y sigue con un umbral fijo de 30 días desde la venta — que es lo
-- que se corrige en el mismo lote que esta migración, en el código de la
-- app, no acá.
--
-- ============================================================
-- LO QUE CAMBIA ACÁ
-- ============================================================
--
-- Se agrega `p_vence_el date default null` al final de la firma (no rompe
-- ningún llamador posicional existente: v153, v154, v156, v161 y v162 lo
-- siguen llamando con sus 8 argumentos de siempre y quedan sin vencimiento,
-- igual que hoy). Solo se guarda cuando la condición es crédito — al
-- contado nunca vence, sin importar qué se mande.
--
-- Se generó desde la definición que corre HOY en producción (confirmada con
-- `pg_get_functiondef` antes de escribir esto, porque esta función se
-- parcheó varias veces desde la v69 del archivo del repo y ya no coincidía
-- con él: tiene el chequeo de `service_role` y el de `eos_empresa_alcanza_v112`
-- que el archivo viejo no tenía). El resto del cuerpo es texto idéntico al
-- desplegado.
--
-- ============================================================
-- POR QUÉ HAY UN DROP ANTES DEL CREATE OR REPLACE
-- ============================================================
--
-- Verificado en una transacción de prueba (con datos descartables, revertida
-- después) antes de escribir esto: agregar un parámetro a una función de
-- PL/pgSQL con `create or replace` NO reemplaza la firma vieja de 8
-- argumentos — Postgres la trata como una función DISTINTA y deja las DOS
-- definidas a la vez. El resultado, probado de verdad: toda llamada
-- posicional de 8 argumentos que hoy hacen v153, v154, v156, v161 y v162
-- (y el ejecutor del worker) pasa a ser ambigua — "is not unique" — y
-- rompe cada REGISTRAR_VENTA, ANULAR_VENTA y CORREGIR_VENTA en producción
-- al instante. Por eso la firma vieja se borra explícitamente primero.

drop function if exists public.eos_erp_registrar_venta(uuid, jsonb, uuid, date, text, text, boolean, text);

create or replace function public.eos_erp_registrar_venta(
  p_usuario_id uuid,
  p_items jsonb,
  p_contacto_id uuid default null,
  p_fecha date default null,
  p_moneda text default 'PYG',
  p_condicion text default 'contado',
  p_cobrada boolean default false,
  p_notas text default null,
  p_vence_el date default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_venta_id uuid;
  v_item jsonb;
  v_producto public.eos_erp_productos%rowtype;
  v_descripcion text;
  v_cantidad numeric(16,3);
  v_saldo numeric(16,3);
  v_precio numeric(16,2);
  v_iva smallint;
  v_total numeric(16,2);
  v_iva_monto numeric(16,2);
  v_subtotal numeric(16,2) := 0;
  v_iva_total numeric(16,2) := 0;
  v_total_venta numeric(16,2) := 0;
  v_orden smallint := 0;
  v_movimiento_id uuid;
  v_fecha date := coalesce(p_fecha, public.eos_hoy_py());
  v_estado text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EOS_VENTA_SIN_ITEMS';
  end if;

  if jsonb_array_length(p_items) > 200 then
    raise exception 'EOS_VENTA_DEMASIADOS_ITEMS';
  end if;

  v_estado := case when p_cobrada then 'cobrada' else 'emitida' end;

  insert into public.eos_erp_ventas (
    usuario_id, contacto_id, fecha, moneda, condicion, estado, notas, vence_el
  ) values (
    p_usuario_id, p_contacto_id, v_fecha, coalesce(p_moneda, 'PYG'),
    case when p_condicion = 'credito' then 'credito' else 'contado' end,
    v_estado, p_notas,
    -- Al contado nunca vence, sin importar qué se haya mandado.
    case when p_condicion = 'credito' then p_vence_el else null end
  )
  returning id into v_venta_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto := null;

    if (v_item ->> 'producto_id') is not null then
      select * into v_producto
      from public.eos_erp_productos
      where id = (v_item ->> 'producto_id')::uuid
        and public.eos_empresa_alcanza_v112(p_usuario_id, usuario_id)
      for update;

      if not found then
        raise exception 'EOS_VENTA_PRODUCTO_AJENO';
      end if;
    end if;

    -- Lo que el ítem no diga, lo dice el producto. Una venta rápida desde el
    -- chat manda solo el id y la cantidad.
    v_descripcion := coalesce(
      nullif(btrim(coalesce(v_item ->> 'descripcion', '')), ''),
      v_producto.nombre,
      'Ítem'
    );
    v_cantidad := coalesce((v_item ->> 'cantidad')::numeric, 1);
    v_precio := coalesce((v_item ->> 'precio_unitario')::numeric, v_producto.precio_venta, 0);
    v_iva := coalesce((v_item ->> 'iva')::smallint, v_producto.iva, 10);

    if v_cantidad <= 0 then
      raise exception 'EOS_VENTA_CANTIDAD_INVALIDA';
    end if;

    if v_iva not in (0, 5, 10) then
      v_iva := 10;
    end if;

    -- El precio ya trae el IVA adentro, como se dicen los precios acá. El
    -- impuesto se SACA, no se suma: sumarlo factura un 10% de más. Ver
    -- `lib/erp/impuestos.ts`, que hace exactamente esta misma cuenta del lado
    -- del navegador para mostrar el total mientras se carga la venta.
    v_total := round(v_cantidad * v_precio);
    v_iva_monto := case
      when v_iva = 10 then round(v_total / 11)
      when v_iva = 5 then round(v_total / 21)
      else 0
    end;

    insert into public.eos_erp_venta_items (
      venta_id, producto_id, descripcion, cantidad, precio_unitario, iva, total, orden
    ) values (
      v_venta_id, v_producto.id, v_descripcion, v_cantidad, v_precio, v_iva, v_total, v_orden
    );

    v_subtotal := v_subtotal + (v_total - v_iva_monto);
    v_iva_total := v_iva_total + v_iva_monto;
    v_total_venta := v_total_venta + v_total;
    v_orden := v_orden + 1;

    -- El stock se descuenta solo para lo que lleva stock. Y se permite quedar
    -- en negativo a propósito: bloquear la venta porque el sistema dice que no
    -- hay stock, cuando el producto está ahí en el mostrador, es la forma más
    -- rápida de que alguien deje de usar el módulo. Queda registrado y visible.
    if v_producto.id is not null and v_producto.controla_stock then
      update public.eos_erp_productos
      set stock_actual = stock_actual - v_cantidad,
          actualizado_en = now()
      where id = v_producto.id
      returning stock_actual into v_saldo;

      insert into public.eos_erp_movimientos_stock (
        usuario_id, producto_id, tipo, cantidad, saldo_resultante,
        motivo, referencia_tipo, referencia_id, fecha
      ) values (
        p_usuario_id, v_producto.id, 'salida', v_cantidad, v_saldo,
        'Venta', 'venta', v_venta_id, v_fecha
      );
    end if;
  end loop;

  update public.eos_erp_ventas
  set subtotal = v_subtotal,
      iva_total = v_iva_total,
      total = v_total_venta,
      actualizado_en = now()
  where id = v_venta_id;

  -- ============================================================
  -- El puente con Finanzas
  -- ============================================================
  --
  -- Si la venta se cobró, la plata entró. Sin esto, el usuario ve sus ventas en
  -- una pantalla y su disponible real en otra, y el disponible real vuelve a
  -- estar mal — que es exactamente el problema que EOS existe para no causar.
  --
  -- A crédito NO se registra: la plata todavía no está, y anotarla como ingreso
  -- haría que el panel muestre plata que nadie puede gastar.
  if p_cobrada then
    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, metadata
    ) values (
      p_usuario_id, 'ingreso', v_total_venta, coalesce(p_moneda, 'PYG'),
      'Venta' || coalesce(' — ' || (
        select c.nombre from public.eos_crm_contactos c where c.id = p_contacto_id
      ), ''),
      'ventas', v_fecha, 'erp',
      jsonb_build_object('venta_id', v_venta_id)
    )
    returning id into v_movimiento_id;

    update public.eos_erp_ventas
    set movimiento_id = v_movimiento_id
    where id = v_venta_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'venta_id', v_venta_id,
    'subtotal', v_subtotal,
    'iva_total', v_iva_total,
    'total', v_total_venta,
    'estado', v_estado,
    'movimiento_id', v_movimiento_id
  );
end;
$function$;

-- El DROP se lleva los permisos con la función vieja. Se restauran
-- exactamente los que tenía (confirmado contra `information_schema.routine_privileges`
-- antes de escribir esto: `service_role` y `postgres`, nada más).
grant execute on function public.eos_erp_registrar_venta(
  uuid, jsonb, uuid, date, text, text, boolean, text, date
) to service_role, postgres;
