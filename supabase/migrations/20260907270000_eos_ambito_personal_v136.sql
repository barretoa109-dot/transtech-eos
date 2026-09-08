-- Separar la plata del negocio de la plata de la persona.
--
-- ============================================================
-- HOY ESTÁN EN LA MISMA TABLA, Y ESO YA SE VE
-- ============================================================
--
-- `eos_movimientos_financieros` recibe las dos cosas. Lo escribe la persona
-- cuando anota "gasté 50 mil en nafta" desde Gastos, y lo escribe el ERP cada
-- vez que se registra una venta o una compra.
--
-- El resultado se vio el 7 de septiembre de 2026, a los diez minutos de que
-- REGISTRAR_COMPRA empezara a funcionar: los ₲ 2.638.000 de lechones,
-- balanceado y combustible de un negocio de porcicultura aterrizaron en el
-- mismo panel que contesta "¿estoy bien?" sobre las finanzas de la persona.
-- Ese panel calcula disponible real, colchón y objetivos personales; con la
-- inversión de un negocio adentro, la respuesta que da es sobre una mezcla que
-- no le pasa a nadie.
--
-- Y al revés también: el sueldo de la persona no es un ingreso del negocio, y
-- sumarlo al resultado del mes infla un margen que nadie ganó.
--
-- ============================================================
-- UN TRIGGER Y NO TRES FUNCIONES REESCRITAS
-- ============================================================
--
-- Los movimientos del negocio los insertan tres funciones distintas
-- —`eos_erp_registrar_venta`, `eos_erp_registrar_compra` y la de cuenta
-- corriente— y va a haber más. Agregarles la columna a mano a las tres
-- significa que la cuarta se olvida, y un movimiento del negocio contado como
-- personal no se ve: simplemente el disponible real da menos.
--
-- La regla es verdadera por construcción: si `origen = 'erp'`, es del negocio.
-- Escrita una vez, en un trigger, vale también para lo que se escriba mañana.
--
-- ============================================================
-- EL DEFAULT ES 'personal', A PROPÓSITO
-- ============================================================
--
-- Lo que no viene del ERP es de la persona: el gasto rápido, el correo del
-- banco, el documento reenviado. Si algún día una vía nueva es del negocio,
-- que falle del lado seguro —aparecer en el panel personal y que alguien lo
-- note— antes que desaparecer del panel donde tenía que estar.

-- ============================================================
-- 1) La columna, en las dos tablas que reciben las dos cosas
-- ============================================================

alter table public.eos_movimientos_financieros
  add column if not exists ambito text not null default 'personal';

alter table public.eos_movimientos_financieros
  drop constraint if exists eos_movimientos_ambito_check;

alter table public.eos_movimientos_financieros
  add constraint eos_movimientos_ambito_check
  check (ambito in ('negocio', 'personal'));

alter table public.eos_finanzas_fijos
  add column if not exists ambito text not null default 'personal';

alter table public.eos_finanzas_fijos
  drop constraint if exists eos_fijos_ambito_check;

alter table public.eos_finanzas_fijos
  add constraint eos_fijos_ambito_check
  check (ambito in ('negocio', 'personal'));

-- Los dos paneles filtran por ámbito en cada consulta, así que el índice va
-- por ahí y no por usuario solo.
create index if not exists eos_movimientos_ambito_idx
  on public.eos_movimientos_financieros (usuario_id, ambito, fecha desc);

create index if not exists eos_fijos_ambito_idx
  on public.eos_finanzas_fijos (usuario_id, ambito) where activo;

-- ============================================================
-- 2) Lo que ya estaba escrito
-- ============================================================
--
-- Todo lo que entró por el ERP es del negocio. Es determinista: `origen` lo
-- viene marcando desde la v51.

update public.eos_movimientos_financieros
set ambito = 'negocio'
where origen = 'erp' and ambito <> 'negocio';

-- ============================================================
-- 3) La regla, escrita una sola vez
-- ============================================================

create or replace function public.eos_ambito_del_movimiento()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- Un movimiento que nace del ERP es del negocio, lo pida quien lo pida. No
  -- se acepta que el llamador diga otra cosa: si viene de una venta o de una
  -- compra, es del negocio por definición, y dejar que se pueda marcar como
  -- personal abre la puerta a que el resultado del mes y el disponible real de
  -- la persona se contaminen entre sí sin que nadie lo note.
  if new.origen = 'erp' then
    new.ambito := 'negocio';
  end if;

  if new.ambito is null then
    new.ambito := 'personal';
  end if;

  return new;
end;
$function$;

drop trigger if exists eos_ambito_del_movimiento_trg on public.eos_movimientos_financieros;

create trigger eos_ambito_del_movimiento_trg
  before insert or update of origen, ambito on public.eos_movimientos_financieros
  for each row
  execute function public.eos_ambito_del_movimiento();

comment on function public.eos_ambito_del_movimiento() is
  'v136: un movimiento con origen erp es del negocio, siempre. Escrito en un trigger para que valga también para las funciones que se escriban después.';

-- ============================================================
-- 4) La acción del chat para la plata de la persona
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
    'REGISTRAR_MOVIMIENTO_PERSONAL'
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
    'REGISTRAR_MOVIMIENTO_PERSONAL'
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
    'REGISTRAR_MOVIMIENTO_PERSONAL'
  ]));

alter table public.eos_movimientos_financieros
  add column if not exists action_command_id uuid
    references public.eos_action_commands (id) on delete set null;

create index if not exists eos_movimientos_action_command_idx
  on public.eos_movimientos_financieros (action_command_id)
  where action_command_id is not null;

-- ============================================================
-- 5) Registrar plata de la persona desde el chat
-- ============================================================
--
-- No clasifica nada, y es deliberado: `lib/finanzas/destinos.ts` infiere el
-- destino al leer, a partir de la descripción. Guardar una categoría acá
-- significaría que el chat y el panel pueden discrepar sobre el mismo
-- movimiento, y además le devolvería al usuario el trabajo de categorizar,
-- que es exactamente lo que la doctrina de finanzas no permite.

create or replace function public.eos_finanzas_registrar_personal_v136(
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
  v_tipo text;
  v_monto numeric;
  v_descripcion text;
  v_fecha date;
  v_moneda text;
  v_id uuid;
  v_primero uuid;
  v_hechos jsonb := '[]'::jsonb;
  v_cuantos integer := 0;
  v_entra numeric := 0;
  v_sale numeric := 0;
begin
  v_lista := case
    when jsonb_typeof(p_datos -> 'movimientos') = 'array' then p_datos -> 'movimientos'
    when jsonb_typeof(p_datos -> 'items') = 'array' then p_datos -> 'items'
    else jsonb_build_array(p_datos)
  end;

  if jsonb_array_length(v_lista) = 0 then
    raise exception 'EOS_ACCION_PERSONAL_SIN_DATOS';
  end if;

  for v_item in select * from jsonb_array_elements(v_lista)
  loop
    v_cuantos := v_cuantos + 1;
    if v_cuantos > 15 then
      raise exception 'EOS_ACCION_PERSONAL_DEMASIADOS';
    end if;

    v_descripcion := nullif(btrim(coalesce(
      v_item ->> 'descripcion', v_item ->> 'concepto', v_item ->> 'detalle', ''
    )), '');

    if v_descripcion is null then
      raise exception 'EOS_ACCION_PERSONAL_SIN_DESCRIPCION';
    end if;

    v_monto := nullif(regexp_replace(coalesce(
      v_item ->> 'monto', v_item ->> 'importe', v_item ->> 'total', ''
    ), '[^0-9.]', '', 'g'), '')::numeric;

    if v_monto is null or v_monto <= 0 then
      raise exception 'EOS_ACCION_PERSONAL_SIN_MONTO: %', v_descripcion;
    end if;

    -- El tipo no se adivina de la descripción. "Cobré" e "invertí" se parecen
    -- lo suficiente como para que una heurística acá se equivoque de signo, y
    -- un gasto contado como ingreso mueve el disponible real al doble en la
    -- dirección equivocada.
    v_tipo := case when lower(coalesce(v_item ->> 'tipo', '')) = 'ingreso' then 'ingreso' else 'gasto' end;

    v_fecha := case
      when coalesce(v_item ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_item ->> 'fecha')::date
      else (now() at time zone 'America/Asuncion')::date
    end;

    v_moneda := upper(nullif(btrim(coalesce(v_item ->> 'moneda', '')), ''));
    if v_moneda is null or length(v_moneda) <> 3 then v_moneda := 'PYG'; end if;

    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, fecha, origen, ambito,
      action_command_id, metadata
    ) values (
      p_usuario_id, v_tipo, v_monto, v_moneda, left(v_descripcion, 300), v_fecha,
      'chat', 'personal', p_command_id,
      jsonb_build_object('fuente', 'worker_gate', 'action_command_id', p_command_id)
    )
    returning id into v_id;

    if v_primero is null then v_primero := v_id; end if;

    if v_tipo = 'ingreso' then v_entra := v_entra + v_monto; else v_sale := v_sale + v_monto; end if;

    v_hechos := v_hechos || jsonb_build_object(
      'id', v_id,
      'tipo', v_tipo,
      'monto', v_monto,
      'moneda', v_moneda,
      'descripcion', v_descripcion,
      'fecha', v_fecha
    );
  end loop;

  return jsonb_build_object(
    'primero', v_primero,
    'movimientos', v_hechos,
    'entro', v_entra,
    'salio', v_sale
  );
end;
$function$;

revoke all on function public.eos_finanzas_registrar_personal_v136(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_finanzas_registrar_personal_v136(uuid, uuid, jsonb) to service_role;

comment on function public.eos_finanzas_registrar_personal_v136(uuid, uuid, jsonb) is
  'v136: anota gastos e ingresos de la PERSONA desde el chat. No clasifica: el destino se infiere al leer.';

-- ============================================================
-- 6) El gasto fijo también tiene que saber de quién es
-- ============================================================
--
-- El sueldo del capataz de un negocio y el alquiler de la casa son los dos
-- fijos, y no van al mismo lado. Se acepta `ambito` en los datos y el default
-- sigue siendo personal, que es lo que era antes de que existiera el negocio.

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
  v_ambito text;
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

    v_dia := nullif(regexp_replace(coalesce(v_item ->> 'dia_del_mes', ''), '[^0-9]', '', 'g'), '')::integer;
    if v_dia is null or v_dia < 1 or v_dia > 31 then
      v_dia := extract(day from (now() at time zone 'America/Asuncion'))::integer;
    end if;

    v_tipo := case when lower(coalesce(v_item ->> 'tipo', '')) = 'ingreso' then 'ingreso' else 'gasto' end;

    -- El ámbito puede venir por fijo o para toda la tanda.
    v_ambito := lower(nullif(btrim(coalesce(v_item ->> 'ambito', p_datos ->> 'ambito', '')), ''));
    if v_ambito is distinct from 'negocio' then v_ambito := 'personal'; end if;

    insert into public.eos_finanzas_fijos (
      usuario_id, tipo, descripcion, monto, dia_del_mes, activo, action_command_id, ambito
    ) values (
      p_usuario_id, v_tipo, left(v_descripcion, 200), v_mensual, v_dia, true, p_command_id, v_ambito
    )
    returning id into v_id;

    if v_primero is null then v_primero := v_id; end if;

    v_hechos := v_hechos || jsonb_build_object(
      'id', v_id,
      'descripcion', v_descripcion,
      'tipo', v_tipo,
      'ambito', v_ambito,
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

comment on function public.eos_finanzas_registrar_fijo_v134(uuid, uuid, jsonb) is
  'v136: declara gastos o ingresos que se repiten, del negocio o de la persona. Convierte quincenal/semanal a mensual y devuelve la conversión.';
