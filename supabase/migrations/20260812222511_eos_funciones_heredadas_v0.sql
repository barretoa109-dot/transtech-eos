-- ============================================================
-- v0 · Nueve funciones que tampoco existían en el repositorio
-- ============================================================
--
-- El esquema base (20260801000000) cubrió las tablas huérfanas. Al aplicar
-- las migraciones desde cero contra esa base apareció la misma clase de
-- problema en las funciones: commercial_rpc_hardening_v16 hace
-- `revoke ... on function public.asignar_plan_eos(...)`, y esa función no
-- la crea ninguna migración.
--
-- CUATRO DE ELLAS SE CREAN CON SU NOMBRE ORIGINAL, NO CON _internal_v1
--
-- commercial_rpc_hardening_v16 no sólo usa eos_suscripcion_vigente,
-- tiene_permiso_eos, obtener_estado_comercial_eos y registrar_consumo_eos:
-- los RENOMBRA a su sufijo _internal_v1 y crea una versión nueva bajo el
-- nombre corto. Para que ese `alter function ... rename to` tenga algo que
-- renombrar, acá se crean con el nombre de ANTES del rename. El cuerpo no
-- se toca —una función renombrada conserva el texto con el que se escribió,
-- así que sigue llamando a sus pares por el nombre corto— y eso es lo que
-- reveló el error real: `tiene_permiso_eos_internal_v1` es LANGUAGE sql, que
-- valida su cuerpo al crearse (a diferencia de plpgsql, que lo hace recién
-- al llamarla), y su cuerpo llama a `eos_suscripcion_vigente` sin sufijo.
-- Crear la función ya renombrada habría dejado esa llamada apuntando a un
-- nombre que en ese momento no existe.
--
-- HANDLE_NEW_USER ES UN STUB A PROPÓSITO
--
-- commercial_rpc_hardening_v16 también le hace revoke/grant, pero su cuerpo
-- real —el que procesa el alta de un usuario nuevo— llega recién con
-- signup_plan_server_owned_v63, más adelante en el historial. Acá se pone
-- un no-op que sólo devuelve la fila: en una reconstrucción no hay altas
-- reales entre una migración y la otra, así que el comportamiento real de
-- la función nunca llega a importar antes de que la sobreescriban del todo.
--
-- El resto —asignar_plan_eos, eos_actualizar_updated_at, eos_periodo_actual,
-- rls_auto_enable— no tiene ninguno de estos dos problemas y se crea tal
-- cual está en producción.
--
-- El cuerpo de cada una es exactamente `pg_get_functiondef()` sobre la
-- función en producción: no está escrito a mano ni reconstruido de memoria.
--
-- Va justo antes de la primera migración que las toca
-- (commercial_rpc_hardening_v16), no en el esquema base: crear funciones no
-- tiene el problema de orden que tienen las tablas —no hace falta que
-- existan antes que nada más—, así que no hacía falta forzarlas al
-- principio de todo.

-- asignar_plan_eos
CREATE OR REPLACE FUNCTION public.asignar_plan_eos(p_usuario_id uuid, p_plan_codigo text, p_duracion_dias integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan_codigo text;
begin
  select codigo
  into v_plan_codigo
  from public.planes
  where codigo = lower(
    trim(p_plan_codigo)
  )
    and activo = true
  limit 1;

  if v_plan_codigo is null then
    raise exception
      'El plan indicado no existe o está inactivo.';
  end if;

  update public.usuarios
  set
    plan = v_plan_codigo,
    estado_suscripcion = 'active',
    plan_inicio = now(),

    plan_vencimiento =
      case
        when v_plan_codigo = 'free'
          then null
        when p_duracion_dias is null
          then null
        else now() + make_interval(
          days => p_duracion_dias
        )
      end,

    proveedor_pago = 'manual',

    ultimo_pago =
      case
        when v_plan_codigo = 'free'
          then ultimo_pago
        else now()
      end,

    cancelar_al_vencimiento = false,
    updated_at = now()
  where id = p_usuario_id;

  if not found then
    raise exception
      'No se encontró el usuario indicado.';
  end if;

  insert into public.uso_mensual (
    usuario_id,
    periodo
  )
  values (
    p_usuario_id,
    public.eos_periodo_actual()
  )
  on conflict (usuario_id, periodo)
  do nothing;

  return public.obtener_estado_comercial_eos(
    p_usuario_id
  );
end;
$function$;

-- eos_actualizar_updated_at
CREATE OR REPLACE FUNCTION public.eos_actualizar_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- eos_periodo_actual
CREATE OR REPLACE FUNCTION public.eos_periodo_actual()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select to_char(
    now() at time zone 'America/Asuncion',
    'YYYY-MM'
  );
$function$;

-- rls_auto_enable
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- eos_suscripcion_vigente (nombre original, antes del rename de v16)
CREATE OR REPLACE FUNCTION public.eos_suscripcion_vigente(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (
      select
        coalesce(u.estado_suscripcion, 'active') = 'active'
        and (
          u.plan_vencimiento is null
          or u.plan_vencimiento > now()
        )
      from public.usuarios u
      where u.id = p_usuario_id
      limit 1
    ),
    false
  );
$function$;

-- tiene_permiso_eos (nombre original, antes del rename de v16)
CREATE OR REPLACE FUNCTION public.tiene_permiso_eos(p_usuario_id uuid, p_funcion_codigo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.eos_suscripcion_vigente(p_usuario_id)
    and exists (
      select 1
      from public.usuarios u
      join public.planes p
        on p.codigo = lower(
          coalesce(u.plan, 'free')
        )
      join public.permisos_plan pp
        on pp.plan_id = p.id
      join public.funciones_eos f
        on f.id = pp.funcion_id
      where u.id = p_usuario_id
        and p.activo = true
        and f.activo = true
        and pp.habilitado = true
        and f.codigo = lower(
          trim(p_funcion_codigo)
        )
    );
$function$;

-- obtener_estado_comercial_eos (nombre original, antes del rename de v16)
CREATE OR REPLACE FUNCTION public.obtener_estado_comercial_eos(p_usuario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_resultado jsonb;
  v_periodo text;
begin
  v_periodo := public.eos_periodo_actual();

  if not exists (
    select 1
    from public.usuarios
    where id = p_usuario_id
  ) then
    raise exception
      'No se encontró el usuario indicado.';
  end if;

  -- Garantizar el registro del mes actual.
  insert into public.uso_mensual (
    usuario_id,
    periodo
  )
  values (
    p_usuario_id,
    v_periodo
  )
  on conflict (usuario_id, periodo)
  do nothing;

  select jsonb_build_object(
    'usuario_id', u.id,
    'nombre', u.nombre,
    'email', u.email,
    'whatsapp', u.whatsapp,

    'plan', p.codigo,
    'plan_nombre', p.nombre,
    'descripcion_plan', p.descripcion,

    'estado_suscripcion',
      coalesce(u.estado_suscripcion, 'active'),

    'suscripcion_vigente',
      public.eos_suscripcion_vigente(u.id),

    'plan_inicio', u.plan_inicio,
    'plan_vencimiento', u.plan_vencimiento,
    'proveedor_pago', u.proveedor_pago,
    'cancelar_al_vencimiento',
      coalesce(u.cancelar_al_vencimiento, false),

    'precios', jsonb_build_object(
      'mensual_pyg', p.precio_mensual_pyg,
      'anual_pyg', p.precio_anual_pyg,
      'mensual_usd', p.precio_mensual_usd,
      'anual_usd', p.precio_anual_usd
    ),

    'limites', jsonb_build_object(
      'mensajes', p.limite_mensajes,
      'excel', p.limite_excel,
      'pdf', p.limite_pdf,
      'automatizaciones',
        p.limite_automatizaciones,
      'usuarios', p.limite_usuarios,
      'memoria_dias', p.memoria_dias
    ),

    'uso', jsonb_build_object(
      -- Free utiliza mensajes totales.
      -- Los demás planes utilizan consumo mensual.
      'mensajes',
        case
          when p.codigo = 'free' then (
            select coalesce(
              sum(um_total.mensajes_usados),
              0
            )
            from public.uso_mensual um_total
            where um_total.usuario_id = u.id
          )
          else coalesce(
            um.mensajes_usados,
            0
          )
        end,

      'excel',
        coalesce(um.excel_generados, 0),

      'pdf',
        coalesce(um.pdf_generados, 0),

      'automatizaciones',
        coalesce(
          um.automatizaciones_ejecutadas,
          0
        ),

      'tokens_entrada',
        coalesce(um.tokens_entrada, 0),

      'tokens_salida',
        coalesce(um.tokens_salida, 0),

      'costo_estimado_usd',
        coalesce(um.costo_estimado_usd, 0)
    ),

    'disponibilidad', jsonb_build_object(
      'puede_enviar_mensajes',
        public.eos_suscripcion_vigente(u.id)
        and
        case
          when p.limite_mensajes is null then true

          when p.codigo = 'free' then (
            select coalesce(
              sum(um_total.mensajes_usados),
              0
            )
            from public.uso_mensual um_total
            where um_total.usuario_id = u.id
          ) < p.limite_mensajes

          else coalesce(
            um.mensajes_usados,
            0
          ) < p.limite_mensajes
        end,

      'puede_generar_excel',
        public.eos_suscripcion_vigente(u.id)
        and public.tiene_permiso_eos(
          u.id,
          'excel'
        )
        and
        case
          when p.limite_excel is null then true
          else coalesce(
            um.excel_generados,
            0
          ) < p.limite_excel
        end,

      'puede_generar_pdf',
        public.eos_suscripcion_vigente(u.id)
        and public.tiene_permiso_eos(
          u.id,
          'pdf'
        )
        and
        case
          when p.limite_pdf is null then true
          else coalesce(
            um.pdf_generados,
            0
          ) < p.limite_pdf
        end,

      'puede_automatizar',
        public.eos_suscripcion_vigente(u.id)
        and public.tiene_permiso_eos(
          u.id,
          'automatizaciones'
        )
        and
        case
          when p.limite_automatizaciones
            is null
            then true
          else coalesce(
            um.automatizaciones_ejecutadas,
            0
          ) < p.limite_automatizaciones
        end
    ),

    'permisos',
      coalesce(
        (
          select jsonb_agg(
            f.codigo
            order by f.codigo
          )
          from public.permisos_plan pp
          join public.funciones_eos f
            on f.id = pp.funcion_id
          where pp.plan_id = p.id
            and pp.habilitado = true
            and f.activo = true
        ),
        '[]'::jsonb
      ),

    'periodo', v_periodo,
    'prioridad', p.prioridad
  )
  into v_resultado
  from public.usuarios u
  join public.planes p
    on p.codigo = lower(
      coalesce(u.plan, 'free')
    )
  left join public.uso_mensual um
    on um.usuario_id = u.id
    and um.periodo = v_periodo
  where u.id = p_usuario_id
  limit 1;

  if v_resultado is null then
    raise exception
      'El usuario no tiene un plan válido asociado.';
  end if;

  return v_resultado;
end;
$function$;

-- registrar_consumo_eos (nombre original, antes del rename de v16)
CREATE OR REPLACE FUNCTION public.registrar_consumo_eos(p_usuario_id uuid, p_tipo text, p_cantidad integer DEFAULT 1, p_tokens_entrada bigint DEFAULT 0, p_tokens_salida bigint DEFAULT 0, p_costo_estimado_usd numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tipo text;
  v_periodo text;
  v_plan public.planes%rowtype;
  v_uso public.uso_mensual%rowtype;
  v_mensajes_actuales bigint;
begin
  v_tipo := lower(trim(p_tipo));
  v_periodo := public.eos_periodo_actual();

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception
      'La cantidad debe ser mayor que cero.';
  end if;

  if v_tipo not in (
    'mensaje',
    'excel',
    'pdf',
    'automatizacion'
  ) then
    raise exception
      'Tipo de consumo no válido: %',
      p_tipo;
  end if;

  if not public.eos_suscripcion_vigente(
    p_usuario_id
  ) then
    raise exception
      'La suscripción del usuario no está activa.';
  end if;

  select p.*
  into v_plan
  from public.usuarios u
  join public.planes p
    on p.codigo = lower(
      coalesce(u.plan, 'free')
    )
  where u.id = p_usuario_id
    and p.activo = true
  limit 1;

  if v_plan.id is null then
    raise exception
      'El usuario no tiene un plan válido.';
  end if;

  insert into public.uso_mensual (
    usuario_id,
    periodo
  )
  values (
    p_usuario_id,
    v_periodo
  )
  on conflict (usuario_id, periodo)
  do nothing;

  select *
  into v_uso
  from public.uso_mensual
  where usuario_id = p_usuario_id
    and periodo = v_periodo
  for update;

  -- ==========================================================
  -- VALIDAR MENSAJES
  -- ==========================================================

  if v_tipo = 'mensaje' then
    if v_plan.codigo = 'free' then
      select coalesce(
        sum(mensajes_usados),
        0
      )
      into v_mensajes_actuales
      from public.uso_mensual
      where usuario_id = p_usuario_id;
    else
      v_mensajes_actuales :=
        coalesce(v_uso.mensajes_usados, 0);
    end if;

    if v_plan.limite_mensajes is not null
       and (
         v_mensajes_actuales + p_cantidad
       ) > v_plan.limite_mensajes then
      raise exception
        'El usuario alcanzó el límite de mensajes de su plan.';
    end if;
  end if;

  -- ==========================================================
  -- VALIDAR EXCEL
  -- ==========================================================

  if v_tipo = 'excel' then
    if not public.tiene_permiso_eos(
      p_usuario_id,
      'excel'
    ) then
      raise exception
        'El plan del usuario no permite generar Excel.';
    end if;

    if v_plan.limite_excel is not null
       and (
         v_uso.excel_generados + p_cantidad
       ) > v_plan.limite_excel then
      raise exception
        'El usuario alcanzó el límite mensual de Excel.';
    end if;
  end if;

  -- ==========================================================
  -- VALIDAR PDF
  -- ==========================================================

  if v_tipo = 'pdf' then
    if not public.tiene_permiso_eos(
      p_usuario_id,
      'pdf'
    ) then
      raise exception
        'El plan del usuario no permite generar PDF.';
    end if;

    if v_plan.limite_pdf is not null
       and (
         v_uso.pdf_generados + p_cantidad
       ) > v_plan.limite_pdf then
      raise exception
        'El usuario alcanzó el límite mensual de PDF.';
    end if;
  end if;

  -- ==========================================================
  -- VALIDAR AUTOMATIZACIONES
  -- ==========================================================

  if v_tipo = 'automatizacion' then
    if not public.tiene_permiso_eos(
      p_usuario_id,
      'automatizaciones'
    ) then
      raise exception
        'El plan del usuario no permite automatizaciones.';
    end if;

    if v_plan.limite_automatizaciones
       is not null
       and (
         v_uso.automatizaciones_ejecutadas
         + p_cantidad
       ) > v_plan.limite_automatizaciones then
      raise exception
        'El usuario alcanzó el límite mensual de automatizaciones.';
    end if;
  end if;

  -- ==========================================================
  -- REGISTRAR EL CONSUMO
  -- ==========================================================

  update public.uso_mensual
  set
    mensajes_usados =
      mensajes_usados +
      case
        when v_tipo = 'mensaje'
        then p_cantidad
        else 0
      end,

    excel_generados =
      excel_generados +
      case
        when v_tipo = 'excel'
        then p_cantidad
        else 0
      end,

    pdf_generados =
      pdf_generados +
      case
        when v_tipo = 'pdf'
        then p_cantidad
        else 0
      end,

    automatizaciones_ejecutadas =
      automatizaciones_ejecutadas +
      case
        when v_tipo = 'automatizacion'
        then p_cantidad
        else 0
      end,

    tokens_entrada =
      tokens_entrada +
      greatest(
        coalesce(p_tokens_entrada, 0),
        0
      ),

    tokens_salida =
      tokens_salida +
      greatest(
        coalesce(p_tokens_salida, 0),
        0
      ),

    costo_estimado_usd =
      costo_estimado_usd +
      greatest(
        coalesce(p_costo_estimado_usd, 0),
        0
      ),

    updated_at = now()
  where usuario_id = p_usuario_id
    and periodo = v_periodo;

  return public.obtener_estado_comercial_eos(
    p_usuario_id
  );
end;
$function$;

-- handle_new_user (stub — se reemplaza por completo más adelante)
--
-- v16 sólo le hace revoke/grant; el cuerpo real que procesa el alta llega
-- con signup_plan_server_owned_v63, unas horas después en el historial
-- original. Durante una reconstrucción no hay altas reales en el medio,
-- así que un no-op es seguro: existe, no hace nada, y se sobreescribe
-- antes de que a alguien le importe su comportamiento.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  return new;
end;
$function$;
