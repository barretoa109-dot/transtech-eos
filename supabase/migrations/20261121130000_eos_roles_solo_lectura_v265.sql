-- v265: "Contabilidad" y "Solo lectura" ven los números y no los cambian.
--
-- ============================================================
-- EL AGUJERO
-- ============================================================
--
-- La pantalla "Mi empresa" ofrece invitar a alguien como Contabilidad
-- ("Ve los números, no los cambia") o como Solo lectura. Nada lo hacía
-- cumplir: con la empresa del dueño activa, ese miembro podía cargar, editar
-- y anular ventas y compras por chat o desde la web, igual que el dueño.
--
-- Ahora importa más que antes: el punto 4 del plan de aceptación es que los
-- contadores entren a EOS por sus clientes. Ningún dueño va a invitar a su
-- contador si el contador puede tocarle las ventas.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- 1) `eos_rol_solo_lectura_v265(usuario)`: true si la empresa en la que está
--    trabajando (la activa, la misma regla que `eos_empresa_de_v109`) le dio
--    un rol de solo mirar.
-- 2) El ejecutor de acciones del chat (`eos_execute_internal_effect_v64`)
--    rechaza las acciones del negocio de esas personas con
--    `EOS_ACCION_SOLO_LECTURA`. Las de su plata personal siguen andando.
--    Se envuelve, sin tocar su cuerpo (ver la sección 2).
-- 3) El candado del ámbito negocio de la v263 también frena a esos roles.
--
-- Las rutas web hacen el mismo chequeo con `exigirModuloParaEscribir`
-- (lib/modulos/acceso.ts).
--
-- ============================================================
-- ROLLBACK
-- ============================================================
--
--   drop function public.eos_execute_internal_effect_v64(uuid);
--   alter function public.eos_execute_internal_effect_v64_base_v265(uuid)
--     rename to eos_execute_internal_effect_v64;
--   (y volver a dar execute a service_role); volver a crear
--   eos_negocio_exige_erp_v263 desde la v263; después
--   drop function public.eos_rol_solo_lectura_v265(uuid);

-- ============================================================
-- 1) ¿Esta persona solo mira?
-- ============================================================

create or replace function public.eos_rol_solo_lectura_v265(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select m.rol in ('contabilidad', 'solo_lectura')
    from public.eos_empresa_miembros m
    where m.usuario_id = p_usuario_id
    order by m.activa desc, (m.rol = 'propietario') desc, m.creado_en
    limit 1
  ), false);
$$;

comment on function public.eos_rol_solo_lectura_v265(uuid) is
  'True si la empresa activa del usuario le dio un rol de solo mirar (contabilidad, solo_lectura). v265.';

revoke all on function public.eos_rol_solo_lectura_v265(uuid) from public;
revoke all on function public.eos_rol_solo_lectura_v265(uuid) from anon, authenticated;
grant execute on function public.eos_rol_solo_lectura_v265(uuid) to service_role;

-- ============================================================
-- 2) El ejecutor del chat
-- ============================================================
--
-- La primera versión de esta migración parchaba el cuerpo del ejecutor desde
-- `pg_get_functiondef`, buscando una línea exacta. En producción esa línea no
-- estaba igual que en el repo (el `db push` del 21/11/2026 cortó con "el ancla
-- aparece 0 veces" y no cambió nada). En vez de depender del texto, se
-- envuelve: el ejecutor de siempre pasa a llamarse
-- `eos_execute_internal_effect_v64_base_v265` y el nombre original queda en
-- una función que primero mira el rol y después le pasa la orden, sin tocar
-- una línea de su cuerpo. Todo lo que llama al ejecutor por su nombre (la ruta
-- `/api/internal/action-effects/v1`, n8n) pasa por la puerta sin enterarse.

do $renombrar$
begin
  -- Correrla dos veces no envuelve dos veces: si la base ya existe, el
  -- ejecutor ya está envuelto.
  if to_regprocedure('public.eos_execute_internal_effect_v64_base_v265(uuid)') is null then
    alter function public.eos_execute_internal_effect_v64(uuid)
      rename to eos_execute_internal_effect_v64_base_v265;
  end if;
end;
$renombrar$;

revoke all on function public.eos_execute_internal_effect_v64_base_v265(uuid) from public;
revoke all on function public.eos_execute_internal_effect_v64_base_v265(uuid) from anon, authenticated;
grant execute on function public.eos_execute_internal_effect_v64_base_v265(uuid) to service_role;

create or replace function public.eos_execute_internal_effect_v64(p_command_id uuid)
returns table(
  command_id uuid,
  accion text,
  effect_type text,
  effect_id uuid,
  idempotent boolean,
  estado text,
  resultado jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accion text;
  v_usuario uuid;
begin
  select c.accion, c.usuario_id
    into v_accion, v_usuario
  from public.eos_action_commands c
  where c.id = p_command_id;

  -- v265: Contabilidad y Solo lectura no cambian los números del negocio.
  if v_accion in (
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO', 'CREAR_PRODUCTO',
    'ACTUALIZAR_PRODUCTO', 'REGISTRAR_COMPRA', 'REGISTRAR_COBRO',
    'REGISTRAR_PAGO_COMPRA', 'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA',
    'CORREGIR_VENTA', 'ANULAR_COMPRA', 'CORREGIR_COMPRA',
    'ENVIAR_WHATSAPP_CLIENTE', 'REGISTRAR_RETIRO_PERSONAL'
  ) and public.eos_rol_solo_lectura_v265(v_usuario) then
    raise exception 'EOS_ACCION_SOLO_LECTURA';
  end if;

  return query
  select * from public.eos_execute_internal_effect_v64_base_v265(p_command_id);
end;
$$;

comment on function public.eos_execute_internal_effect_v64(uuid) is
  'Puerta del ejecutor de acciones del chat (v265): frena las del negocio de los roles de solo lectura y le pasa el resto a eos_execute_internal_effect_v64_base_v265.';

revoke all on function public.eos_execute_internal_effect_v64(uuid) from public;
revoke all on function public.eos_execute_internal_effect_v64(uuid) from anon, authenticated;
grant execute on function public.eos_execute_internal_effect_v64(uuid) to service_role;

-- ============================================================
-- 3) El candado del ámbito negocio (v263), también para estos roles
-- ============================================================

create or replace function public.eos_negocio_exige_erp_v263()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ambito is distinct from 'negocio' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.ambito is not distinct from 'negocio' then
    return new;
  end if;

  if not public.eos_tiene_modulo(new.usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  -- v265: quien solo mira los números del negocio no los carga.
  if public.eos_rol_solo_lectura_v265(new.usuario_id) then
    raise exception 'EOS_ACCION_SOLO_LECTURA';
  end if;

  return new;
end;
$$;

revoke all on function public.eos_negocio_exige_erp_v263() from public;
revoke all on function public.eos_negocio_exige_erp_v263() from anon, authenticated;
