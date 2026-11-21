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
--    Se parcha en su lugar desde `pg_get_functiondef`, con un ancla que tiene
--    que aparecer una sola vez (mismo método que la v228).
-- 3) El candado del ámbito negocio de la v263 también frena a esos roles.
--
-- Las rutas web hacen el mismo chequeo con `exigirModuloParaEscribir`
-- (lib/modulos/acceso.ts).
--
-- ============================================================
-- ROLLBACK
-- ============================================================
--
--   Volver a crear eos_execute_internal_effect_v64 desde la v248 y
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

do $parche$
declare
  v_oid regprocedure := 'public.eos_execute_internal_effect_v64(uuid)'::regprocedure;
  v_def text;
  v_ancla text := $a$    raise exception 'EOS_INTERNAL_EFFECT_NOT_AUTHORIZED';
  end if;$a$;
  v_veces integer;
begin
  v_def := replace(pg_get_functiondef(v_oid), chr(13), '');

  if position('eos_rol_solo_lectura_v265' in v_def) > 0 then
    raise notice 'v265: el ejecutor ya frena a los roles de solo lectura; no se toca.';
    return;
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  if v_veces <> 1 then
    raise exception 'v265: el ancla aparece % veces, no 1. No se cambió nada.', v_veces;
  end if;

  execute replace(
    v_def,
    v_ancla,
    v_ancla || $n$

  -- v265: Contabilidad y Solo lectura no cambian los números del negocio.
  if v_command.accion in (
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO', 'CREAR_PRODUCTO',
    'ACTUALIZAR_PRODUCTO', 'REGISTRAR_COMPRA', 'REGISTRAR_COBRO',
    'REGISTRAR_PAGO_COMPRA', 'REGISTRAR_OPORTUNIDAD', 'ANULAR_VENTA',
    'CORREGIR_VENTA', 'ANULAR_COMPRA', 'CORREGIR_COMPRA',
    'ENVIAR_WHATSAPP_CLIENTE', 'REGISTRAR_RETIRO_PERSONAL'
  ) and public.eos_rol_solo_lectura_v265(v_command.usuario_id) then
    raise exception 'EOS_ACCION_SOLO_LECTURA';
  end if;$n$
  );

  raise notice 'v265: el ejecutor frena las acciones del negocio de los roles de solo lectura.';
end;
$parche$;

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
