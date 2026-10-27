-- Prueba de integración para una base local migrada. Todo queda en ROLLBACK.
--
-- Reproduce un caso real (25/10/2026): "Jeans E WL" no está en su
-- catálogo, pero dos productos de jean ya existen ("Cjto Celeste jeans",
-- "Jeans tachas Negro"). Antes de la v246, el resolver tokenizaba "Jeans E
-- WL" como solo {jean} (descartaba "E" y "WL" por tener 2 letras o menos), y
-- esa única palabra coincidía con los dos productos existentes: ambigüedad
-- falsa, que bloqueaba la creación aunque viniera el precio.
begin;

do $test$
declare
  v_usuario uuid := gen_random_uuid();
  v_detalle jsonb;
begin
  insert into auth.users (id, email)
  values (v_usuario, 'eos-tokens-v246-' || v_usuario::text || '@test.local');

  insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, controla_stock)
  values
    (v_usuario, 'Cjto Celeste jeans', 140000, false),
    (v_usuario, 'Jeans tachas Negro', 190000, false);

  -- El caso real: "Jeans E WL" no debe contarse como ambiguo con los dos de
  -- arriba. Candidatos = 0 (no existe), no > 1 (ambiguo).
  v_detalle := public.eos_erp_resolver_producto_detalle(v_usuario, 'Jeans E WL');
  if coalesce((v_detalle ->> 'candidatos')::int, -1) <> 0 then
    raise exception 'TEST_V246_JEANS_E_WL_SIGUE_AMBIGUO: %', v_detalle;
  end if;

  -- Un código de 2 letras real SÍ tiene que encontrar el producto que lo
  -- contiene literalmente, una vez que existe.
  insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, controla_stock)
  values (v_usuario, 'Jeans E WL', 125000, false);

  v_detalle := public.eos_erp_resolver_producto_detalle(v_usuario, 'Jeans E WL');
  if (v_detalle ->> 'producto_id') is null then
    raise exception 'TEST_V246_JEANS_E_WL_NO_SE_ENCUENTRA_YA_CREADO: %', v_detalle;
  end if;

  -- El relleno de 2 letras no se cuela como palabra real del producto: estos
  -- dos tienen que seguir resolviendo igual que antes de la v246.
  if public.eos_tokens('Jean de la casa', false) <> array['casa', 'jean'] then
    raise exception 'TEST_V246_RELLENO_DE_2_LETRAS_SE_COLO: %', public.eos_tokens('Jean de la casa', false);
  end if;

  -- Los talles de 2 letras (xs/xl) tienen que seguir afuera del núcleo: es lo
  -- que permite que "Remera talle XL Celeste" encuentre "Remera Celeste".
  if public.eos_tokens('Remera talle XL Celeste', true) <> array['celeste', 'remera'] then
    raise exception 'TEST_V246_XL_SE_COLO_EN_NUCLEO: %', public.eos_tokens('Remera talle XL Celeste', true);
  end if;

  -- Pero en modo "todas las palabras" (sin nucleo) el talle sigue siendo
  -- parte literal del nombre, sin cambios respecto de antes.
  if public.eos_tokens('Remera talle XL Celeste', false) <> array['celeste', 'remera', 'talle', 'xl'] then
    raise exception 'TEST_V246_XL_DESAPARECIO_DEL_MODO_LITERAL: %', public.eos_tokens('Remera talle XL Celeste', false);
  end if;
end;
$test$;

rollback;
