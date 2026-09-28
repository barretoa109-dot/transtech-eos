-- Una venta o compra a crédito ya cobrada (o pagada) se puede editar y anular (v209).
--
-- ============================================================
-- LO QUE PASÓ
-- ============================================================
--
-- 27/09/2026, desde el panel: "No pudimos editar la venta". Lo mismo al anular
-- y al corregir el costo de una compra. Reproducido en una base armada desde
-- cero con todas las migraciones:
--
--   · Una venta a crédito cobrada de una vez (`eos_erp_cobrar_venta`) queda con
--     `movimiento_id` apuntando al ingreso de ESE cobro, que además está
--     referenciado desde `eos_erp_cuenta_movimientos_v107`. Anularla borra el
--     ingreso de la venta —como con una venta al contado— y la FK del cobro lo
--     frena:
--       update or delete on table "eos_movimientos_financieros" violates
--       foreign key constraint "eos_erp_cuenta_movimientos_v107_movimiento_id_fkey"
--   · Con cobros parciales, `movimiento_id` queda vacío y lo frena el trigger
--     de la v107: EOS_DOCUMENTO_CON_COBRANZAS.
--   · Editar es anular + registrar (v116), así que falla igual.
--   · Las compras a crédito pagadas (`eos_erp_pagar_compra`), idéntico.
--
-- Ninguno de esos errores tenía un mensaje en las rutas: la persona veía
-- "No pudimos…" y no había nada que pudiera hacer desde la pantalla.
--
-- ============================================================
-- LO QUE CAMBIA
-- ============================================================
--
-- ANULAR quita también los cobros (o pagos) del documento y el dinero que
-- registraron. Es lo que ya hacía con una venta al contado: una venta que no
-- existe no dejó plata. El trigger de la v107 queda como red para cualquier
-- otro camino. La respuesta y la auditoría dicen cuántos cobros se revirtieron.
--
-- EDITAR conserva los cobros: se despegan de la venta vieja antes de anularla
-- y se pegan a la nueva, con el mismo dinero (mismos movimientos). Si la venta
-- corregida queda saldada, queda "cobrada". Si se corrigió a contado y cobrada,
-- esa venta ya registra su propio ingreso por el total, y el de los cobros
-- viejos se borra para no contar la plata dos veces.
--
-- `eos_erp_anular_venta` y `eos_erp_anular_compra` se parchean en su lugar
-- desde `pg_get_functiondef`, como la v198: cada ancla tiene que aparecer una
-- sola vez o no se cambia nada. Las de editar son cortas y se reescriben.

-- ============================================================
-- 1) Despegar los cobros de un documento
-- ============================================================

create or replace function public.eos_erp_quitar_cobros_v209(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_compra_id uuid,
  p_borrar_dinero boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cobros jsonb;
  v_movimientos uuid[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if not (
    (p_venta_id is not null and p_compra_id is null)
    or (p_venta_id is null and p_compra_id is not null)
  ) then
    raise exception 'EOS_COBRANZA_DOCUMENTO_INVALIDO';
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'usuario_id', m.usuario_id,
      'empresa_id', m.empresa_id,
      'monto', m.monto,
      'moneda', m.moneda,
      'fecha', m.fecha,
      'movimiento_id', m.movimiento_id,
      'nota', m.nota,
      'action_command_id', m.action_command_id
    ) order by m.creado_en, m.id), '[]'::jsonb),
    coalesce(array_agg(m.movimiento_id) filter (where m.movimiento_id is not null), '{}')
  into v_cobros, v_movimientos
  from public.eos_erp_cuenta_movimientos_v107 m
  where ((p_venta_id is not null and m.venta_id = p_venta_id)
      or (p_compra_id is not null and m.compra_id = p_compra_id))
    and public.eos_empresa_alcanza_v112(p_usuario_id, m.usuario_id);

  if jsonb_array_length(v_cobros) = 0 then
    return v_cobros;
  end if;

  -- El documento deja de apuntar al dinero del cobro: ese dinero es del cobro.
  if p_venta_id is not null then
    update public.eos_erp_ventas
    set movimiento_id = null, actualizado_en = now()
    where id = p_venta_id and movimiento_id = any(v_movimientos);

    delete from public.eos_erp_cuenta_movimientos_v107 where venta_id = p_venta_id;
  else
    update public.eos_erp_compras
    set movimiento_id = null, actualizado_en = now()
    where id = p_compra_id and movimiento_id = any(v_movimientos);

    delete from public.eos_erp_cuenta_movimientos_v107 where compra_id = p_compra_id;
  end if;

  if p_borrar_dinero then
    delete from public.eos_movimientos_financieros
    where id = any(v_movimientos)
      and public.eos_empresa_alcanza_v112(p_usuario_id, usuario_id);
  end if;

  return v_cobros;
end;
$$;

revoke all on function public.eos_erp_quitar_cobros_v209(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.eos_erp_quitar_cobros_v209(uuid, uuid, uuid, boolean)
  to service_role;

comment on function public.eos_erp_quitar_cobros_v209(uuid, uuid, uuid, boolean) is
  'v209: despega los cobros (o pagos) de una venta o compra y los devuelve. Con p_borrar_dinero borra también sus ingresos/gastos: lo usa anular. Editar los conserva y los pega al documento nuevo.';

-- ============================================================
-- 2) Pegarlos al documento corregido
-- ============================================================

create or replace function public.eos_erp_pasar_cobros_v209(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_compra_id uuid,
  p_cobros jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cobro jsonb;
  v_saldo numeric;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if jsonb_array_length(coalesce(p_cobros, '[]'::jsonb)) = 0 then
    return;
  end if;

  for v_cobro in select * from jsonb_array_elements(p_cobros) loop
    insert into public.eos_erp_cuenta_movimientos_v107 (
      usuario_id, empresa_id, venta_id, compra_id, monto, moneda, fecha,
      movimiento_id, nota, action_command_id
    ) values (
      coalesce((v_cobro ->> 'usuario_id')::uuid, p_usuario_id),
      (v_cobro ->> 'empresa_id')::uuid,
      p_venta_id,
      p_compra_id,
      (v_cobro ->> 'monto')::numeric,
      v_cobro ->> 'moneda',
      (v_cobro ->> 'fecha')::date,
      (v_cobro ->> 'movimiento_id')::uuid,
      v_cobro ->> 'nota',
      (v_cobro ->> 'action_command_id')::uuid
    );

    -- El ingreso dice de qué documento es: ahora del corregido.
    update public.eos_movimientos_financieros
    set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('venta_id', p_venta_id, 'compra_id', p_compra_id)
    where id = (v_cobro ->> 'movimiento_id')::uuid;
  end loop;

  v_saldo := public.eos_erp_saldo_documento_v107(p_venta_id, p_compra_id);

  if p_venta_id is not null then
    update public.eos_erp_ventas
    set estado = case when v_saldo <= 0 then 'cobrada' else estado end,
        -- Como `eos_erp_cobrar_venta`: un solo cobro es EL dinero de la venta.
        movimiento_id = case
          when jsonb_array_length(p_cobros) = 1 and movimiento_id is null
            then (p_cobros -> 0 ->> 'movimiento_id')::uuid
          else movimiento_id
        end,
        actualizado_en = now()
    where id = p_venta_id;
  else
    update public.eos_erp_compras
    set estado = case when v_saldo <= 0 then 'pagada' else estado end,
        movimiento_id = case
          when jsonb_array_length(p_cobros) = 1 and movimiento_id is null
            then (p_cobros -> 0 ->> 'movimiento_id')::uuid
          else movimiento_id
        end,
        actualizado_en = now()
    where id = p_compra_id;
  end if;
end;
$$;

revoke all on function public.eos_erp_pasar_cobros_v209(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.eos_erp_pasar_cobros_v209(uuid, uuid, uuid, jsonb)
  to service_role;

comment on function public.eos_erp_pasar_cobros_v209(uuid, uuid, uuid, jsonb) is
  'v209: vuelve a registrar los cobros despegados por eos_erp_quitar_cobros_v209 contra el documento corregido, con el mismo dinero, y lo marca cobrado/pagado si quedó saldado.';

-- ============================================================
-- 3) Anular quita los cobros (ventas y compras)
-- ============================================================

do $parche$
declare
  v_caso record;
  v_oid oid;
  v_def text;
  v_nueva text;
  v_ancla text;
  v_veces integer;
  i integer;
begin
  for v_caso in
    select * from (values
      (
        'eos_erp_anular_venta',
        array[
          $a$  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');$a$,
          $a$  if v_venta.movimiento_id is not null then
    select to_jsonb(m) into v_movimiento$a$,
          $a$jsonb_build_object('productos_devueltos', v_devueltos, 'borradores_cancelados', v_borradores)$a$,
          $a$'movimiento_borrado', v_venta.movimiento_id is not null$a$
        ],
        array[
          $n$  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_cobros jsonb := '[]'::jsonb;$n$,
          $n$  -- v209: los cobros del documento y su dinero se van con él.
  v_cobros := public.eos_erp_quitar_cobros_v209(p_usuario_id, v_venta.id, null, true);
  select movimiento_id into v_venta.movimiento_id from public.eos_erp_ventas where id = v_venta.id;

  if v_venta.movimiento_id is not null then
    select to_jsonb(m) into v_movimiento$n$,
          $n$jsonb_build_object('productos_devueltos', v_devueltos, 'borradores_cancelados', v_borradores, 'cobros_revertidos', v_cobros)$n$,
          $n$'movimiento_borrado', v_venta.movimiento_id is not null,
    'cobros_revertidos', jsonb_array_length(v_cobros)$n$
        ]
      ),
      (
        'eos_erp_anular_compra',
        array[
          $a$  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');$a$,
          $a$  if v_compra.movimiento_id is not null then
    select to_jsonb(m) into v_movimiento$a$,
          $a$'costos_sin_historia', v_costos_sin_historia
    ),
    v_fecha$a$,
          $a$'movimiento_borrado', v_compra.movimiento_id is not null$a$
        ],
        array[
          $n$  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_cobros jsonb := '[]'::jsonb;$n$,
          $n$  -- v209: los pagos del documento y su dinero se van con él.
  v_cobros := public.eos_erp_quitar_cobros_v209(p_usuario_id, null, v_compra.id, true);
  select movimiento_id into v_compra.movimiento_id from public.eos_erp_compras where id = v_compra.id;

  if v_compra.movimiento_id is not null then
    select to_jsonb(m) into v_movimiento$n$,
          $n$'costos_sin_historia', v_costos_sin_historia,
      'pagos_revertidos', v_cobros
    ),
    v_fecha$n$,
          $n$'movimiento_borrado', v_compra.movimiento_id is not null,
    'pagos_revertidos', jsonb_array_length(v_cobros)$n$
        ]
      )
    ) as t(funcion, anclas, reemplazos)
  loop
    select p.oid into v_oid
    from pg_proc p
    where p.proname = v_caso.funcion and p.pronamespace = 'public'::regnamespace;

    if v_oid is null then
      raise exception 'v209: no existe %', v_caso.funcion;
    end if;

    v_def := pg_get_functiondef(v_oid);

    if position('eos_erp_quitar_cobros_v209' in v_def) > 0 then
      raise notice 'v209: % ya quita los cobros; no se toca.', v_caso.funcion;
      continue;
    end if;

    v_nueva := v_def;

    for i in 1 .. array_length(v_caso.anclas, 1) loop
      v_ancla := v_caso.anclas[i];
      v_veces := (length(v_nueva) - length(replace(v_nueva, v_ancla, ''))) / length(v_ancla);

      if v_veces <> 1 then
        raise exception 'v209: en % el ancla % aparece % veces, no 1. No se cambió nada.',
          v_caso.funcion, i, v_veces;
      end if;

      v_nueva := replace(v_nueva, v_ancla, v_caso.reemplazos[i]);
    end loop;

    execute v_nueva;
  end loop;
end;
$parche$;

-- ============================================================
-- 4) Editar conserva los cobros
-- ============================================================

create or replace function public.eos_erp_editar_venta(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_items jsonb,
  p_contacto_id uuid default null,
  p_fecha date default null,
  p_moneda text default 'PYG',
  p_condicion text default 'contado',
  p_cobrada boolean default false,
  p_notas text default null,
  p_motivo text default null,
  p_vence_el date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_estado_actual text;
  v_vence_original date;
  v_registro jsonb;
  v_cobros jsonb;
  v_nueva uuid;
  v_ingreso_propio uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select estado, vence_el into v_estado_actual, v_vence_original
  from public.eos_erp_ventas
  where id = p_venta_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_VENTA_NO_EXISTE';
  end if;

  if v_estado_actual = 'anulada' then
    raise exception 'EOS_VENTA_YA_ANULADA';
  end if;

  -- v209: los cobros se despegan ANTES de anular, así anular no los borra.
  v_cobros := public.eos_erp_quitar_cobros_v209(p_usuario_id, p_venta_id, null, false);

  perform public.eos_erp_anular_venta(
    p_usuario_id, p_venta_id, coalesce(nullif(btrim(p_motivo), ''), 'Editada')
  );

  v_registro := public.eos_erp_registrar_venta(
    p_usuario_id, p_items, p_contacto_id, p_fecha, p_moneda, p_condicion, p_cobrada, p_notas,
    coalesce(p_vence_el, v_vence_original)
  );
  v_nueva := (v_registro ->> 'venta_id')::uuid;

  if jsonb_array_length(v_cobros) > 0 then
    select movimiento_id into v_ingreso_propio from public.eos_erp_ventas where id = v_nueva;

    if v_ingreso_propio is not null then
      -- Corregida a contado y cobrada: ya registró el ingreso por el total.
      -- El de los cobros viejos es la misma plata; se borra para no contarla dos veces.
      delete from public.eos_movimientos_financieros
      where id in (
        select (c ->> 'movimiento_id')::uuid from jsonb_array_elements(v_cobros) c
      )
        and public.eos_empresa_alcanza_v112(p_usuario_id, usuario_id);
    else
      perform public.eos_erp_pasar_cobros_v209(p_usuario_id, v_nueva, null, v_cobros);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'venta_anterior_id', p_venta_id,
    'venta_id', v_nueva,
    'subtotal', v_registro -> 'subtotal',
    'iva_total', v_registro -> 'iva_total',
    'total', v_registro -> 'total',
    'estado', (select to_jsonb(estado) from public.eos_erp_ventas where id = v_nueva),
    'cobros_conservados', jsonb_array_length(v_cobros)
  );
end;
$function$;

create or replace function public.eos_erp_editar_compra(
  p_usuario_id uuid,
  p_compra_id uuid,
  p_items jsonb,
  p_contacto_id uuid default null,
  p_fecha date default null,
  p_moneda text default 'PYG',
  p_condicion text default 'contado',
  p_pagada boolean default false,
  p_numero_comprobante text default null,
  p_notas text default null,
  p_motivo text default null,
  p_vence_el date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_estado_actual text;
  v_vence_original date;
  v_registro jsonb;
  v_pagos jsonb;
  v_nueva uuid;
  v_gasto_propio uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select estado, vence_el into v_estado_actual, v_vence_original
  from public.eos_erp_compras
  where id = p_compra_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_COMPRA_NO_EXISTE';
  end if;

  if v_estado_actual = 'anulada' then
    raise exception 'EOS_COMPRA_YA_ANULADA';
  end if;

  v_pagos := public.eos_erp_quitar_cobros_v209(p_usuario_id, null, p_compra_id, false);

  perform public.eos_erp_anular_compra(
    p_usuario_id, p_compra_id, coalesce(nullif(btrim(p_motivo), ''), 'Editada')
  );

  v_registro := public.eos_erp_registrar_compra(
    p_usuario_id, p_items, p_contacto_id, p_fecha, p_moneda, p_condicion,
    p_pagada, p_numero_comprobante, p_notas,
    coalesce(p_vence_el, v_vence_original)
  );
  v_nueva := (v_registro ->> 'compra_id')::uuid;

  if jsonb_array_length(v_pagos) > 0 then
    select movimiento_id into v_gasto_propio from public.eos_erp_compras where id = v_nueva;

    if v_gasto_propio is not null then
      delete from public.eos_movimientos_financieros
      where id in (
        select (c ->> 'movimiento_id')::uuid from jsonb_array_elements(v_pagos) c
      )
        and public.eos_empresa_alcanza_v112(p_usuario_id, usuario_id);
    else
      perform public.eos_erp_pasar_cobros_v209(p_usuario_id, null, v_nueva, v_pagos);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'compra_anterior_id', p_compra_id,
    'compra_id', v_nueva,
    'subtotal', v_registro -> 'subtotal',
    'iva_total', v_registro -> 'iva_total',
    'total', v_registro -> 'total',
    'pagos_conservados', jsonb_array_length(v_pagos)
  );
end;
$function$;
