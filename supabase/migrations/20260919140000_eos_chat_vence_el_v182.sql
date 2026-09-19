-- v182: el chat entiende cuándo se paga o se cobra una venta o compra a crédito.
--
-- ============================================================
-- EL HUECO
-- ============================================================
--
-- Desde la v168 (ventas) y la v180 (compras) el vencimiento se puede cargar desde
-- la pantalla, y EOS avisa de los cobros y los pagos vencidos. Pero por el chat no:
-- "le vendí a Carlos a crédito, me paga el 30" registraba la venta sin fecha, y el
-- aviso caía en el plazo de respaldo. Lo que la persona dice de viva voz se perdía.
--
-- ============================================================
-- POR QUÉ EL CHAT NO MANDA UNA FECHA
-- ============================================================
--
-- El modelo no sabe qué día es hoy (el prompt de sistema es idéntico para todos, a
-- propósito, para poder cachearlo). Pedirle que convierta "el 30" o "en 15 días" a
-- AAAA-MM-DD es pedirle que adivine el mes y el año, y un vencimiento equivocado es
-- peor que ninguno: dispara avisos falsos.
--
-- Así que el chat manda LO QUE LA PERSONA DIJO y la base hace la cuenta con la fecha
-- de Paraguay (`eos_hoy_py()`):
--
--   vence_dia      el día del mes ("me paga el 30" → 30). Es este mes si todavía no
--                  pasó; si ya pasó, el mes que viene. En un mes corto se usa el
--                  último día ("el 31" en febrero es el 28).
--   vence_en_dias  "en 15 días", "a 30 días" → hoy + N.
--   vence_el       una fecha completa AAAA-MM-DD, solo si la persona dijo el año.
--
-- Si no viene ninguno, la venta o la compra queda sin vencimiento, como siempre: no
-- se inventa un plazo.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
--   1. `eos_vencimiento_desde_datos_v182(datos, condicion)`: la cuenta de arriba. Al
--      contado devuelve nulo.
--   2. `eos_execute_internal_effect_v64`: la rama REGISTRAR_VENTA le pasa el
--      vencimiento a `eos_erp_registrar_venta` y lo devuelve en el resultado.
--   3. `eos_erp_registrar_compra_chat_v134`: lo mismo para las compras.
--
-- Las dos funciones salen de `pg_get_functiondef` de producción y no de las
-- migraciones del repo (la base va por delante: incluyen la v170 y la v175). Solo
-- cambian las líneas dichas arriba. Mismas firmas: no hay que borrar nada.
--
-- ORDEN: se aplica ANTES de que el prompt de n8n empiece a mandar estos campos. Al
-- revés, el ejecutor ignoraría el vencimiento sin avisar.

create or replace function public.eos_vencimiento_desde_datos_v182(p_datos jsonb, p_condicion text)
returns date
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_hoy date := public.eos_hoy_py();
  v_texto text;
  v_fecha date;
  v_dias integer;
  v_dia integer;
  v_inicio_mes date;
  v_ultimo_dia integer;
begin
  -- Un vencimiento solo tiene sentido a crédito.
  if p_condicion is distinct from 'credito' then
    return null;
  end if;

  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    return null;
  end if;

  -- 1. Una fecha completa que dijo la persona.
  v_texto := nullif(btrim(coalesce(p_datos ->> 'vence_el', '')), '');

  if v_texto ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      v_fecha := v_texto::date;
    exception when others then
      v_fecha := null; -- "2026-02-31": no existe, se descarta en vez de romper la venta.
    end;

    -- Una fecha absurda (año 1900, o dentro de treinta años) es un error de dictado.
    if v_fecha is not null and v_fecha between v_hoy - 3650 and v_hoy + 3650 then
      return v_fecha;
    end if;
  end if;

  -- 2. "En 15 días", "a 30 días".
  v_texto := nullif(btrim(coalesce(p_datos ->> 'vence_en_dias', '')), '');

  if v_texto ~ '^[0-9]{1,3}$' then
    v_dias := v_texto::integer;

    if v_dias between 0 and 365 then
      return v_hoy + v_dias;
    end if;
  end if;

  -- 3. "Me paga el 30": el día D del mes, este mes si todavía no pasó.
  v_texto := nullif(btrim(coalesce(p_datos ->> 'vence_dia', '')), '');

  if v_texto ~ '^[0-9]{1,2}$' then
    v_dia := v_texto::integer;

    if v_dia between 1 and 31 then
      v_inicio_mes := date_trunc('month', v_hoy)::date;
      v_ultimo_dia := extract(day from (v_inicio_mes + interval '1 month' - interval '1 day'))::integer;
      v_fecha := v_inicio_mes + (least(v_dia, v_ultimo_dia) - 1);

      if v_fecha >= v_hoy then
        return v_fecha;
      end if;

      -- Ya pasó este mes: el mes que viene (con el último día si el mes es más corto).
      v_inicio_mes := (v_inicio_mes + interval '1 month')::date;
      v_ultimo_dia := extract(day from (v_inicio_mes + interval '1 month' - interval '1 day'))::integer;
      return v_inicio_mes + (least(v_dia, v_ultimo_dia) - 1);
    end if;
  end if;

  return null;
end;
$function$;

comment on function public.eos_vencimiento_desde_datos_v182(jsonb, text) is
  'v182: traduce lo que la persona dijo por el chat (vence_dia, vence_en_dias o vence_el) a una fecha de vencimiento, con el día de hoy de Paraguay. Al contado, nulo.';

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
  v_alta jsonb;
  v_precio numeric;
  v_creados jsonb := '[]'::jsonb;
  v_sin_costo jsonb := '[]'::jsonb;
  v_titulo text;
  v_contenido text;
  v_clave text;
  v_importancia integer;
  v_memoria_previa uuid;
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
    'DECLARAR_SALDO', 'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA', 'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA', 'CORREGIR_VENTA',
    'ANULAR_COMPRA', 'CORREGIR_COMPRA'
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

    -- Un reintento del mismo comando no crea nada nuevo ni cuenta otra
    -- observación: o la memoria nació de este comando, o ya lo anotó en
    -- `metadata.comandos` cuando lo volvió a observar.
    select m.id into v_effect_id
    from public.eos_memory m
    where m.usuario_id = v_command.usuario_id
      and (
        m.action_command_id = v_command.id
        or jsonb_exists(m.metadata -> 'comandos', v_command.id::text)
      )
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_titulo := left(coalesce(nullif(btrim(v_data ->> 'titulo'), ''), 'Dato importante'), 180);
      v_contenido := coalesce(nullif(btrim(v_data ->> 'contenido'), ''), nullif(btrim(v_data ->> 'texto'), ''), nullif(btrim(v_data ->> 'descripcion'), ''), v_message);
      v_importancia := case
        when coalesce(v_data ->> 'importancia', '') ~ '^\d+$'
          then greatest(1, least(10, (v_data ->> 'importancia')::integer))
        else 5
      end;
      v_clave := lower(regexp_replace(btrim(v_titulo), '\s+', ' ', 'g'));

      -- Dos comandos simultáneos con el mismo título no se pisan: el segundo
      -- espera y ya encuentra la memoria que creó el primero.
      perform pg_advisory_xact_lock(
        hashtextextended('eos-memoria:' || v_command.usuario_id::text || ':' || v_clave, 0)
      );

      -- Solo memorias ACTIVAS: una que la persona archivó no se revive.
      select m.id into v_memoria_previa
      from public.eos_memory m
      where m.usuario_id = v_command.usuario_id
        and m.estado = 'activo'
        and lower(regexp_replace(btrim(m.titulo), '\s+', ' ', 'g')) = v_clave
      order by m.created_at
      limit 1;

      if v_memoria_previa is not null then
        -- Ya la sabía: se REOBSERVA en vez de duplicarla. Gana el dato más
        -- nuevo, y el anterior queda en metadata para poder ver qué cambió.
        update public.eos_memory m
        set contenido = case
              when v_contenido is not null and v_contenido is distinct from m.contenido then v_contenido
              else m.contenido
            end,
            importancia = greatest(m.importancia, v_importancia),
            observaciones = m.observaciones + 1,
            ultima_observacion_at = now(),
            updated_at = now(),
            metadata = m.metadata
              || case
                   when v_contenido is not null and v_contenido is distinct from m.contenido
                     then jsonb_build_object('contenido_anterior', m.contenido)
                   else '{}'::jsonb
                 end
              || jsonb_build_object(
                   'comandos',
                   case
                     when jsonb_array_length(coalesce(m.metadata -> 'comandos', '[]'::jsonb)) < 100
                       then coalesce(m.metadata -> 'comandos', '[]'::jsonb) || to_jsonb(v_command.id::text)
                     else m.metadata -> 'comandos'
                   end
                 )
        where m.id = v_memoria_previa
        returning m.id into v_effect_id;

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
          v_titulo,
          left(coalesce(nullif(btrim(v_data ->> 'categoria'), ''), 'general'), 80),
          v_contenido,
          v_importancia,
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

        /*
         * El precio que dijo la persona sirve para dos cosas: para la venta y,
         * si el producto no existe todavía, para poder crearlo. Ver la v156.
         */
        /*
         * `eos_leer_monto` y no una expresión regular propia.
         *
         * Con '[^0-9.]' —que es lo que este archivo tenía en su primera
         * versión— "185.000" queda en "185.000" y Postgres lo lee como 185.
         * Ciento ochenta y cinco guaraníes. Lo atajó el linter de migraciones
         * antes de llegar a la base; ver la v150, que existe por exactamente
         * este error.
         */
        v_precio := public.eos_leer_monto(v_item ->> 'precio_unitario');

        v_alta := public.eos_erp_resolver_o_crear_producto(
          v_command.usuario_id,
          v_command.id,
          v_texto,
          v_precio
        );

        v_producto_id := nullif(v_alta ->> 'producto_id', '')::uuid;

        if v_producto_id is null then
          raise exception 'EOS_ACCION_PRODUCTO_NO_RESUELTO: %', coalesce(v_texto, '(sin nombre)');
        end if;

        if coalesce((v_alta ->> 'creado')::boolean, false) then
          v_creados := v_creados || jsonb_build_array(
            jsonb_build_object(
              'nombre', v_alta ->> 'nombre',
              'precio_venta', (v_alta ->> 'precio_venta')::numeric
            )
          );
        end if;

        /*
         * Sin costo la venta entra igual y el margen queda pendiente.
         *
         * Es lo contrario de lo que hacía antes: un dato que sólo hace falta
         * para CALCULAR el margen no puede impedir que la venta exista. Se
         * anota cuáles son para poder decirlo en la respuesta, que es lo que
         * convierte un silencio en un pendiente.
         */
        if coalesce((v_alta ->> 'costo_pendiente')::boolean, false) then
          v_sin_costo := v_sin_costo || jsonb_build_array(v_alta ->> 'nombre');
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
        'Cargada por EOS desde la conversación.',
        -- Cuándo cobra, si la persona lo dijo (v182). Al contado no aplica.
        public.eos_vencimiento_desde_datos_v182(
          v_data,
          case when v_data ->> 'condicion' = 'credito' then 'credito' else 'contado' end
        )
      );

      v_effect_id := (v_rpc ->> 'venta_id')::uuid;

      update public.eos_erp_ventas
      set action_command_id = v_command.id
      where id = v_effect_id;

      -- Lo que el chat necesita para decir la verdad entera: cuánto fue, qué
      -- productos se crearon en el camino y de cuáles falta el costo.
      v_result := coalesce(v_result, '{}'::jsonb)
        || coalesce(v_rpc, '{}'::jsonb)
        || jsonb_build_object(
             'productos_creados', v_creados,
             'sin_costo', v_sin_costo,
             -- Para que la respuesta diga cuándo vence (v182).
             'condicion', case when v_data ->> 'condicion' = 'credito' then 'credito' else 'contado' end,
             'vence_el', (select v.vence_el from public.eos_erp_ventas v where v.id = v_effect_id)
           );
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

  elsif v_command.accion in ('REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA') then
    v_effect_type := case
      when v_command.accion = 'REGISTRAR_COBRO' then 'cobro' else 'pago_compra'
    end;

    /*
     * Las dos ramas son la misma con el signo cambiado, y por eso comparten
     * el cuerpo: cobrarle a un cliente y pagarle a un proveedor recorren la
     * misma cartera. Escribirlas separadas sería garantizar que dentro de un
     * mes una tenga un arreglo que la otra no.
     */
    select coalesce(m.venta_id, m.compra_id) into v_effect_id
    from public.eos_erp_cuenta_movimientos_v107 m
    where m.usuario_id = v_command.usuario_id
      and m.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_erp_cobranza_por_chat_v151(
        v_command.usuario_id,
        v_command.id,
        v_data,
        v_command.accion = 'REGISTRAR_COBRO'
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_TARJETA' then
    v_effect_type := 'tarjeta';

    /*
     * Como DECLARAR_SALDO: casi nunca crea, corrige una tarjeta que ya
     * estaba. La marca es `action_command_id` sobre la tarjeta.
     */
    select t.id into v_effect_id
    from public.eos_finanzas_tarjetas t
    where t.usuario_id = v_command.usuario_id
      and t.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_registrar_tarjeta_v153(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_COMPRA_TARJETA' then
    v_effect_type := 'compra_tarjeta';

    /*
     * Ésta SÍ crea una fila, y el reintento es caro: una compra en cuotas
     * duplicada mete seis vencimientos de más en el calendario y hace creer
     * que el mes no cierra.
     */
    select c.id into v_effect_id
    from public.eos_finanzas_tarjeta_compras c
    where c.usuario_id = v_command.usuario_id
      and c.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_finanzas_compra_tarjeta_v153(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'REGISTRAR_OPORTUNIDAD' then
    v_effect_type := 'oportunidad';

    /*
     * Crea o avanza, así que la marca vale para las dos cosas: si la fila
     * lleva este command_id, este comando ya pasó por acá. Sin eso, un
     * reintento sobre una oportunidad que se acaba de crear crearía la
     * segunda, y el embudo contaría dos veces la misma plata.
     */
    select o.id into v_effect_id
    from public.eos_crm_oportunidades o
    where o.usuario_id = v_command.usuario_id
      and o.action_command_id = v_command.id
    limit 1;

    if v_effect_id is not null then
      v_idempotent := true;
    else
      v_rpc := public.eos_crm_oportunidad_por_chat_v154(
        v_command.usuario_id,
        v_command.id,
        v_data
      );

      v_effect_id := (v_rpc ->> 'id')::uuid;
      v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;
    end if;

  elsif v_command.accion = 'ANULAR_VENTA' then
    v_effect_type := 'anulacion_venta';

    /*
     * La idempotencia vive adentro de la función, no acá.
     *
     * Las demás acciones marcan la fila que CREARON; ésta no crea ninguna,
     * anula una que ya existía. La marca es `anulada_por_command_id`, y
     * `eos_erp_anular_venta_por_chat_v161` la mira antes de resolver nada:
     * sin eso, un reintento resolvería "la más reciente" de nuevo y, como la
     * primera ya está anulada, anularía una venta buena.
     */
    v_rpc := public.eos_erp_anular_venta_por_chat_v161(
      v_command.usuario_id,
      v_command.id,
      nullif(btrim(coalesce(v_data ->> 'referencia', v_data ->> 'venta', '')), ''),
      nullif(btrim(coalesce(v_data ->> 'motivo', '')), '')
    );

    v_effect_id := (v_rpc ->> 'venta_id')::uuid;
    v_idempotent := coalesce((v_rpc ->> 'ya_estaba')::boolean, false);

    v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;


  elsif v_command.accion = 'CORREGIR_VENTA' then
    v_effect_type := 'correccion_venta';

    /*
     * La idempotencia vive adentro de la función, no acá.
     *
     * Corregir CREA una venta nueva —anula la vieja y registra otra— así que
     * un reintento sin marca resolvería la más reciente, que ahora es la
     * corregida, y la corregiría de nuevo: tres ventas donde había una. La
     * marca es action_command_id sobre la venta nueva, y la pone la función.
     */
    v_rpc := public.eos_erp_corregir_venta_por_chat_v162(
      v_command.usuario_id,
      v_command.id,
      nullif(btrim(coalesce(v_data ->> 'referencia', v_data ->> 'venta', '')), ''),
      nullif(btrim(coalesce(v_data ->> 'producto', '')), ''),
      public.eos_leer_monto(v_data ->> 'cantidad'),
      public.eos_leer_monto(v_data ->> 'precio_unitario'),
      nullif(btrim(coalesce(v_data ->> 'motivo', '')), '')
    );

    v_effect_id := (v_rpc ->> 'venta_id')::uuid;
    v_idempotent := coalesce((v_rpc ->> 'ya_estaba')::boolean, false);

    v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;

  elsif v_command.accion = 'ANULAR_COMPRA' then
    v_effect_type := 'anulacion_compra';

    /*
     * La idempotencia vive adentro de la función (anulada_por_command_id),
     * igual que en ANULAR_VENTA: un reintento resolvería "la más reciente" de
     * nuevo y, como la primera ya está anulada, anularía una compra buena.
     */
    v_rpc := public.eos_erp_anular_compra_por_chat_v170(
      v_command.usuario_id,
      v_command.id,
      nullif(btrim(coalesce(v_data ->> 'referencia', v_data ->> 'compra', '')), ''),
      nullif(btrim(coalesce(v_data ->> 'motivo', '')), '')
    );

    v_effect_id := (v_rpc ->> 'compra_id')::uuid;
    v_idempotent := coalesce((v_rpc ->> 'ya_estaba')::boolean, false);

    v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;

  elsif v_command.accion = 'CORREGIR_COMPRA' then
    v_effect_type := 'correccion_compra';

    /*
     * Corregir CREA una compra nueva (anula la vieja y registra otra): la
     * marca es action_command_id sobre la nueva, y la pone la función.
     */
    v_rpc := public.eos_erp_corregir_compra_por_chat_v170(
      v_command.usuario_id,
      v_command.id,
      nullif(btrim(coalesce(v_data ->> 'referencia', v_data ->> 'compra', '')), ''),
      nullif(btrim(coalesce(v_data ->> 'concepto', v_data ->> 'producto', '')), ''),
      public.eos_leer_monto(v_data ->> 'cantidad'),
      public.eos_leer_monto(v_data ->> 'precio_unitario'),
      nullif(btrim(coalesce(v_data ->> 'motivo', '')), '')
    );

    v_effect_id := (v_rpc ->> 'compra_id')::uuid;
    v_idempotent := coalesce((v_rpc ->> 'ya_estaba')::boolean, false);

    v_result := coalesce(v_result, '{}'::jsonb) || v_rpc;

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
    'executor_version', 'v170'
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

CREATE OR REPLACE FUNCTION public.eos_erp_registrar_compra_chat_v134(p_usuario_id uuid, p_command_id uuid, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    v_cantidad := public.eos_leer_monto(coalesce(v_item ->> 'cantidad', ''));
    if v_cantidad is null or v_cantidad <= 0 then v_cantidad := 1; end if;

    v_unitario := public.eos_leer_monto(coalesce(
      v_item ->> 'precio_unitario', v_item ->> 'costo_unitario', v_item ->> 'costo', ''
    ));

    v_total := public.eos_leer_monto(coalesce(
      v_item ->> 'total', v_item ->> 'monto', v_item ->> 'monto_total', ''
    ));

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
    nullif(btrim(coalesce(p_datos ->> 'notas', '')), ''),
    -- Cuándo hay que pagar, si la persona lo dijo (v182). Al contado no aplica.
    public.eos_vencimiento_desde_datos_v182(p_datos, v_condicion)
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
    'condicion', v_condicion,
    'vence_el', (select c.vence_el from public.eos_erp_compras c where c.id = v_compra_id),
    'sin_catalogo', v_sin_catalogo,
    'proveedor', case when v_proveedor is null then null else jsonb_build_object(
      'nombre', v_proveedor,
      'agendado', v_contacto is not null
    ) end
  );
end;
$function$;

-- Solo lo ejecutan las funciones del servidor: nada para anon ni para quien inicia sesión.
revoke all on function public.eos_vencimiento_desde_datos_v182(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.eos_vencimiento_desde_datos_v182(jsonb, text)
  to service_role, postgres;
