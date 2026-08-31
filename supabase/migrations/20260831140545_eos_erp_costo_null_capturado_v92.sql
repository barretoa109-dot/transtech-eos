-- Distinguir un costo anterior legítimamente NULL de una fila histórica que
-- nunca lo capturó. v80 y v88 ya están aplicadas: esta corrección es sólo hacia
-- adelante y mantiene la firma pública de eos_erp_anular_compra.

alter table public.eos_erp_compra_items
  add column if not exists costo_anterior_capturado boolean not null default false;

-- El historial es propiedad del servidor. Aunque authenticated tenga INSERT,
-- ningún cliente puede declarar qué costo había antes de su compra.
create or replace function public.eos_erp_capturar_costo_anterior_v78()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.producto_id is null then
    new.costo_anterior := null;
    new.costo_anterior_capturado := false;
    return new;
  end if;

  select p.costo
    into new.costo_anterior
  from public.eos_erp_productos p
  join public.eos_erp_compras c
    on c.id = new.compra_id and c.usuario_id = p.usuario_id
  where p.id = new.producto_id;

  if not found then
    raise exception 'EOS_PRODUCTO_TENANT_INVALIDO';
  end if;

  -- TRUE también cuando p.costo es NULL: justamente esa es la distinción.
  new.costo_anterior_capturado := true;
  return new;
end;
$function$;

revoke all on function public.eos_erp_capturar_costo_anterior_v78()
  from public, anon, authenticated;

-- El trigger INSERT de v80 ya llama a la función reemplazada. En UPDATE se
-- preservan ambos valores OLD, incluso si el cliente intenta falsificarlos.
create or replace function public.eos_erp_preservar_costo_anterior_v92()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.compra_id is distinct from old.compra_id
     or new.producto_id is distinct from old.producto_id then
    raise exception 'EOS_COMPRA_ITEM_IDENTIDAD_INMUTABLE';
  end if;

  new.costo_anterior := old.costo_anterior;
  new.costo_anterior_capturado := old.costo_anterior_capturado;
  return new;
end;
$function$;

revoke all on function public.eos_erp_preservar_costo_anterior_v92()
  from public, anon, authenticated;

drop trigger if exists eos_erp_compra_item_preservar_costo_v92
  on public.eos_erp_compra_items;
create trigger eos_erp_compra_item_preservar_costo_v92
  before update on public.eos_erp_compra_items
  for each row execute function public.eos_erp_preservar_costo_anterior_v92();

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

  for v_item in
    select
      producto_id,
      sum(cantidad)::numeric(16,3) as cantidad,
      (array_agg(costo_anterior order by orden asc, id asc))[1] as costo_antes_compra,
      (array_agg(costo_anterior_capturado order by orden asc, id asc))[1]
        as costo_antes_capturado,
      (array_agg(precio_unitario order by orden desc, id desc))[1] as ultimo_precio_compra
    from public.eos_erp_compra_items
    where compra_id = v_compra.id and producto_id is not null
    group by producto_id
    order by producto_id
  loop
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

    select c.id into v_ultima_compra_id
    from public.eos_erp_compra_items ci
    join public.eos_erp_compras c on c.id = ci.compra_id
    where ci.producto_id = v_item.producto_id
      and c.usuario_id = p_usuario_id
      and c.estado <> 'anulada'
    order by c.creado_en desc, ci.orden desc, ci.id desc
    limit 1;

    if v_ultima_compra_id is distinct from v_compra.id then
      v_costos_preservados := v_costos_preservados + 1;
    elsif (select costo from public.eos_erp_productos where id = v_item.producto_id)
          is distinct from v_item.ultimo_precio_compra then
      v_costos_preservados := v_costos_preservados + 1;
    elsif v_item.costo_antes_capturado then
      -- Puede restaurar NULL: TRUE prueba que NULL fue capturado, no desconocido.
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

revoke all on function public.eos_erp_anular_compra(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_anular_compra(uuid, uuid, text) to service_role;
