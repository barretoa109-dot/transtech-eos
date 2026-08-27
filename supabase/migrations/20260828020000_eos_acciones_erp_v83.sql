-- Que EOS pueda registrar una venta, con tu permiso (v83).
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- Hasta acá el asistente sabía crear tareas, objetivos y memoria. Ahora suma
-- tres acciones del negocio:
--
--   REGISTRAR_VENTA   "vendile 3 panes a Rossana"
--   AJUSTAR_STOCK     "conté la harina y hay 12"
--   CREAR_CONTACTO    "agendá a Rossana, RUC 80012345-6"
--
-- ============================================================
-- NINGUNA SE EJECUTA SOLA
-- ============================================================
--
-- Las tres entran con `risk_tier` 2 o más, y la puerta de autonomía obliga a
-- aprobación explícita para todo lo que llegue a 2 — sin importar el nivel de
-- autonomía que tenga configurado el usuario. Ver `SYSTEM_RISK` en
-- `lib/worker-gate-handler.ts`.
--
-- No es prudencia decorativa. Una venta descuenta stock y suma plata al panel;
-- si el modelo entiende mal "vendile tres panes" y carga treinta, el error
-- queda escrito en el inventario y en las finanzas. Anular existe desde la v78,
-- pero un sistema que necesita que lo anulen seguido deja de usarse.
--
-- ============================================================
-- LOS NOMBRES SE RESUELVEN O SE FALLA
-- ============================================================
--
-- El modelo manda "Pan casero", no un uuid. Resolver eso es el punto donde algo
-- puede salir muy mal: elegir el producto equivocado vende otra cosa, descuenta
-- otro stock y factura otro precio.
--
-- Por eso la resolución es estricta: nombre exacto, o una única coincidencia
-- parcial. Dos productos que podrían ser, o ninguno, es un error que se le
-- cuenta al usuario. Adivinar sería más cómodo y exactamente por eso no se hace.

-- ============================================================
-- 1. El catálogo de acciones permitidas
-- ============================================================

alter table public.eos_action_commands
  drop constraint if exists eos_action_commands_accion_check;

alter table public.eos_action_commands
  add constraint eos_action_commands_accion_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO'
  ]));

alter table public.eos_autonomy_rules_v12
  drop constraint if exists eos_autonomy_rules_action_check;

alter table public.eos_autonomy_rules_v12
  add constraint eos_autonomy_rules_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO'
  ]));

alter table public.eos_worker_gate_audit_v15
  drop constraint if exists eos_worker_gate_audit_action_check;

alter table public.eos_worker_gate_audit_v15
  add constraint eos_worker_gate_audit_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO'
  ]));

-- ============================================================
-- 2. De qué comando salió cada cosa
-- ============================================================
--
-- Sin esto no hay idempotencia: si el ejecutor se reintenta —y se reintenta,
-- para eso tiene `max_attempts`— la misma venta se carga dos veces. El índice
-- parcial es el mismo patrón que ya usan `eos_tasks` y `eos_memory`.

alter table public.eos_erp_ventas
  add column if not exists action_command_id uuid
    references public.eos_action_commands (id) on delete set null;

create unique index if not exists eos_erp_ventas_action_command_idx
  on public.eos_erp_ventas (action_command_id)
  where action_command_id is not null;

alter table public.eos_erp_movimientos_stock
  add column if not exists action_command_id uuid
    references public.eos_action_commands (id) on delete set null;

create unique index if not exists eos_erp_movimientos_stock_action_command_idx
  on public.eos_erp_movimientos_stock (action_command_id)
  where action_command_id is not null;

alter table public.eos_crm_contactos
  add column if not exists action_command_id uuid
    references public.eos_action_commands (id) on delete set null;

create unique index if not exists eos_crm_contactos_action_command_idx
  on public.eos_crm_contactos (action_command_id)
  where action_command_id is not null;

-- ============================================================
-- 3. Resolver un nombre, o fallar
-- ============================================================

create or replace function public.eos_erp_resolver_producto(
  p_usuario_id uuid,
  p_texto text
)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id uuid;
  v_cuantos int;
begin
  if v_texto = '' then
    return null;
  end if;

  -- Nombre exacto: si alguien escribió el nombre completo, gana sin discusión.
  select p.id into v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and lower(btrim(p.nombre)) = lower(v_texto)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- Por código, que es como los nombra quien tiene muchos.
  select p.id into v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and lower(btrim(coalesce(p.codigo, ''))) = lower(v_texto)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  /*
   * Parcial, y sólo si no hay dudas.
   *
   * Con "pan" y un catálogo que tiene "Pan casero" y "Pan de leche", devolver
   * cualquiera de los dos sería vender el equivocado. Dos candidatos es un
   * error, no un empate a resolver por orden alfabético.
   */
  select count(*), min(p.id)
    into v_cuantos, v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and p.nombre ilike '%' || v_texto || '%';

  if v_cuantos = 1 then
    return v_id;
  end if;

  return null;
end;
$function$;

create or replace function public.eos_crm_resolver_contacto(
  p_usuario_id uuid,
  p_texto text
)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id uuid;
  v_cuantos int;
begin
  if v_texto = '' then
    return null;
  end if;

  select c.id into v_id
  from public.eos_crm_contactos c
  where c.usuario_id = p_usuario_id
    and c.activo
    and lower(btrim(c.nombre)) = lower(v_texto)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select count(*), min(c.id)
    into v_cuantos, v_id
  from public.eos_crm_contactos c
  where c.usuario_id = p_usuario_id
    and c.activo
    and c.nombre ilike '%' || v_texto || '%';

  if v_cuantos = 1 then
    return v_id;
  end if;

  return null;
end;
$function$;

revoke all on function public.eos_erp_resolver_producto(uuid, text) from public, anon, authenticated;
revoke all on function public.eos_crm_resolver_contacto(uuid, text) from public, anon, authenticated;
