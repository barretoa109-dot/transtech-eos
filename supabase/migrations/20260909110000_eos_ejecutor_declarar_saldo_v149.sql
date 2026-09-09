-- La rama de DECLARAR_SALDO en el ejecutor.
--
-- Se genera desde el archivo de la v148 con tres cambios y nada más:
--
--   1. La acción entra en la lista de soportadas.
--   2. La rama nueva.
--   3. `executor_version` pasa a 'v149'.
--
-- El porqué está en la cabecera de
-- `20260909100000_eos_declarar_saldo_v149.sql`: el saldo de una cuenta es el
-- número del que dependen el patrimonio, el disponible real y la cobertura, y
-- era el único que obligaba a salir del chat para cargarlo.
--
-- La idempotencia es la de CORREGIR_MOVIMIENTO y no la de las demás: esta
-- acción casi nunca crea una fila, actualiza una que ya existía. La marca es
-- `declarado_por_command_id`, la columna que la v149 agrega a la cuenta.

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
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO', 'CREAR_PRODUCTO',
    'ACTUALIZAR_PRODUCTO', 'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA', 'CORREGIR_MOVIMIENTO',
    'DECLARAR_SALDO'
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

  elsif v_command.accion = 'CREAR_PRODUCTO' then
    v_effect_type := 'producto';

    -- Idempotencia por comando: si el ejecutor se reintenta, la tanda ya está.
    select p.id into v_effect_id
    from public.eos_erp_productos p
    where p.action_command_id = v_command.id
    order by p.creado_en
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      -- La lista, o un producto suelto envuelto en una lista de uno. El
      -- modelo manda `productos` cuando son varios y a veces los campos
      -- sueltos cuando es uno: aceptar las dos formas evita perder el
      -- pedido por cómo quedó escrito.
      v_items := case
        when jsonb_typeof(v_data -> 'productos') = 'array' then v_data -> 'productos'
        when jsonb_typeof(v_data -> 'items') = 'array' then v_data -> 'items'
        else jsonb_build_array(v_data)
      end;

      v_rpc := public.eos_erp_crear_productos_v131(
        v_command.usuario_id,
        v_command.id,
        v_items
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'ACTUALIZAR_PRODUCTO' then
    v_effect_type := 'producto';

    -- Idempotencia por otra vía que las demás.
    --
    -- Crear deja una fila nueva con `action_command_id`, y de ahí se agarra
    -- el reintento. Actualizar no deja nada nuevo: la fila ya existía. Si el
    -- ejecutor se reintentara sin este corte volvería a aplicar el update,
    -- que en sí es inocuo —los mismos valores— pero devolvería `cambios`
    -- vacíos, y la respuesta pasaría de "le puse el costo" a "no había nada
    -- que cambiar" para el mismo pedido. La marca es el resultado que dejó
    -- el intento anterior de ESTE comando.
    if v_command.estado = 'completada' and v_command.resultado ? 'actualizados' then
      v_effect_id := (v_command.resultado ->> 'effect_id')::uuid;
      v_idempotent := true;
    else
      v_items := case
        when jsonb_typeof(v_data -> 'productos') = 'array' then v_data -> 'productos'
        when jsonb_typeof(v_data -> 'items') = 'array' then v_data -> 'items'
        else jsonb_build_array(v_data)
      end;

      v_rpc := public.eos_erp_actualizar_productos_v133(
        v_command.usuario_id,
        v_command.id,
        v_items
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_COMPRA' then
    v_effect_type := 'compra';

    -- Idempotencia por la compra que dejó este mismo comando. Sin esto, un
    -- reintento del ejecutor duplica la compra entera: el total, el
    -- movimiento financiero y el stock que sumó.
    select c.id into v_effect_id
    from public.eos_erp_compras c
    where c.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_erp_registrar_compra_chat_v134(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_GASTO_FIJO' then
    v_effect_type := 'gasto_fijo';

    select f.id into v_effect_id
    from public.eos_finanzas_fijos f
    where f.action_command_id = v_command.id
    order by f.created_at
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_registrar_fijo_v134(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_MOVIMIENTO_PERSONAL' then
    v_effect_type := 'movimiento_personal';

    select m.id into v_effect_id
    from public.eos_movimientos_financieros m
    where m.action_command_id = v_command.id
    order by m.created_at
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_registrar_personal_v136(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_TRANSFERENCIA' then
    v_effect_type := 'transferencia';

    select t.id into v_effect_id
    from public.eos_finanzas_transferencias t
    where t.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_registrar_transferencia_v138(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_DEUDA' then
    v_effect_type := 'deuda';

    -- Idempotencia: si el comando ya creó una deuda, es ésta.
    select d.id into v_effect_id
    from public.eos_finanzas_deudas d
    where d.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null and v_command.estado = 'completada' then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_registrar_deuda_v139(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_PAGO_DEUDA' then
    v_effect_type := 'pago_deuda';

    -- La marca es el movimiento que dejó: un reintento descontaría el saldo
    -- dos veces, que en una deuda es de los errores más caros posibles.
    select m.id into v_effect_id
    from public.eos_movimientos_financieros m
    where m.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_pagar_deuda_v139(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'primero')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'CORREGIR_MOVIMIENTO' then
    v_effect_type := 'correccion_movimiento';

    /*
     * La única acción que no crea una fila: corrige una que ya existía.
     *
     * Por eso la marca de idempotencia no es "existe una fila con este
     * command_id" sino "la fila que voy a tocar YA lleva mi huella". La
     * corrección la deja en `metadata.command_id`, así que un reintento la
     * encuentra y no vuelve a aplicar el cambio.
     *
     * Sin esto, un reintento sobre un monto ya corregido no rompería nada
     * —el update es el mismo— pero sí pisaría `monto_anterior` con el valor
     * ya corregido, y se perdería el único rastro de qué había antes.
     */
    select m.id into v_effect_id
    from public.eos_movimientos_financieros m
    where m.usuario_id = v_command.usuario_id
      and (m.metadata ->> 'command_id') = v_command.id::text
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_corregir_movimiento_v148(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'DECLARAR_SALDO' then
    v_effect_type := 'saldo_cuenta';

    /*
     * Igual que CORREGIR_MOVIMIENTO: casi nunca crea una fila, escribe sobre
     * una cuenta que ya estaba. Así que la marca no es "existe algo con este
     * command_id" sino "la cuenta lleva mi huella".
     *
     * Un reintento sin esto no rompería el saldo —escribir 3.000.000 dos
     * veces da 3.000.000— pero volvería a informar el saldo anterior como si
     * fuera nuevo, y la persona leería dos veces que pasó de un número al
     * otro cuando la segunda vez ya venía del nuevo.
     */
    select c.id into v_effect_id
    from public.eos_finanzas_cuentas c
    where c.usuario_id = v_command.usuario_id
      and c.declarado_por_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_declarar_saldo_v149(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;
  end if;

  if v_effect_id is null then
    raise exception 'EOS_INTERNAL_EFFECT_ID_MISSING';
  end if;

  -- `v_result` PRIMERO, y no solo el objeto de abajo.
  --
  -- Antes esta línea pisaba lo que hubiera puesto la rama: CREAR_PRODUCTO
  -- deja ahí `creados` y `ya_existian`, y se perdían. Sin esos dos datos, el
  -- worker no puede distinguir "cargué cuatro" de "los cuatro ya estaban" y
  -- dice lo mismo en los dos casos — que es cómo EOS termina afirmando que
  -- hizo algo que no hizo.
  v_result := coalesce(v_command.resultado, '{}'::jsonb) || coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'effect_type', v_effect_type,
    'effect_id', v_effect_id,
    'idempotent', v_idempotent,
    'executor_version', 'v149'
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
$function$;
