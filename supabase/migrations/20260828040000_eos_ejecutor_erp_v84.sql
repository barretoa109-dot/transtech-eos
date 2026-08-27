-- Que el ejecutor sepa vender, ajustar y agendar (v84).
--
-- La v83 abrió el catálogo de acciones y dejó los nombres resolubles. Acá el
-- ejecutor aprende a cumplirlas.
--
-- Se genera a partir de la definición VIVA de `eos_execute_internal_effect_v64`:
-- tiene tres ramas —tareas, objetivos, memoria— que no conviene volver a
-- escribir a mano, porque copiarlas mal sería romperlas sin darse cuenta.
--
-- ============================================================
-- LO QUE SE FALLA EN VEZ DE ADIVINAR
-- ============================================================
--
--   * Un producto que no se resuelve a uno solo. "Pan" con "Pan casero" y "Pan
--     de leche" en el catálogo es un error, no un empate.
--   * Un cliente nombrado que no existe. "Vendile a Rossana" y que la venta
--     quede a consumidor final es peor que no cargarla.
--   * Una venta sin ítems.
--   * Un módulo no contratado.
--
-- Cada uno de esos vuelve como error con su motivo, y EOS se lo cuenta al
-- usuario. Adivinar sería más cómodo y por eso mismo no se hace: el que
-- adivina mal descuenta el stock equivocado y cobra el precio equivocado.
--
-- `eos_erp_ajustar_stock` suma un parámetro para sellar el movimiento con el
-- comando que lo originó. Sin eso no hay idempotencia y un reintento —el
-- ejecutor tiene `max_attempts`— ajustaría el stock dos veces.

-- El dígito verificador del RUC, mod-11, igual que lib/facturacion/cdc.ts.
--
-- Se calcula acá y no se le pide al modelo. Un dígito inventado no rompe nada
-- hasta el día en que se emite una factura a ese cliente: ahí SIFEN la rechaza,
-- el comprobante ya se entregó y hay que rehacer todo.
create or replace function public.eos_ruc_digito_verificador(p_ruc text)
returns smallint
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_digitos text := regexp_replace(coalesce(p_ruc, ''), '[^0-9]', '', 'g');
  v_total int := 0;
  v_peso int := 2;
  v_resto int;
  i int;
begin
  if v_digitos = '' then
    return null;
  end if;

  for i in reverse length(v_digitos)..1 loop
    if v_peso > 11 then
      v_peso := 2;
    end if;

    v_total := v_total + (substr(v_digitos, i, 1))::int * v_peso;
    v_peso := v_peso + 1;
  end loop;

  v_resto := v_total % 11;

  return (case when v_resto > 1 then 11 - v_resto else 0 end)::smallint;
end;
$function$;

revoke all on function public.eos_ruc_digito_verificador(text) from public, anon;

drop function if exists public.eos_erp_ajustar_stock(uuid, uuid, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.eos_erp_ajustar_stock(p_usuario_id uuid, p_producto_id uuid, p_stock_contado numeric DEFAULT NULL::numeric, p_delta numeric DEFAULT NULL::numeric, p_motivo text DEFAULT NULL::text, p_action_command_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_producto public.eos_erp_productos%rowtype;
  v_diferencia numeric(16,3);
  v_saldo numeric(16,3);
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_fecha date := (now() at time zone 'America/Asuncion')::date;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if (p_stock_contado is null) = (p_delta is null) then
    raise exception 'EOS_AJUSTE_MODO_INVALIDO';
  end if;

  if v_motivo is null then
    raise exception 'EOS_AJUSTE_MOTIVO_REQUERIDO';
  end if;

  v_motivo := left(v_motivo, 500);

  if p_stock_contado in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or p_delta in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
    raise exception 'EOS_AJUSTE_NUMERO_INVALIDO';
  end if;

  if p_stock_contado is not null and p_stock_contado < 0 then
    raise exception 'EOS_AJUSTE_CONTEO_NEGATIVO';
  end if;

  select * into v_producto
  from public.eos_erp_productos
  where id = p_producto_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_PRODUCTO_NO_EXISTE';
  end if;

  if not v_producto.controla_stock then
    raise exception 'EOS_PRODUCTO_SIN_STOCK';
  end if;

  v_diferencia := case
    when p_stock_contado is not null then p_stock_contado - v_producto.stock_actual
    else p_delta
  end;

  -- Contar y que dé lo mismo no es un error, pero tampoco un movimiento.
  if v_diferencia = 0 then
    return jsonb_build_object(
      'ok', true,
      'sin_cambios', true,
      'producto_id', v_producto.id,
      'stock_actual', v_producto.stock_actual
    );
  end if;

  update public.eos_erp_productos
  set stock_actual = stock_actual + v_diferencia,
      actualizado_en = now()
  where id = v_producto.id
  returning stock_actual into v_saldo;

  insert into public.eos_erp_movimientos_stock (
    usuario_id, producto_id, tipo, cantidad, saldo_resultante,
    motivo, referencia_tipo, referencia_id, fecha, action_command_id
  ) values (
    p_usuario_id, v_producto.id, 'ajuste', v_diferencia, v_saldo,
    v_motivo,
    case when p_stock_contado is not null then 'inventario' else 'manual' end,
    null, v_fecha
  , p_action_command_id
  );

  return jsonb_build_object(
    'ok', true,
    'sin_cambios', false,
    'movimiento_id', (
      select m.id from public.eos_erp_movimientos_stock m
      where m.producto_id = v_producto.id
      order by m.creado_en desc
      limit 1
    ),
    'producto_id', v_producto.id,
    'stock_anterior', v_producto.stock_actual,
    'stock_actual', v_saldo,
    'diferencia', v_diferencia
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.eos_execute_internal_effect_v64(p_command_id uuid)
 RETURNS TABLE(command_id uuid, accion text, effect_type text, effect_id uuid, idempotent boolean, estado text, resultado jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_command public.eos_action_commands%rowtype;
  v_data jsonb := '{}'::jsonb;
  v_message text;
  v_effect_type text;
  v_effect_id uuid;
  v_idempotent boolean := false;
  v_priority integer := 3;
  v_goal_payload jsonb := '{}'::jsonb;
  v_goal_command public.eos_goal_commands%rowtype;
  v_result jsonb := '{}'::jsonb;
  v_texto text;
  v_item jsonb;
  v_items jsonb;
  v_contacto_id uuid;
  v_producto_id uuid;
  v_rpc jsonb;
begin
  if p_command_id is null then
    raise exception 'command_id es obligatorio.';
  end if;

  select *
  into v_command
  from public.eos_action_commands
  where id = p_command_id
  for update;

  if v_command.id is null then
    raise exception 'EOS_INTERNAL_EFFECT_COMMAND_NOT_FOUND';
  end if;

  if v_command.accion not in (
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO'
  ) then
    raise exception 'EOS_INTERNAL_EFFECT_UNSUPPORTED_ACTION';
  end if;

  if v_command.estado not in ('recibida', 'ejecutando', 'completada') then
    raise exception 'EOS_INTERNAL_EFFECT_COMMAND_NOT_EXECUTABLE: %', v_command.estado;
  end if;

  if not exists (
    select 1
    from public.eos_autonomy_events_v12 e
    where e.command_id = v_command.id
      and e.usuario_id = v_command.usuario_id
      and e.event_type in ('auto_allowed', 'consumed')
  ) then
    raise exception 'EOS_INTERNAL_EFFECT_NOT_AUTHORIZED';
  end if;

  v_data := case
    when jsonb_typeof(v_command.payload -> 'datos') = 'object'
      then v_command.payload -> 'datos'
    else coalesce(v_command.payload, '{}'::jsonb)
  end;

  v_message := nullif(btrim(coalesce(v_command.payload ->> 'mensaje', '')), '');

  if v_command.estado <> 'completada' then
    update public.eos_action_commands
    set estado = 'ejecutando',
        started_at = coalesce(started_at, now()),
        lease_expires_at = now() + interval '5 minutes',
        updated_at = now()
    where id = v_command.id;
  end if;

  if v_command.accion = 'CREAR_TAREA' then
    v_effect_type := 'task';

    select t.id
    into v_effect_id
    from public.eos_tasks t
    where t.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      if coalesce(v_data ->> 'prioridad', '') ~ '^[1-5]$' then
        v_priority := (v_data ->> 'prioridad')::integer;
      else
        v_priority := 3;
      end if;

      insert into public.eos_tasks (
        usuario_id,
        titulo,
        descripcion,
        estado,
        prioridad,
        fecha_limite,
        action_command_id
      ) values (
        v_command.usuario_id,
        left(coalesce(nullif(btrim(v_data ->> 'titulo'), ''), nullif(left(v_message, 180), ''), 'Nueva tarea EOS'), 180),
        coalesce(nullif(btrim(v_data ->> 'descripcion'), ''), v_message),
        'pendiente',
        v_priority,
        case
          when coalesce(v_data ->> 'fecha_limite', '') ~ '^\d{4}-\d{2}-\d{2}'
            then (v_data ->> 'fecha_limite')::timestamptz
          else null
        end,
        v_command.id
      )
      on conflict (action_command_id) where action_command_id is not null
      do nothing
      returning id into v_effect_id;

      if v_effect_id is null then
        select t.id into v_effect_id
        from public.eos_tasks t
        where t.action_command_id = v_command.id
        limit 1;
        v_idempotent := true;
      end if;
    end if;

  elsif v_command.accion = 'GUARDAR_MEMORIA' then
    v_effect_type := 'memory';

    select m.id into v_effect_id
    from public.eos_memory m
    where m.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      insert into public.eos_memory (
        usuario_id,
        conversacion_id,
        mensaje_id,
        titulo,
        categoria,
        contenido,
        importancia,
        origen,
        estado,
        metadata,
        action_command_id
      ) values (
        v_command.usuario_id,
        v_command.conversacion_id,
        v_command.mensaje_id,
        left(coalesce(nullif(btrim(v_data ->> 'titulo'), ''), 'Dato importante'), 180),
        left(coalesce(nullif(btrim(v_data ->> 'categoria'), ''), 'general'), 80),
        coalesce(nullif(btrim(v_data ->> 'contenido'), ''), nullif(btrim(v_data ->> 'texto'), ''), nullif(btrim(v_data ->> 'descripcion'), ''), v_message),
        case
          when coalesce(v_data ->> 'importancia', '') ~ '^\d+$'
            then greatest(1, least(10, (v_data ->> 'importancia')::integer))
          else 5
        end,
        'eos-worker-gated',
        'activo',
        jsonb_build_object('fuente', 'worker_gate', 'request_id', v_command.request_id, 'action_command_id', v_command.id),
        v_command.id
      )
      on conflict (action_command_id) where action_command_id is not null
      do nothing
      returning id into v_effect_id;

      if v_effect_id is null then
        select m.id into v_effect_id
        from public.eos_memory m
        where m.action_command_id = v_command.id
        limit 1;
        v_idempotent := true;
      end if;
    end if;

  elsif v_command.accion = 'CREAR_OBJETIVO' then
    v_effect_type := 'goal';

    select gc.* into v_goal_command
    from public.eos_goal_commands gc
    where gc.action_command_id = v_command.id
    limit 1;

    if v_goal_command.id is not null then
      v_idempotent := true;
    else
      v_goal_payload := v_data || jsonb_build_object(
        'titulo', coalesce(nullif(btrim(v_data ->> 'titulo'), ''), nullif(left(v_message, 180), ''), 'Nuevo objetivo EOS'),
        'descripcion', coalesce(nullif(btrim(v_data ->> 'descripcion'), ''), v_message)
      );

      insert into public.eos_goal_commands (
        usuario_id,
        request_id,
        accion,
        payload,
        conversacion_id,
        mensaje_id,
        action_command_id
      ) values (
        v_command.usuario_id,
        v_command.request_id,
        'CREAR_OBJETIVO',
        v_goal_payload,
        v_command.conversacion_id,
        v_command.mensaje_id,
        v_command.id
      )
      on conflict (action_command_id) where action_command_id is not null
      do nothing;

      select gc.* into v_goal_command
      from public.eos_goal_commands gc
      where gc.action_command_id = v_command.id
      limit 1;
    end if;

    if v_goal_command.id is null then
      raise exception 'EOS_INTERNAL_EFFECT_GOAL_COMMAND_MISSING';
    end if;

    if v_goal_command.estado = 'error' then
      raise exception 'EOS_INTERNAL_EFFECT_GOAL_FAILED: %', coalesce(v_goal_command.error, 'unknown');
    end if;

    v_effect_id := v_goal_command.objetivo_id;
    if v_effect_id is null then
      raise exception 'EOS_INTERNAL_EFFECT_GOAL_ID_MISSING';
    end if;

  elsif v_command.accion = 'REGISTRAR_VENTA' then
    v_effect_type := 'venta';

    select v.id into v_effect_id
    from public.eos_erp_ventas v
    where v.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      if not public.eos_tiene_modulo(v_command.usuario_id, 'erp') then
        raise exception 'EOS_ACCION_SIN_MODULO_ERP';
      end if;

      -- El cliente es opcional: una venta de mostrador es a consumidor final.
      -- Pero si lo nombraron y no se encuentra, se falla en vez de cargarla sin
      -- cliente: "vendile a Rossana" y que quede anónima es un error silencioso.
      v_contacto_id := null;
      v_texto := nullif(btrim(coalesce(v_data ->> 'contacto', v_data ->> 'cliente', '')), '');

      if v_texto is not null then
        v_contacto_id := public.eos_crm_resolver_contacto(v_command.usuario_id, v_texto);

        if v_contacto_id is null then
          raise exception 'EOS_ACCION_CONTACTO_NO_RESUELTO: %', v_texto;
        end if;
      end if;

      v_items := '[]'::jsonb;

      for v_item in
        select * from jsonb_array_elements(
          case
            when jsonb_typeof(v_data -> 'items') = 'array' then v_data -> 'items'
            else '[]'::jsonb
          end
        )
      loop
        v_texto := nullif(btrim(coalesce(
          v_item ->> 'producto', v_item ->> 'nombre', v_item ->> 'descripcion', ''
        )), '');

        v_producto_id := public.eos_erp_resolver_producto(v_command.usuario_id, v_texto);

        if v_producto_id is null then
          raise exception 'EOS_ACCION_PRODUCTO_NO_RESUELTO: %', coalesce(v_texto, '(sin nombre)');
        end if;

        v_items := v_items || jsonb_build_array(
          jsonb_build_object(
            'producto_id', v_producto_id,
            'cantidad', greatest(coalesce((v_item ->> 'cantidad')::numeric, 1), 0.001)
          )
          || case
               when (v_item ->> 'precio_unitario') is not null
                 then jsonb_build_object('precio_unitario', (v_item ->> 'precio_unitario')::numeric)
               else '{}'::jsonb
             end
        );
      end loop;

      if jsonb_array_length(v_items) = 0 then
        raise exception 'EOS_ACCION_VENTA_SIN_ITEMS';
      end if;

      /*
       * Contado se da por cobrado, salvo que digan lo contrario.
       *
       * Quien dicta "vendile tres panes a Rossana" en el mostrador ya cobró. A
       * crédito nunca: ahí la plata no está, y anotarla mostraría disponible
       * algo que nadie puede gastar.
       */
      v_rpc := public.eos_erp_registrar_venta(
        v_command.usuario_id,
        v_items,
        v_contacto_id,
        null,
        'PYG',
        case when v_data ->> 'condicion' = 'credito' then 'credito' else 'contado' end,
        case
          when v_data ->> 'condicion' = 'credito' then false
          when (v_data ->> 'cobrada') is not null then (v_data ->> 'cobrada')::boolean
          else true
        end,
        'Cargada por EOS desde la conversación.'
      );

      v_effect_id := (v_rpc ->> 'venta_id')::uuid;

      update public.eos_erp_ventas
      set action_command_id = v_command.id
      where id = v_effect_id;
    end if;

  elsif v_command.accion = 'AJUSTAR_STOCK' then
    v_effect_type := 'ajuste_stock';

    select m.id into v_effect_id
    from public.eos_erp_movimientos_stock m
    where m.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      if not public.eos_tiene_modulo(v_command.usuario_id, 'erp') then
        raise exception 'EOS_ACCION_SIN_MODULO_ERP';
      end if;

      v_texto := nullif(btrim(coalesce(v_data ->> 'producto', v_data ->> 'nombre', '')), '');
      v_producto_id := public.eos_erp_resolver_producto(v_command.usuario_id, v_texto);

      if v_producto_id is null then
        raise exception 'EOS_ACCION_PRODUCTO_NO_RESUELTO: %', coalesce(v_texto, '(sin nombre)');
      end if;

      v_rpc := public.eos_erp_ajustar_stock(
        v_command.usuario_id,
        v_producto_id,
        case when (v_data ->> 'stock_contado') is not null
          then (v_data ->> 'stock_contado')::numeric else null end,
        case when (v_data ->> 'delta') is not null
          then (v_data ->> 'delta')::numeric else null end,
        coalesce(nullif(btrim(v_data ->> 'motivo'), ''), 'Ajuste pedido por conversación'),
        v_command.id
      );

      v_effect_id := nullif(v_rpc ->> 'movimiento_id', '')::uuid;

      /*
       * Contar y que dé lo mismo no mueve nada, y sin movimiento no hay efecto
       * que devolver. Se apunta al producto para que el comando cierre bien: el
       * pedido se cumplió, sólo que no había nada que corregir.
       */
      if v_effect_id is null then
        v_effect_id := v_producto_id;
        v_idempotent := true;
      end if;
    end if;

  elsif v_command.accion = 'CREAR_CONTACTO' then
    v_effect_type := 'contacto';

    select c.id into v_effect_id
    from public.eos_crm_contactos c
    where c.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      if not (
        public.eos_tiene_modulo(v_command.usuario_id, 'crm')
        or public.eos_tiene_modulo(v_command.usuario_id, 'erp')
      ) then
        raise exception 'EOS_ACCION_SIN_MODULO_CRM';
      end if;

      v_texto := nullif(btrim(coalesce(v_data ->> 'nombre', v_data ->> 'contacto', '')), '');

      if v_texto is null then
        raise exception 'EOS_ACCION_CONTACTO_SIN_NOMBRE';
      end if;

      -- Si ya existe con ese nombre, no se duplica: se devuelve el que hay.
      v_contacto_id := public.eos_crm_resolver_contacto(v_command.usuario_id, v_texto);

      if v_contacto_id is not null then
        v_effect_id := v_contacto_id;
        v_idempotent := true;
      else
        insert into public.eos_crm_contactos (
          usuario_id, tipo, nombre, ruc, ruc_dv, telefono, email,
          es_cliente, es_proveedor, action_command_id
        ) values (
          v_command.usuario_id,
          case when v_data ->> 'tipo' = 'empresa' then 'empresa' else 'persona' end,
          left(v_texto, 160),
          nullif(regexp_replace(coalesce(v_data ->> 'ruc', ''), '[^0-9]', '', 'g'), ''),
          -- El dígito lo calcula la base: pedírselo al modelo es invitarlo a
          -- inventar uno, y un RUC mal cerrado sólo se descubre cuando SIFEN
          -- rechaza una factura ya entregada.
          case
            when nullif(regexp_replace(coalesce(v_data ->> 'ruc', ''), '[^0-9]', '', 'g'), '') is not null
              then public.eos_ruc_digito_verificador(
                regexp_replace(v_data ->> 'ruc', '[^0-9]', '', 'g')
              )
            else null
          end,
          left(nullif(btrim(coalesce(v_data ->> 'telefono', '')), ''), 40),
          left(lower(nullif(btrim(coalesce(v_data ->> 'email', '')), '')), 180),
          coalesce((v_data ->> 'es_cliente')::boolean, true),
          coalesce((v_data ->> 'es_proveedor')::boolean, false),
          v_command.id
        )
        returning id into v_effect_id;
      end if;
    end if;
  end if;

  if v_effect_id is null then
    raise exception 'EOS_INTERNAL_EFFECT_ID_MISSING';
  end if;

  v_result := coalesce(v_command.resultado, '{}'::jsonb) || jsonb_build_object(
    'effect_type', v_effect_type,
    'effect_id', v_effect_id,
    'idempotent', v_idempotent,
    'executor_version', 'v84'
  );

  perform *
  from public.eos_finalize_action_command_v66(
    v_command.id,
    'completada',
    v_result,
    null,
    null
  );

  return query
  select
    v_command.id,
    v_command.accion,
    v_effect_type,
    v_effect_id,
    v_idempotent,
    'completada'::text,
    v_result;
end;
$function$
;
