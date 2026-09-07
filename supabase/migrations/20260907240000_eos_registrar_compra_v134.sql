-- El tercer verbo que faltaba: la plata que SALE.
--
-- ============================================================
-- LO QUE PASÓ, CON NOMBRE Y HORA
-- ============================================================
--
-- El 7 de septiembre de 2026 el dueño del producto le escribió a EOS:
--
--   "EOS me metí al negocio de la porcicultura de compra, engorde y venta de
--    chanchos, te mandaré todos mis números y necesito que le hagas
--    seguimientos y me ayudes a potenciarlo, guardalo también todo en mi área
--    de negocios.
--    Combustible ida y vuelta: 600.000gs
--    Compra de lechones con 2 meses de nacidos: 5 lechones 1.500.000gs y un
--    lechón por 250.000gs. Total 1.750.000gs
--    Balanceado alimento: 68.000gs la bolsa de 25 kilos, compré 3
--    Vitamina: 64.000gs por 100ml
--    Antiparasitario: 20.000gs
--    Salario del capataz: 750.000 cada 15 días"
--
-- EOS entendió TODO. Sumó bien: "inversión inicial ₲ 3.388.000 incluyendo
-- primera quincena del capataz. Costo de compra promedio por lechón:
-- ₲ 291.667". Y después: "Guardé esa información en la memoria empresarial."
--
-- Cuando le preguntó "¿lo guardaste en el ERP y CRM?", contestó la verdad:
--
--   "Lo guardé como memoria empresarial para seguimiento, no como registros
--    operativos del ERP/CRM."
--
-- Y cuando le insistió "cargalo todo y que me aparezca en el área de
-- negocios", dijo exactamente qué le faltaba:
--
--   "los gastos como combustible, alimento, vitaminas, antiparasitario y
--    capataz los tengo para seguimiento, pero NO HAY UNA ACCIÓN OPERATIVA DE
--    GASTOS DISPONIBLE EN ESTE PANEL."
--
-- Negocio siguió mostrando 0 ventas, 0 productos, 0 contactos.
--
-- Tercera vez en el mismo día que el diagnóstico es el mismo: el verbo no
-- existía. Las acciones del negocio cubrían la plata que ENTRA
-- (REGISTRAR_VENTA), el inventario (AJUSTAR_STOCK), la agenda
-- (CREAR_CONTACTO) y el catálogo (CREAR_PRODUCTO, ACTUALIZAR_PRODUCTO).
-- **Ninguna cubría la plata que SALE**, que en un negocio que arranca es
-- literalmente todo lo que pasa: se compra durante meses antes de vender por
-- primera vez.
--
-- ============================================================
-- UNA COMPRA NO NECESITA CATÁLOGO
-- ============================================================
--
-- Es la diferencia con la venta, y es la que hace que esto sirva el primer
-- día. `REGISTRAR_VENTA` exige resolver el producto porque descuenta stock y
-- cobra un precio; una compra puede ser combustible, que no es un producto de
-- nadie y nunca va a estarlo.
--
-- La pantalla de Compras ya dice esto mismo con todas las letras: "Podés
-- registrar una compra aunque todavía no tengas catálogo". Esta acción hace
-- que el chat se comporte igual que la pantalla:
--
--   · si el concepto coincide con un producto del catálogo, va con su
--     `producto_id` y entonces suma stock y actualiza el costo;
--   · si no coincide, va como texto libre y queda igual en la compra, en el
--     total y en el movimiento financiero.
--
-- Lo que NO hace es crear el producto. Crear un producto sin precio de venta
-- es la trampa que documenta la v131: la primera venta se registraría en cero.
-- Si algo se compró y merece estar en el catálogo, se pide con el otro verbo.
--
-- ============================================================
-- EL TOTAL, NO EL UNITARIO
-- ============================================================
--
-- Nadie dicta precios unitarios. Se dice "5 lechones 1.500.000" y "compré 3
-- bolsas de 68.000". La primera frase da el total, la segunda el unitario, y
-- las dos son la forma normal de hablar.
--
-- Por eso se acepta `total` además de `precio_unitario`, y cuando viene el
-- total se divide por la cantidad. Si el modelo tuviera que hacer esa división
-- él, la haría a veces bien y a veces no, y el error entraría como un costo
-- unitario plausible que nadie revisa.
--
-- ============================================================
-- EL PROVEEDOR NO PUEDE TIRAR ABAJO LA COMPRA
-- ============================================================
--
-- Si el proveedor no está en la agenda, la compra igual entra sin contacto y
-- se avisa. Perder ₲ 3.388.000 de registro porque no está agendado el que
-- vendió los lechones sería exactamente el problema que esto viene a
-- resolver.

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
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO'
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
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO'
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
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO'
  ]));

-- ============================================================
-- 2) De qué comando salió cada compra y cada gasto fijo
-- ============================================================
--
-- Sin esto no hay idempotencia: el ejecutor se reintenta y la misma compra de
-- ₲ 3.388.000 entraría dos veces. Mismo patrón que ventas y productos.

alter table public.eos_erp_compras
  add column if not exists action_command_id uuid
    references public.eos_action_commands (id) on delete set null;

create unique index if not exists eos_erp_compras_action_command_idx
  on public.eos_erp_compras (action_command_id)
  where action_command_id is not null;

alter table public.eos_finanzas_fijos
  add column if not exists action_command_id uuid
    references public.eos_action_commands (id) on delete set null;

-- Índice y no restricción única: un comando puede declarar varios fijos.
create index if not exists eos_finanzas_fijos_action_command_idx
  on public.eos_finanzas_fijos (action_command_id)
  where action_command_id is not null;

-- ============================================================
-- 3) Registrar la compra desde el chat
-- ============================================================
--
-- No reimplementa nada: arma los ítems y delega en
-- `eos_erp_registrar_compra` (v70), que es la misma función que usa la
-- pantalla y la que ya sabe repartir el IVA, mover el stock, actualizar el
-- costo y dejar el movimiento financiero.

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

    -- Mismo tope que el catálogo. La pantalla acepta 200 porque ahí se pega
    -- una factura entera; acá se dicta, y veinte conceptos dictados de
    -- corrido ya es un modelo en un bucle.
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

    -- El total manda sobre el unitario: "5 lechones 1.500.000" es como habla
    -- cualquiera, y dividir acá es determinista. Ver la cabecera.
    if v_unitario is null and v_total is not null then
      v_unitario := v_total / v_cantidad;
    end if;

    if v_unitario is null or v_unitario <= 0 then
      raise exception 'EOS_ACCION_COMPRA_SIN_MONTO: %', v_concepto;
    end if;

    v_iva := nullif(regexp_replace(coalesce(v_item ->> 'iva', ''), '[^0-9]', '', 'g'), '')::integer;
    if v_iva is null or v_iva not in (0, 5, 10) then v_iva := 10; end if;

    -- Si el concepto es un producto del catálogo, la compra le suma stock y
    -- le actualiza el costo. Si no, entra como texto y no se crea nada.
    v_producto := public.eos_erp_resolver_producto(p_usuario_id, v_concepto);

    if v_producto is null then
      v_sin_catalogo := v_sin_catalogo || to_jsonb(v_concepto);
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
      'en_catalogo', v_producto is not null
    );
  end loop;

  -- El proveedor es opcional y NO puede tirar abajo la compra.
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
    -- El total lo dice la función que la registró, no una suma hecha acá: es
    -- la que redondeó cada ítem, y dos redondeos distintos sobre los mismos
    -- números dan dos totales que se llevan por un guaraní.
    'total_compra', (v_rpc ->> 'total')::numeric,
    'sin_catalogo', v_sin_catalogo,
    'proveedor', case when v_proveedor is null then null else jsonb_build_object(
      'nombre', v_proveedor,
      'agendado', v_contacto is not null
    ) end
  );
end;
$function$;

revoke all on function public.eos_erp_registrar_compra_chat_v134(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_erp_registrar_compra_chat_v134(uuid, uuid, jsonb) to service_role;

comment on function public.eos_erp_registrar_compra_chat_v134(uuid, uuid, jsonb) is
  'v134: registra una compra dictada por chat. No exige catálogo y acepta el total además del unitario. Delega en eos_erp_registrar_compra.';

-- ============================================================
-- 4) Los gastos que se repiten
-- ============================================================
--
-- "Salario del capataz: 750.000 cada 15 días" no es una compra: es algo que
-- va a volver a pasar, y lo que hace útil al panel financiero es saberlo
-- ANTES de que pase dos veces.
--
-- `eos_finanzas_fijos` es mensual (`dia_del_mes`), así que una frecuencia
-- quincenal o semanal se convierte a su equivalente por mes y **se devuelve
-- la conversión** para que la respuesta la diga. Guardar 750.000 mensuales
-- cuando en realidad se pagan 1.500.000 subestimaría el gasto a la mitad, y
-- guardar 1.500.000 sin decir por qué dejaría a alguien buscando de dónde
-- salió ese número.

create or replace function public.eos_finanzas_registrar_fijo_v134(
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
  v_descripcion text;
  v_monto numeric;
  v_mensual numeric;
  v_frecuencia text;
  v_factor numeric;
  v_dia integer;
  v_tipo text;
  v_id uuid;
  v_primero uuid;
  v_hechos jsonb := '[]'::jsonb;
  v_cuantos integer := 0;
begin
  v_lista := case
    when jsonb_typeof(p_datos -> 'fijos') = 'array' then p_datos -> 'fijos'
    when jsonb_typeof(p_datos -> 'items') = 'array' then p_datos -> 'items'
    else jsonb_build_array(p_datos)
  end;

  if jsonb_array_length(v_lista) = 0 then
    raise exception 'EOS_ACCION_FIJO_SIN_DATOS';
  end if;

  for v_item in select * from jsonb_array_elements(v_lista)
  loop
    v_cuantos := v_cuantos + 1;
    if v_cuantos > 10 then
      raise exception 'EOS_ACCION_FIJO_DEMASIADOS';
    end if;

    v_descripcion := nullif(btrim(coalesce(
      v_item ->> 'descripcion', v_item ->> 'concepto', v_item ->> 'nombre', ''
    )), '');

    if v_descripcion is null then
      raise exception 'EOS_ACCION_FIJO_SIN_DESCRIPCION';
    end if;

    v_monto := nullif(regexp_replace(coalesce(
      v_item ->> 'monto', v_item ->> 'importe', ''
    ), '[^0-9.]', '', 'g'), '')::numeric;

    if v_monto is null or v_monto <= 0 then
      raise exception 'EOS_ACCION_FIJO_SIN_MONTO: %', v_descripcion;
    end if;

    v_frecuencia := lower(nullif(btrim(coalesce(v_item ->> 'frecuencia', '')), ''));

    v_factor := case v_frecuencia
      when 'quincenal' then 2
      when 'semanal' then 52.0 / 12.0
      when 'diaria' then 30
      when 'anual' then 1.0 / 12.0
      else 1
    end;

    v_mensual := round(v_monto * v_factor);

    -- El día del mes lo pide la tabla y casi nunca lo dice el usuario. Se usa
    -- el de hoy y la respuesta lo dice: inventar un día "razonable" mueve la
    -- proyección de caja sin que nadie sepa por qué.
    v_dia := nullif(regexp_replace(coalesce(v_item ->> 'dia_del_mes', ''), '[^0-9]', '', 'g'), '')::integer;
    if v_dia is null or v_dia < 1 or v_dia > 31 then
      v_dia := extract(day from (now() at time zone 'America/Asuncion'))::integer;
    end if;

    v_tipo := case when lower(coalesce(v_item ->> 'tipo', '')) = 'ingreso' then 'ingreso' else 'gasto' end;

    insert into public.eos_finanzas_fijos (
      usuario_id, tipo, descripcion, monto, dia_del_mes, activo, action_command_id
    ) values (
      p_usuario_id, v_tipo, left(v_descripcion, 200), v_mensual, v_dia, true, p_command_id
    )
    returning id into v_id;

    if v_primero is null then v_primero := v_id; end if;

    v_hechos := v_hechos || jsonb_build_object(
      'id', v_id,
      'descripcion', v_descripcion,
      'tipo', v_tipo,
      'monto_mensual', v_mensual,
      'monto_original', v_monto,
      'frecuencia', coalesce(v_frecuencia, 'mensual'),
      'convertido', v_factor <> 1,
      'dia_del_mes', v_dia
    );
  end loop;

  return jsonb_build_object('primero', v_primero, 'fijos', v_hechos);
end;
$function$;

revoke all on function public.eos_finanzas_registrar_fijo_v134(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_finanzas_registrar_fijo_v134(uuid, uuid, jsonb) to service_role;

comment on function public.eos_finanzas_registrar_fijo_v134(uuid, uuid, jsonb) is
  'v134: declara gastos o ingresos que se repiten. Convierte quincenal/semanal a su equivalente mensual y devuelve la conversión para poder decirla.';
