-- Prueba de integración para una base local migrada. Todo queda en ROLLBACK.
begin;

do $test$
declare
  v_usuario uuid := gen_random_uuid();
  v_producto uuid;
  v_compra uuid;
  v_otra_compra uuid;
  v_item uuid;
  v_otro_producto uuid;
  v_costo numeric(16,2);
  v_costo_guardado numeric(16,2);
  v_capturado boolean;
  v_identidad_bloqueada boolean := false;
begin
  insert into auth.users (id, email)
  values (v_usuario, 'erp-v92-' || v_usuario::text || '@test.local');

  insert into public.eos_erp_productos (usuario_id, nombre, costo, controla_stock)
  values (v_usuario, 'Producto costo NULL', null, false)
  returning id into v_producto;

  insert into public.eos_erp_productos (usuario_id, nombre, costo, controla_stock)
  values (v_usuario, 'Producto ajeno al ítem', 55, false)
  returning id into v_otro_producto;

  insert into public.eos_erp_compras (usuario_id, estado)
  values (v_usuario, 'registrada')
  returning id into v_compra;

  insert into public.eos_erp_compras (usuario_id, estado)
  values (v_usuario, 'registrada')
  returning id into v_otra_compra;

  -- Un cliente intenta falsificar ambos campos protegidos.
  insert into public.eos_erp_compra_items (
    compra_id, producto_id, descripcion, cantidad, precio_unitario, total, orden,
    costo_anterior, costo_anterior_capturado
  ) values (
    v_compra, v_producto, 'Producto costo NULL', 1, 100, 100, 0,
    999, true
  ) returning id, costo_anterior, costo_anterior_capturado
    into v_item, v_costo_guardado, v_capturado;

  if v_costo_guardado is not null or v_capturado is distinct from true then
    raise exception 'TEST_V92_INSERT_NO_CAPTURO_NULL';
  end if;

  update public.eos_erp_compra_items
  set costo_anterior = 777, costo_anterior_capturado = false
  where id = v_item;

  select costo_anterior, costo_anterior_capturado
    into v_costo_guardado, v_capturado
  from public.eos_erp_compra_items
  where id = v_item;

  if v_costo_guardado is not null or v_capturado is distinct from true then
    raise exception 'TEST_V92_UPDATE_MODIFICO_HISTORIAL';
  end if;

  begin
    update public.eos_erp_compra_items
    set producto_id = v_otro_producto
    where id = v_item;
  exception
    when others then
      if sqlerrm like '%EOS_COMPRA_ITEM_IDENTIDAD_INMUTABLE%' then
        v_identidad_bloqueada := true;
      else
        raise;
      end if;
  end;

  if not v_identidad_bloqueada then
    raise exception 'TEST_V92_PERMITIO_CAMBIAR_IDENTIDAD';
  end if;

  v_identidad_bloqueada := false;
  begin
    update public.eos_erp_compra_items
    set compra_id = v_otra_compra
    where id = v_item;
  exception
    when others then
      if sqlerrm like '%EOS_COMPRA_ITEM_IDENTIDAD_INMUTABLE%' then
        v_identidad_bloqueada := true;
      else
        raise;
      end if;
  end;

  if not v_identidad_bloqueada then
    raise exception 'TEST_V92_PERMITIO_CAMBIAR_COMPRA';
  end if;

  -- Simula el paso siguiente de registrar compra: esa compra fijó costo 100.
  update public.eos_erp_productos set costo = 100 where id = v_producto;

  -- La RPC comprueba el claim del JWT que PostgREST configura en producción.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.eos_erp_anular_compra(v_usuario, v_compra, 'Prueba costo NULL');

  select costo into v_costo from public.eos_erp_productos where id = v_producto;
  if v_costo is not null then
    raise exception 'TEST_V92_NO_RESTAURA_NULL: %', v_costo;
  end if;
end;
$test$;

rollback;
