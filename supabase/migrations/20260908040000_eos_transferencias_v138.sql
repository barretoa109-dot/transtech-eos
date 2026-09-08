-- Mover plata de un banco a otro no es ganar ni gastar.
--
-- ============================================================
-- LO QUE PASA HOY
-- ============================================================
--
-- "Pasé 1 millón de Ueno a Continental" se registra como un gasto de
-- 1.000.000. Si alguien además anota la llegada, queda también un ingreso de
-- 1.000.000.
--
-- El saldo total no cambió —la plata sigue siendo suya, en otro lado— pero las
-- dos columnas quedaron infladas. Y todo lo que se calcula sobre ellas hereda
-- el error, cada uno de una forma distinta:
--
--   · la capacidad de ahorro, porque los ingresos del mes son mayores;
--   · el ratio de ahorro y el de deuda sobre ingreso, por lo mismo;
--   · el desglose por destino, que suma un "gasto" que no fue a ningún lado;
--   · el presupuesto y el pronóstico, que se arman con el ritmo de gasto;
--   · la salud financiera, que se calcula con todos los anteriores.
--
-- Es un error de exactitud, no de funciones, y por eso va antes que cualquier
-- tarjeta nueva: un presupuesto construido sobre ingresos inflados no es un
-- presupuesto incompleto, es uno que miente.
--
-- ============================================================
-- POR QUÉ UNA TABLA APARTE Y NO UN `tipo` NUEVO
-- ============================================================
--
-- La tentación es agregar `tipo = 'transferencia'` a
-- `eos_movimientos_financieros`. No: veintitrés archivos leen esa columna
-- —rutas, motores de proyección, riesgo, conciliación, recurrencia,
-- trazabilidad— y cada uno que no se acordara de excluir el tipo nuevo seguiría
-- contando la transferencia como antes, sin fallar y sin avisar. Un solo lugar
-- olvidado deja el error exactamente donde estaba, pero ahora escondido detrás
-- de un arreglo que parece hecho.
--
-- Una tabla propia lo vuelve **cierto por construcción**: si la transferencia
-- no está en la tabla de movimientos, no hay consulta de flujo que pueda
-- contarla. Lo que mueve es el saldo POR CUENTA, que es otra pregunta y vive en
-- `eos_finanzas_cuentas`.
--
-- ============================================================
-- LAS CUENTAS SE GUARDAN POR NOMBRE, Y EL id CUANDO SE PUEDE
-- ============================================================
--
-- La gente dice "de Ueno a Continental", no el uuid de una fila. Si el nombre
-- coincide con una cuenta declarada se guarda también el id —y entonces esto
-- puede mover saldos— y si no, se guarda igual con el texto: perder el registro
-- de que la plata se movió porque el usuario todavía no dio de alta la cuenta
-- sería castigarlo por no haber llenado un formulario, que es exactamente lo
-- que este producto promete no hacer.

create table if not exists public.eos_finanzas_transferencias (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  fecha date not null default current_date,
  monto numeric(16,2) not null check (monto > 0),
  moneda text not null default 'PYG',

  -- Como lo dijo la persona. Es lo que se le muestra de vuelta.
  cuenta_origen text,
  cuenta_destino text,

  -- Resueltos cuando el nombre coincide con una cuenta declarada.
  cuenta_origen_id uuid references public.eos_finanzas_cuentas (id) on delete set null,
  cuenta_destino_id uuid references public.eos_finanzas_cuentas (id) on delete set null,

  descripcion text,

  origen text not null default 'chat'
    check (origen in ('manual', 'documento', 'chat', 'integracion', 'estimado')),

  action_command_id uuid references public.eos_action_commands (id) on delete set null,

  creado_en timestamptz not null default now(),

  -- De un lado al otro. Si son la misma, no se movió nada.
  constraint eos_transferencias_lados_distintos
    check (cuenta_origen is distinct from cuenta_destino
           or cuenta_origen_id is distinct from cuenta_destino_id)
);

create index if not exists eos_transferencias_usuario_idx
  on public.eos_finanzas_transferencias (usuario_id, fecha desc);

create index if not exists eos_transferencias_action_command_idx
  on public.eos_finanzas_transferencias (action_command_id)
  where action_command_id is not null;

comment on table public.eos_finanzas_transferencias is
  'v138: plata que se mueve entre cuentas de la misma persona. Vive aparte de los movimientos JUSTAMENTE para que ninguna consulta de flujo pueda contarla como ingreso o gasto.';

-- ============================================================
-- RLS: el mismo blindaje que el resto de finanzas
-- ============================================================

alter table public.eos_finanzas_transferencias enable row level security;

drop policy if exists transferencias_select on public.eos_finanzas_transferencias;
create policy transferencias_select on public.eos_finanzas_transferencias
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists transferencias_insert on public.eos_finanzas_transferencias;
create policy transferencias_insert on public.eos_finanzas_transferencias
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists transferencias_update on public.eos_finanzas_transferencias;
create policy transferencias_update on public.eos_finanzas_transferencias
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists transferencias_delete on public.eos_finanzas_transferencias;
create policy transferencias_delete on public.eos_finanzas_transferencias
  for delete to authenticated using ((select auth.uid()) = usuario_id);

-- Regla del proyecto: toda tabla con datos de una persona le revoca a `anon`.
revoke all on public.eos_finanzas_transferencias from anon;

-- ============================================================
-- La acción del chat
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
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA'
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
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA'
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
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA'
  ]));

-- ============================================================
-- Registrar la transferencia
-- ============================================================

create or replace function public.eos_finanzas_registrar_transferencia_v138(
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
  v_monto numeric;
  v_moneda text;
  v_origen text;
  v_destino text;
  v_origen_id uuid;
  v_destino_id uuid;
  v_fecha date;
  v_id uuid;
begin
  v_monto := nullif(regexp_replace(coalesce(
    p_datos ->> 'monto', p_datos ->> 'importe', p_datos ->> 'total', ''
  ), '[^0-9.]', '', 'g'), '')::numeric;

  if v_monto is null or v_monto <= 0 then
    raise exception 'EOS_ACCION_TRANSFERENCIA_SIN_MONTO';
  end if;

  v_origen := nullif(btrim(coalesce(p_datos ->> 'origen', p_datos ->> 'desde', p_datos ->> 'cuenta_origen', '')), '');
  v_destino := nullif(btrim(coalesce(p_datos ->> 'destino', p_datos ->> 'hacia', p_datos ->> 'cuenta_destino', '')), '');

  -- Sin los dos lados no es una transferencia: es un movimiento del que no se
  -- sabe la mitad, y guardarlo así haría que el saldo por cuenta quede mal sin
  -- que nadie pueda reconstruir por qué.
  if v_origen is null or v_destino is null then
    raise exception 'EOS_ACCION_TRANSFERENCIA_SIN_CUENTAS';
  end if;

  if lower(v_origen) = lower(v_destino) then
    raise exception 'EOS_ACCION_TRANSFERENCIA_MISMA_CUENTA: %', v_origen;
  end if;

  -- Se resuelven contra las cuentas declaradas, sin exigir que existan.
  select c.id into v_origen_id
  from public.eos_finanzas_cuentas c
  where c.usuario_id = p_usuario_id and c.activa
    and lower(c.nombre) = lower(v_origen)
  limit 1;

  if v_origen_id is null then
    select c.id into v_origen_id
    from public.eos_finanzas_cuentas c
    where c.usuario_id = p_usuario_id and c.activa
      and (lower(c.nombre) like '%' || lower(v_origen) || '%'
           or lower(coalesce(c.institucion, '')) like '%' || lower(v_origen) || '%')
    limit 1;
  end if;

  select c.id into v_destino_id
  from public.eos_finanzas_cuentas c
  where c.usuario_id = p_usuario_id and c.activa
    and lower(c.nombre) = lower(v_destino)
  limit 1;

  if v_destino_id is null then
    select c.id into v_destino_id
    from public.eos_finanzas_cuentas c
    where c.usuario_id = p_usuario_id and c.activa
      and (lower(c.nombre) like '%' || lower(v_destino) || '%'
           or lower(coalesce(c.institucion, '')) like '%' || lower(v_destino) || '%')
    limit 1;
  end if;

  v_moneda := upper(nullif(btrim(coalesce(p_datos ->> 'moneda', '')), ''));
  if v_moneda is null or length(v_moneda) <> 3 then v_moneda := 'PYG'; end if;

  v_fecha := case
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_datos ->> 'fecha')::date
    else (now() at time zone 'America/Asuncion')::date
  end;

  insert into public.eos_finanzas_transferencias (
    usuario_id, fecha, monto, moneda,
    cuenta_origen, cuenta_destino, cuenta_origen_id, cuenta_destino_id,
    descripcion, origen, action_command_id
  ) values (
    p_usuario_id, v_fecha, v_monto, v_moneda,
    left(v_origen, 120), left(v_destino, 120), v_origen_id, v_destino_id,
    nullif(btrim(coalesce(p_datos ->> 'descripcion', '')), ''), 'chat', p_command_id
  )
  returning id into v_id;

  return jsonb_build_object(
    'primero', v_id,
    'monto', v_monto,
    'moneda', v_moneda,
    'origen', v_origen,
    'destino', v_destino,
    'origen_conocida', v_origen_id is not null,
    'destino_conocida', v_destino_id is not null
  );
end;
$function$;

revoke all on function public.eos_finanzas_registrar_transferencia_v138(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_finanzas_registrar_transferencia_v138(uuid, uuid, jsonb) to service_role;

comment on function public.eos_finanzas_registrar_transferencia_v138(uuid, uuid, jsonb) is
  'v138: registra plata movida entre cuentas de la misma persona. No toca eos_movimientos_financieros, así que no puede contarse como ingreso ni como gasto.';
