-- Fase 0: invariantes canónicas de anulación ERP (v88).
--
-- Mantiene las firmas públicas existentes. Cada función corre en una única
-- transacción PostgreSQL, exige service_role, identifica al actor por
-- p_usuario_id y conserva una auditoría inmutable de la operación.

create table if not exists public.eos_erp_anulaciones_auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete restrict,
  venta_id uuid references public.eos_erp_ventas(id) on delete restrict,
  compra_id uuid references public.eos_erp_compras(id) on delete restrict,
  motivo text not null check (length(btrim(motivo)) between 1 and 500),
  movimiento_financiero jsonb,
  detalle jsonb not null default '{}'::jsonb,
  fecha date not null,
  creado_en timestamptz not null default now(),
  constraint eos_erp_anulaciones_un_documento_v88 check (
    (venta_id is not null and compra_id is null)
    or (venta_id is null and compra_id is not null)
  )
);

create unique index if not exists eos_erp_anulaciones_venta_v88
  on public.eos_erp_anulaciones_auditoria (venta_id) where venta_id is not null;
create unique index if not exists eos_erp_anulaciones_compra_v88
  on public.eos_erp_anulaciones_auditoria (compra_id) where compra_id is not null;

alter table public.eos_erp_anulaciones_auditoria enable row level security;
drop policy if exists eos_erp_anulaciones_auditoria_select_v88
  on public.eos_erp_anulaciones_auditoria;
create policy eos_erp_anulaciones_auditoria_select_v88
  on public.eos_erp_anulaciones_auditoria
  for select to authenticated
  using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_erp_anulaciones_auditoria from public, anon, authenticated;
grant select on table public.eos_erp_anulaciones_auditoria to authenticated, service_role;
grant insert on table public.eos_erp_anulaciones_auditoria to service_role;

create or replace function public.eos_erp_anular_venta(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_venta public.eos_erp_ventas%rowtype;
  v_item record;
  v_saldo numeric(16,3);
  v_controla_stock boolean;
  v_devueltos int := 0;
  v_borradores int := 0;
  v_movimiento jsonb;
  v_fecha date := (now() at time zone 'America/Asuncion')::date;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;
  if p_usuario_id is null then raise exception 'EOS_ACTOR_REQUERIDO'; end if;
  if v_motivo is null then raise exception 'EOS_ANULACION_MOTIVO_REQUERIDO'; end if;
  v_motivo := left(v_motivo, 500);

  select * into v_venta
  from public.eos_erp_ventas
  where id = p_venta_id and usuario_id = p_usuario_id
  for update;
  if not found then raise exception 'EOS_VENTA_NO_EXISTE'; end if;

  -- El lock de cabecera hace que dos ejecuciones concurrentes se serialicen.
  if v_venta.estado = 'anulada' then
    return jsonb_build_object('ok', true, 'ya_estaba', true, 'venta_id', v_venta.id);
  end if;
  if v_venta.estado not in ('borrador', 'emitida', 'cobrada') then
    raise exception 'EOS_VENTA_ESTADO_INVALIDO';
  end if;

  -- Se bloquean y verifican TODOS los documentos vinculados. Uno emitido,
  -- firmado o rechazado requiere el flujo fiscal correspondiente.
  perform 1
  from public.eos_fe_documentos d
  where d.venta_id = v_venta.id
  order by d.id
  for update;

  if exists (
    select 1 from public.eos_fe_documentos d
    where d.venta_id = v_venta.id and d.usuario_id <> p_usuario_id
  ) then
    raise exception 'EOS_DOCUMENTO_FISCAL_TENANT_INVALIDO';
  end if;

  if exists (
    select 1 from public.eos_fe_documentos d
    where d.venta_id = v_venta.id
      and d.usuario_id = p_usuario_id
      and d.estado not in ('borrador', 'cancelado')
  ) then
    raise exception 'EOS_VENTA_CON_FACTURA';
  end if;

  update public.eos_fe_documentos
  set estado = 'cancelado', actualizado_en = now()
  where venta_id = v_venta.id and usuario_id = p_usuario_id and estado = 'borrador';
  get diagnostics v_borradores = row_count;

  -- Agrupar evita dos saldos intermedios si el producto se repite en la venta.
  for v_item in
    select producto_id, sum(cantidad)::numeric(16,3) as cantidad
    from public.eos_erp_venta_items
    where venta_id = v_venta.id and producto_id is not null
    group by producto_id
    order by producto_id
  loop
    update public.eos_erp_productos
    set stock_actual = case when controla_stock then stock_actual + v_item.cantidad else stock_actual end,
        actualizado_en = now()
    where id = v_item.producto_id and usuario_id = p_usuario_id
    returning stock_actual, controla_stock into v_saldo, v_controla_stock;

    if not found then raise exception 'EOS_PRODUCTO_NO_EXISTE'; end if;

    if v_controla_stock then
      insert into public.eos_erp_movimientos_stock (
        usuario_id, producto_id, tipo, cantidad, saldo_resultante,
        motivo, referencia_tipo, referencia_id, fecha
      ) values (
        p_usuario_id, v_item.producto_id, 'entrada', v_item.cantidad, v_saldo,
        'Anulación de venta — ' || v_motivo, 'venta', v_venta.id, v_fecha
      );
      v_devueltos := v_devueltos + 1;
    end if;
  end loop;

  if v_venta.movimiento_id is not null then
    select to_jsonb(m) into v_movimiento
    from public.eos_movimientos_financieros m
    where m.id = v_venta.movimiento_id and m.usuario_id = p_usuario_id
    for update;
    if not found then raise exception 'EOS_MOVIMIENTO_FINANCIERO_INVALIDO'; end if;

    delete from public.eos_movimientos_financieros
    where id = v_venta.movimiento_id and usuario_id = p_usuario_id;
  end if;

  update public.eos_erp_ventas
  set estado = 'anulada',
      notas = left(coalesce(notas || E'\n', '') || 'Anulada: ' || v_motivo, 2000),
      actualizado_en = now()
  where id = v_venta.id;

  insert into public.eos_erp_anulaciones_auditoria (
    usuario_id, venta_id, motivo, movimiento_financiero, detalle, fecha
  ) values (
    p_usuario_id, v_venta.id, v_motivo, v_movimiento,
    jsonb_build_object('productos_devueltos', v_devueltos, 'borradores_cancelados', v_borradores),
    v_fecha
  );

  return jsonb_build_object(
    'ok', true, 'ya_estaba', false, 'venta_id', v_venta.id,
    'productos_devueltos', v_devueltos,
    'documentos_borrador_cancelados', v_borradores,
    'movimiento_borrado', v_venta.movimiento_id is not null
  );
end;
$function$;

create or replace function public.eos_erp_anular_compra(
  p_usuario_id uuid,
  p_compra_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_compra public.eos_erp_compras%rowtype;
  v_item record;
  v_saldo numeric(16,3);
  v_controla_stock boolean;
  v_retirados int := 0;
  v_costos_restaurados int := 0;
  v_costos_preservados int := 0;
  v_costos_sin_historia int := 0;
  v_ultima_compra_id uuid;
  v_costo_fallback numeric(16,2);
  v_movimiento jsonb;
  v_fecha date := (now() at time zone 'America/Asuncion')::date;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;
  if p_usuario_id is null then raise exception 'EOS_ACTOR_REQUERIDO'; end if;
  if v_motivo is null then raise exception 'EOS_ANULACION_MOTIVO_REQUERIDO'; end if;
  v_motivo := left(v_motivo, 500);

  select * into v_compra
  from public.eos_erp_compras
  where id = p_compra_id and usuario_id = p_usuario_id
  for update;
  if not found then raise exception 'EOS_COMPRA_NO_EXISTE'; end if;

  if v_compra.estado = 'anulada' then
    return jsonb_build_object('ok', true, 'ya_estaba', true, 'compra_id', v_compra.id);
  end if;
  if v_compra.estado not in ('registrada', 'pagada') then
    raise exception 'EOS_COMPRA_ESTADO_INVALIDO';
  end if;

  -- Una fila por producto: suma stock y toma costo anterior de la PRIMERA
  -- línea y precio de la ÚLTIMA línea de la compra.
  for v_item in
    select
      producto_id,
      sum(cantidad)::numeric(16,3) as cantidad,
      (array_agg(costo_anterior order by orden asc, id asc))[1] as costo_antes_compra,
      (array_agg(precio_unitario order by orden desc, id desc))[1] as ultimo_precio_compra
    from public.eos_erp_compra_items
    where compra_id = v_compra.id and producto_id is not null
    group by producto_id
    order by producto_id
  loop
    -- Este UPDATE bloquea el producto y serializa anulaciones que lo comparten.
    update public.eos_erp_productos
    set stock_actual = case when controla_stock then stock_actual - v_item.cantidad else stock_actual end,
        actualizado_en = now()
    where id = v_item.producto_id and usuario_id = p_usuario_id
    returning stock_actual, controla_stock into v_saldo, v_controla_stock;
    if not found then raise exception 'EOS_PRODUCTO_NO_EXISTE'; end if;

    if v_controla_stock then
      insert into public.eos_erp_movimientos_stock (
        usuario_id, producto_id, tipo, cantidad, saldo_resultante,
        motivo, referencia_tipo, referencia_id, fecha
      ) values (
        p_usuario_id, v_item.producto_id, 'salida', v_item.cantidad, v_saldo,
        'Anulación de compra — ' || v_motivo, 'compra', v_compra.id, v_fecha
      );
      v_retirados := v_retirados + 1;
    end if;

    -- La fuente vigente es la última compra registrada, no la fecha comercial:
    -- registrar una compra atrasada también pisa el costo en el momento actual.
    select c.id into v_ultima_compra_id
    from public.eos_erp_compra_items ci
    join public.eos_erp_compras c on c.id = ci.compra_id
    where ci.producto_id = v_item.producto_id
      and c.usuario_id = p_usuario_id
      and c.estado <> 'anulada'
    order by c.creado_en desc, ci.orden desc, ci.id desc
    limit 1;

    if v_ultima_compra_id is distinct from v_compra.id then
      -- Hay una compra posterior vigente: el costo actual no pertenece a ésta.
      v_costos_preservados := v_costos_preservados + 1;
    elsif (select costo from public.eos_erp_productos where id = v_item.producto_id)
          is distinct from v_item.ultimo_precio_compra then
      -- Una edición manual posterior tiene precedencia y no se rebobina.
      v_costos_preservados := v_costos_preservados + 1;
    elsif v_item.costo_antes_compra is not null then
      update public.eos_erp_productos
      set costo = v_item.costo_antes_compra, actualizado_en = now()
      where id = v_item.producto_id and usuario_id = p_usuario_id;
      v_costos_restaurados := v_costos_restaurados + 1;
    else
      select ci.precio_unitario into v_costo_fallback
      from public.eos_erp_compra_items ci
      join public.eos_erp_compras c on c.id = ci.compra_id
      where ci.producto_id = v_item.producto_id
        and c.usuario_id = p_usuario_id
        and c.id <> v_compra.id
        and c.estado <> 'anulada'
        and c.creado_en < v_compra.creado_en
      order by c.creado_en desc, ci.orden desc, ci.id desc
      limit 1;

      if found then
        update public.eos_erp_productos
        set costo = v_costo_fallback, actualizado_en = now()
        where id = v_item.producto_id and usuario_id = p_usuario_id;
        v_costos_restaurados := v_costos_restaurados + 1;
      else
        v_costos_sin_historia := v_costos_sin_historia + 1;
      end if;
    end if;
  end loop;

  if v_compra.movimiento_id is not null then
    select to_jsonb(m) into v_movimiento
    from public.eos_movimientos_financieros m
    where m.id = v_compra.movimiento_id and m.usuario_id = p_usuario_id
    for update;
    if not found then raise exception 'EOS_MOVIMIENTO_FINANCIERO_INVALIDO'; end if;

    delete from public.eos_movimientos_financieros
    where id = v_compra.movimiento_id and usuario_id = p_usuario_id;
  end if;

  update public.eos_erp_compras
  set estado = 'anulada',
      notas = left(coalesce(notas || E'\n', '') || 'Anulada: ' || v_motivo, 2000),
      actualizado_en = now()
  where id = v_compra.id;

  insert into public.eos_erp_anulaciones_auditoria (
    usuario_id, compra_id, motivo, movimiento_financiero, detalle, fecha
  ) values (
    p_usuario_id, v_compra.id, v_motivo, v_movimiento,
    jsonb_build_object(
      'productos_retirados', v_retirados,
      'costos_restaurados', v_costos_restaurados,
      'costos_preservados', v_costos_preservados,
      'costos_sin_historia', v_costos_sin_historia
    ),
    v_fecha
  );

  return jsonb_build_object(
    'ok', true, 'ya_estaba', false, 'compra_id', v_compra.id,
    'productos_retirados', v_retirados,
    'costos_restaurados', v_costos_restaurados,
    'costos_preservados', v_costos_preservados,
    'costos_sin_historia', v_costos_sin_historia,
    'movimiento_borrado', v_compra.movimiento_id is not null
  );
end;
$function$;

revoke all on function public.eos_erp_anular_venta(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.eos_erp_anular_compra(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_anular_venta(uuid, uuid, text) to service_role;
grant execute on function public.eos_erp_anular_compra(uuid, uuid, text) to service_role;
