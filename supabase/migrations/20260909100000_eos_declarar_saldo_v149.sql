-- DECLARAR_SALDO: "tengo 3 millones en Ueno".
--
-- ============================================================
-- EL DATO DEL QUE DEPENDE TODO LO DEMÁS, Y EL ÚNICO QUE HABÍA QUE IR A CARGAR
-- ============================================================
--
-- El patrimonio, el disponible real, la cobertura del fondo de emergencia y
-- la línea de tiempo del panel arrancan todos del mismo número: cuánta plata
-- hay hoy, y desde qué fecha. Sin él, EOS proyecta sobre nada.
--
-- Hasta hoy ese número solo se cargaba por pantalla. Es el dato que más
-- cambia —cada vez que la persona mira su homebanking— y era el único que
-- obligaba a salir del chat. La doctrina del producto dice "EOS trabaja, el
-- usuario observa", y acá pasaba lo contrario justo donde más duele.
--
-- ============================================================
-- CREA LA CUENTA SI NO EXISTE, Y DICE QUE LA CREÓ
-- ============================================================
--
-- Alguien que dice "tengo 3 millones en Ueno" y no tiene cargada ninguna
-- cuenta Ueno está diciendo dos cosas: que la cuenta existe y cuánto tiene.
-- Mandarlo a la pantalla a crearla primero es pedirle el trabajo que este
-- verbo vino a sacarle.
--
-- Lo que NO se hace es adivinar qué clase de institución es. Por eso el tipo
-- 'otro' entra en esta migración: una cuenta creada desde el chat sin que la
-- persona haya dicho si es banco, cooperativa o billetera queda SIN
-- CLASIFICAR, y la pantalla lo muestra así.
--
-- Lo único que se deduce son palabras que la persona escribió: si dijo
-- "efectivo" el tipo es efectivo, si dijo "cooperativa" es cooperativa. Y las
-- billeteras grandes de Paraguay por su nombre de marca — saber que Tigo
-- Money es una billetera es un hecho del mundo, no un dato de esta persona, y
-- no altera ningún número: el tipo no entra en ningún cálculo, solo agrupa la
-- lista. Una tasa deducida sería lo contrario, y por eso ahí no se deduce
-- nada nunca.
--
-- ============================================================
-- NOMBRE EXACTO PRIMERO, Y SI HAY DOS PARECIDAS NO ELIGE
-- ============================================================
--
-- Escribir un saldo en la cuenta equivocada deja mal el patrimonio, el
-- disponible y la cobertura a la vez, y no se ve: los dos números quedan
-- plausibles. Distinto de una transferencia, que guarda los nombres como
-- texto y se relee.
--
-- Por eso: coincidencia exacta gana siempre. Si no hay exacta y hay más de
-- una parecida, no elige — devuelve las dos y pregunta. Es la única acción
-- del sistema que se niega a desempatar sola.
--
-- ============================================================
-- LA MONEDA SALE DE LA CUENTA, NO DE UNA SUPOSICIÓN
-- ============================================================
--
-- "Tengo 3 millones en Ueno" sobre una cuenta en dólares sería ₲ 3.000.000
-- escritos como US$ 3.000.000. Si la persona no dice la moneda, se usa la de
-- la cuenta que ya existe —es la mejor evidencia disponible— y la
-- confirmación la dice siempre, formateada, para que un error se vea en el
-- mismo mensaje.
--
-- Si la persona SÍ dice la moneda, la búsqueda filtra por ella: una cuenta en
-- guaraníes y otra en dólares en el mismo banco son dos cuentas.

-- ============================================================
-- 1) El tipo 'otro', para no tener que inventar uno
-- ============================================================

alter table public.eos_finanzas_cuentas
  drop constraint if exists eos_finanzas_cuentas_tipo_check;

alter table public.eos_finanzas_cuentas
  add constraint eos_finanzas_cuentas_tipo_check
  check (tipo = any (array[
    'banco', 'cooperativa', 'financiera', 'billetera', 'efectivo',
    'tarjeta_credito', 'otro'
  ]));

comment on column public.eos_finanzas_cuentas.tipo is
  'Que clase de cuenta es. Solo agrupa la lista: no entra en ningun calculo. "otro" es lo que queda cuando la persona declaro un saldo por chat sin decir de que institucion, y se prefiere a suponer.';

-- ============================================================
-- 2) De qué comando vino el último saldo
-- ============================================================
--
-- Es la marca de idempotencia. Declarar un saldo no crea una fila —casi
-- siempre actualiza una que ya estaba— así que "existe algo con este
-- command_id" no sirve como en las demás acciones.
--
-- Sin la marca, un reintento no rompería el saldo (escribir 3.000.000 dos
-- veces da 3.000.000) pero sí volvería a informar el saldo anterior como si
-- fuera nuevo, y la persona leería dos veces "pasó de 1.200.000 a 3.000.000"
-- cuando la segunda vez ya venía de 3.000.000.

alter table public.eos_finanzas_cuentas
  add column if not exists declarado_por_command_id uuid;

comment on column public.eos_finanzas_cuentas.declarado_por_command_id is
  'El comando de chat que escribio el saldo declarado actual. Marca de idempotencia: un reintento se reconoce a si mismo.';

create index if not exists eos_cuentas_command_idx
  on public.eos_finanzas_cuentas (declarado_por_command_id)
  where declarado_por_command_id is not null;

-- ============================================================
-- 3) La acción, en los tres check
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
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO'
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
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO'
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
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO'
  ]));

-- ============================================================
-- 4) La función
-- ============================================================

create or replace function public.eos_finanzas_declarar_saldo_v149(
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
  v_nombre text;
  v_saldo numeric;
  v_moneda text;
  v_tipo text;
  v_tipo_dicho text;
  v_fecha date;
  v_hoy date;
  v_cuenta public.eos_finanzas_cuentas%rowtype;
  v_parecidas text;
  v_cuantas integer := 0;
  v_id uuid;
begin
  v_hoy := (now() at time zone 'America/Asuncion')::date;

  v_nombre := nullif(btrim(coalesce(
    p_datos ->> 'cuenta', p_datos ->> 'nombre', p_datos ->> 'donde', ''
  )), '');

  if v_nombre is null then
    raise exception 'EOS_ACCION_SALDO_SIN_CUENTA';
  end if;

  -- El saldo se lee tal cual: cero es un dato ("no me queda nada en el
  -- banco") y por eso no se confunde con ausente. Lo ausente es null.
  v_saldo := nullif(regexp_replace(coalesce(
    p_datos ->> 'saldo', p_datos ->> 'monto', p_datos ->> 'tengo', ''
  ), '[^0-9.]', '', 'g'), '')::numeric;

  if v_saldo is null then
    raise exception 'EOS_ACCION_SALDO_SIN_MONTO: %', v_nombre;
  end if;

  if v_saldo < 0 then
    raise exception 'EOS_ACCION_SALDO_NEGATIVO';
  end if;

  v_moneda := upper(nullif(btrim(coalesce(p_datos ->> 'moneda', '')), ''));
  if v_moneda is not null and length(v_moneda) <> 3 then
    v_moneda := null;
  end if;

  v_fecha := case
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'fecha')::date
    else v_hoy
  end;

  /*
   * Un saldo con fecha futura rompe el arrastre: el panel le suma los
   * movimientos POSTERIORES a la fecha declarada, y si la fecha todavía no
   * llegó no hay ninguno que sumar. Mostraría como saldo de hoy una plata que
   * la persona dijo que va a tener.
   */
  if v_fecha > v_hoy then
    v_fecha := v_hoy;
  end if;

  -- ---------------------------------------------------------------
  -- ¿A qué cuenta va?
  -- ---------------------------------------------------------------

  -- Exacta primero, y gana aunque haya parecidas: quien tiene "Ueno" y
  -- "Financiera Ueno" y escribe "Ueno" se refiere a la que se llama así.
  select * into v_cuenta
  from public.eos_finanzas_cuentas c
  where c.usuario_id = p_usuario_id
    and c.ambito = 'personal'
    and c.activa
    and lower(c.nombre) = lower(v_nombre)
    and (v_moneda is null or c.moneda = v_moneda)
  order by c.created_at
  limit 1;

  if v_cuenta.id is null then
    select count(*) into v_cuantas
    from public.eos_finanzas_cuentas c
    where c.usuario_id = p_usuario_id
      and c.ambito = 'personal'
      and c.activa
      and (v_moneda is null or c.moneda = v_moneda)
      and (lower(c.nombre) like '%' || lower(v_nombre) || '%'
           or lower(coalesce(c.institucion, '')) like '%' || lower(v_nombre) || '%');

    /*
     * Con más de una parecida NO se elige.
     *
     * Es la única acción del sistema que se niega a desempatar sola, y es a
     * propósito: un saldo escrito en la cuenta equivocada deja mal el
     * patrimonio, el disponible y la cobertura al mismo tiempo, y los dos
     * números quedan plausibles. Nadie lo descubre mirando.
     */
    if v_cuantas > 1 then
      select string_agg(c.nombre, ', ' order by c.nombre) into v_parecidas
      from public.eos_finanzas_cuentas c
      where c.usuario_id = p_usuario_id
        and c.ambito = 'personal'
        and c.activa
        and (v_moneda is null or c.moneda = v_moneda)
        and (lower(c.nombre) like '%' || lower(v_nombre) || '%'
             or lower(coalesce(c.institucion, '')) like '%' || lower(v_nombre) || '%');

      raise exception 'EOS_ACCION_CUENTA_AMBIGUA: %', v_parecidas;
    end if;

    if v_cuantas = 1 then
      select * into v_cuenta
      from public.eos_finanzas_cuentas c
      where c.usuario_id = p_usuario_id
        and c.ambito = 'personal'
        and c.activa
        and (v_moneda is null or c.moneda = v_moneda)
        and (lower(c.nombre) like '%' || lower(v_nombre) || '%'
             or lower(coalesce(c.institucion, '')) like '%' || lower(v_nombre) || '%')
      limit 1;
    end if;
  end if;

  -- ---------------------------------------------------------------
  -- Idempotencia: ¿este mismo comando ya escribió acá?
  -- ---------------------------------------------------------------
  if v_cuenta.id is not null and v_cuenta.declarado_por_command_id = p_command_id then
    return jsonb_build_object(
      'id', v_cuenta.id,
      'cuenta', v_cuenta.nombre,
      'tipo', v_cuenta.tipo,
      'moneda', v_cuenta.moneda,
      'saldo', v_cuenta.saldo_declarado,
      'fecha', v_cuenta.saldo_declarado_el,
      'creada', false,
      'repetida', true
    );
  end if;

  -- ---------------------------------------------------------------
  -- El tipo, solo de lo que la persona dijo
  -- ---------------------------------------------------------------
  v_tipo_dicho := lower(coalesce(p_datos ->> 'tipo', '') || ' ' || v_nombre);

  v_tipo := case
    when v_tipo_dicho ~ '(efectivo|en mano|caj[oó]n|caja chica)' then 'efectivo'
    when v_tipo_dicho ~ '(billetera|tigo money|personal pay|zimple|wally)' then 'billetera'
    when v_tipo_dicho ~ '(cooperativa|coomecipar|copacons)' then 'cooperativa'
    when v_tipo_dicho ~ 'financiera' then 'financiera'
    when v_tipo_dicho ~ 'banco' then 'banco'
    -- Lo demás queda sin clasificar. Suponer 'banco' sería inventar un dato
    -- de esta persona para llenar una columna que no calcula nada.
    else 'otro'
  end;

  if v_cuenta.id is null then
    insert into public.eos_finanzas_cuentas (
      usuario_id, ambito, nombre, tipo, moneda,
      saldo_declarado, saldo_declarado_el, recibe_avisos, activa,
      declarado_por_command_id
    ) values (
      p_usuario_id, 'personal', left(v_nombre, 80), v_tipo,
      coalesce(v_moneda, 'PYG'),
      v_saldo, v_fecha, false, true,
      p_command_id
    )
    returning id into v_id;

    select * into v_cuenta
    from public.eos_finanzas_cuentas where id = v_id;

    return jsonb_build_object(
      'id', v_cuenta.id,
      'cuenta', v_cuenta.nombre,
      'tipo', v_cuenta.tipo,
      -- Que la pantalla tenga que clasificarla no es un error: es lo que se
      -- evitó inventar, y la confirmación lo ofrece en una línea.
      'sin_clasificar', v_cuenta.tipo = 'otro',
      'moneda', v_cuenta.moneda,
      'saldo', v_saldo,
      'fecha', v_fecha,
      'creada', true,
      'repetida', false
    );
  end if;

  update public.eos_finanzas_cuentas
  set saldo_declarado = v_saldo,
      saldo_declarado_el = v_fecha,
      -- El tipo solo se completa, nunca se pisa: si la persona ya lo eligió
      -- en la pantalla, una deducción del chat no tiene por qué ganarle.
      tipo = case when tipo = 'otro' and v_tipo <> 'otro' then v_tipo else tipo end,
      declarado_por_command_id = p_command_id,
      updated_at = now()
  where id = v_cuenta.id;

  return jsonb_build_object(
    'id', v_cuenta.id,
    'cuenta', v_cuenta.nombre,
    'tipo', v_cuenta.tipo,
    'moneda', v_cuenta.moneda,
    'saldo', v_saldo,
    'fecha', v_fecha,
    /*
     * Lo que había antes viaja en la respuesta y NO se guarda.
     *
     * No se guarda porque un saldo declarado está hecho para cambiar: cada
     * vez que la persona mira su homebanking hay uno nuevo, y guardar el
     * anterior sería un historial que nadie lee. Distinto de una corrección,
     * donde el valor viejo es la única prueba de que EOS entendió mal.
     *
     * Viaja porque es lo que permite ver que EOS escribió en la cuenta
     * equivocada: "Ueno pasó de 1.200.000 a 3.000.000" sobre una cuenta que
     * la persona sabe que tenía otra cosa se nota en el acto.
     */
    'antes', v_cuenta.saldo_declarado,
    'antes_el', v_cuenta.saldo_declarado_el,
    'creada', false,
    'repetida', false
  );
end;
$function$;

revoke all on function public.eos_finanzas_declarar_saldo_v149(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_finanzas_declarar_saldo_v149(uuid, uuid, jsonb) to service_role;

comment on function public.eos_finanzas_declarar_saldo_v149(uuid, uuid, jsonb) is
  'v149: escribe el saldo declarado de una cuenta personal desde el chat, y la crea si no existe. Coincidencia exacta gana; con dos parecidas no elige, pregunta. No supone el tipo de institucion: sin evidencia queda otro.';
