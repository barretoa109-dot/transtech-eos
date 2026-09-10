-- ANULAR_VENTA: "esa venta estaba mal, anulala".
--
-- ============================================================
-- LA FUNCIÓN ESTÁ DESDE EL 27 DE AGOSTO Y NO TENÍA VERBO
-- ============================================================
--
-- `eos_erp_anular_venta` devuelve el stock al estante con su movimiento, borra
-- el ingreso del panel, cancela el borrador de factura si lo hay y se niega a
-- tocar una venta con factura emitida. Está probada
-- —`anulacion-invariantes.test.ts`— y la usa la pantalla de Negocio.
--
-- Desde el chat no se podía. Es el hueco número 8 del mapa de
-- `docs/autonomia/verbos.md`: la acción existe, la persona la pide, y no hay
-- forma de llegar.
--
-- Y es el hueco que se abrió el 9 de septiembre de 2026 a las 22:13: una
-- usuaria registró por chat una venta de DOS unidades del mismo talle cuando
-- eran una S y una M. Para arreglarlo tuvo que ir a la pantalla, encontrar la
-- fila y anularla a mano. EOS le había cargado el error en un segundo y no
-- sabía deshacerlo.
--
-- ============================================================
-- CUÁL VENTA: LA MÁS RECIENTE QUE COINCIDA, Y SE DICE CUÁL
-- ============================================================
--
-- Mismo criterio que CORREGIR_MOVIMIENTO (v148), por la misma razón: quien
-- dice "esa venta" habla de la de recién, no de una de hace tres semanas.
--
--   · sólo entre las NO anuladas de los últimos 7 días;
--   · con referencia —un monto, un producto, un cliente— se filtra por eso;
--   · sin referencia, la más reciente;
--   · si dijo algo y no coincide con NADA, se falla. No se cae a "la última":
--     pedir que anule la de Rossana y que anule otra es el peor resultado.
--
-- Y la respuesta dice SIEMPRE qué anuló: fecha, total y productos. Es lo único
-- que permite darse cuenta en el momento de que se anuló la que no era. Sin
-- eso, "listo, anulada" sobre la venta equivocada pasa desapercibido hasta que
-- alguien mira el stock.
--
-- ============================================================
-- POR QUÉ HACE FALTA UNA COLUMNA
-- ============================================================
--
-- El ejecutor se reintenta: tiene `max_attempts`. Sin una marca durable, un
-- segundo intento volvería a resolver "la más reciente que coincida" — y como
-- la primera ya está anulada, encontraría OTRA y anularía una venta buena.
--
-- `anulada_por_command_id` es esa marca, igual que `action_command_id` en las
-- filas que las demás acciones crean.

-- ============================================================
-- 1) De qué comando salió cada anulación
-- ============================================================

alter table public.eos_erp_ventas
  add column if not exists anulada_por_command_id uuid
    references public.eos_action_commands (id) on delete set null;

create unique index if not exists eos_erp_ventas_anulada_por_command_idx
  on public.eos_erp_ventas (anulada_por_command_id)
  where anulada_por_command_id is not null;

-- ============================================================
-- 2) Cuál venta quiso decir
-- ============================================================

create or replace function public.eos_erp_resolver_venta(
  p_usuario_id uuid,
  p_referencia text default null,
  p_dias integer default 7
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_ref text := btrim(coalesce(p_referencia, ''));
  v_tokens text[];
  v_monto numeric;
  v_id uuid;
  v_cuantos int;
  v_desde date := (now() at time zone 'America/Asuncion')::date - greatest(coalesce(p_dias, 7), 0);
begin
  /*
   * Un monto en la referencia vale más que las palabras.
   *
   * "anulá la de 370.000" es la forma más precisa de señalar una venta, y la
   * que usa cualquiera que está mirando la lista. Se prueba primero.
   */
  v_monto := public.eos_leer_monto(v_ref);

  if v_monto is not null and v_monto > 0 then
    select count(*), (array_agg(v.id order by v.creado_en desc))[1]
      into v_cuantos, v_id
    from public.eos_erp_ventas v
    where v.usuario_id = p_usuario_id
      and v.estado <> 'anulada'
      and v.fecha >= v_desde
      and v.total = v_monto;

    if v_cuantos = 1 then
      return jsonb_build_object('venta_id', v_id, 'candidatos', 1, 'capa', 'monto');
    end if;

    -- Varias del mismo importe: la más reciente. Dos ventas iguales el mismo
    -- día son el caso normal de un mostrador, y quien dice "anulá la de
    -- 370.000" recién cargada habla de la última.
    if v_cuantos > 1 then
      return jsonb_build_object('venta_id', v_id, 'candidatos', v_cuantos, 'capa', 'monto');
    end if;
  end if;

  -- Por producto o por cliente, con las mismas palabras del resolver de
  -- productos: sin acentos, en singular y sin las de relleno.
  v_tokens := public.eos_tokens(v_ref, true);

  if cardinality(v_tokens) > 0 then
    select count(*), (array_agg(v.id order by v.creado_en desc))[1]
      into v_cuantos, v_id
    from public.eos_erp_ventas v
    where v.usuario_id = p_usuario_id
      and v.estado <> 'anulada'
      and v.fecha >= v_desde
      and (
        exists (
          select 1
          from public.eos_erp_venta_items i
          where i.venta_id = v.id
            and v_tokens <@ public.eos_tokens(coalesce(i.descripcion, ''), true)
        )
        or exists (
          select 1
          from public.eos_crm_contactos c
          where c.id = v.contacto_id
            and v_tokens <@ public.eos_tokens(c.nombre, false)
        )
      );

    if v_cuantos >= 1 then
      /*
       * Con varias que coinciden se toma la más reciente, igual que
       * CORREGIR_MOVIMIENTO, y la respuesta dice cuál fue y cuántas había.
       *
       * La alternativa —preguntar cuál— suena más prudente y es peor: quien
       * acaba de cargar mal una venta quiere deshacerla ahora, y una lista de
       * cinco parecidas no la ayuda a elegir más que la fecha, que es
       * justamente lo que ordena esto.
       */
      return jsonb_build_object('venta_id', v_id, 'candidatos', v_cuantos, 'capa', 'referencia');
    end if;

    -- Dijo algo y no coincide con nada: NO se cae a "la más reciente".
    return jsonb_build_object('venta_id', null, 'candidatos', 0, 'capa', 'referencia');
  end if;

  -- Sin referencia: la última. Es lo que significa "esa venta" dicho justo
  -- después de cargarla.
  select count(*), (array_agg(v.id order by v.creado_en desc))[1]
    into v_cuantos, v_id
  from public.eos_erp_ventas v
  where v.usuario_id = p_usuario_id
    and v.estado <> 'anulada'
    and v.fecha >= v_desde;

  if v_cuantos = 0 then
    return jsonb_build_object('venta_id', null, 'candidatos', 0, 'capa', 'ultima');
  end if;

  return jsonb_build_object('venta_id', v_id, 'candidatos', v_cuantos, 'capa', 'ultima');
end;
$function$;

revoke all on function public.eos_erp_resolver_venta(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.eos_erp_resolver_venta(uuid, text, integer) to service_role;

-- ============================================================
-- 3) Anular desde el chat, contando qué se anuló
-- ============================================================

create or replace function public.eos_erp_anular_venta_por_chat_v161(
  p_usuario_id uuid,
  p_command_id uuid,
  p_referencia text default null,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ya uuid;
  v_detalle jsonb;
  v_venta_id uuid;
  v_venta public.eos_erp_ventas%rowtype;
  v_rpc jsonb;
  v_items jsonb;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  -- Idempotencia: un reintento encuentra su propia huella. Ver la cabecera.
  select v.id into v_ya
  from public.eos_erp_ventas v
  where v.anulada_por_command_id = p_command_id
  limit 1;

  if v_ya is not null then
    select * into v_venta from public.eos_erp_ventas where id = v_ya;

    return jsonb_build_object(
      'ok', true,
      'ya_estaba', true,
      'venta_id', v_ya,
      'fecha', v_venta.fecha,
      'total', v_venta.total,
      'moneda', v_venta.moneda
    );
  end if;

  v_detalle := public.eos_erp_resolver_venta(p_usuario_id, p_referencia, 7);
  v_venta_id := nullif(v_detalle ->> 'venta_id', '')::uuid;

  if v_venta_id is null then
    raise exception 'EOS_ACCION_VENTA_NO_ENCONTRADA: %',
      coalesce(nullif(btrim(coalesce(p_referencia, '')), ''), 'la última');
  end if;

  select * into v_venta from public.eos_erp_ventas where id = v_venta_id;

  /*
   * Qué se anuló, leído ANTES de anularlo.
   *
   * Es lo único que permite ver en el momento que se anuló la que no era.
   */
  select coalesce(
    jsonb_agg(jsonb_build_object('producto', i.descripcion, 'cantidad', i.cantidad)
              order by i.descripcion),
    '[]'::jsonb
  )
  into v_items
  from public.eos_erp_venta_items i
  where i.venta_id = v_venta_id;

  v_rpc := public.eos_erp_anular_venta(
    p_usuario_id,
    v_venta_id,
    coalesce(v_motivo, 'Anulada desde el chat')
  );

  update public.eos_erp_ventas
  set anulada_por_command_id = p_command_id
  where id = v_venta_id;

  return v_rpc || jsonb_build_object(
    'venta_id', v_venta_id,
    'fecha', v_venta.fecha,
    'total', v_venta.total,
    'moneda', v_venta.moneda,
    'items', v_items,
    'candidatos', v_detalle -> 'candidatos',
    'capa', v_detalle -> 'capa'
  );
end;
$function$;

revoke all on function public.eos_erp_anular_venta_por_chat_v161(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_anular_venta_por_chat_v161(uuid, uuid, text, text)
  to service_role;

comment on function public.eos_erp_anular_venta_por_chat_v161(uuid, uuid, text, text) is
  'v161: anula una venta desde el chat resolviendo cuál por referencia o por ser la más reciente, y devuelve qué anuló. Ver la cabecera de la v161.';

-- ============================================================
-- 4) El catálogo de acciones, en las tres tablas
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
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA',
    'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA'
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
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA',
    'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA'
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
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA',
    'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA'
  ]));
