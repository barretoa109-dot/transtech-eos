-- Prueba de la v180: una compra a crédito guarda su vencimiento y corregirla lo conserva.
--
-- Se corre DESPUÉS de la migración, en una transacción con rollback:
--
--     cat supabase/migrations/20260919010000_eos_compras_vence_el_v180.sql \
--         supabase/pruebas/compra_vence_el_e2e.sql > /tmp/e2e180.sql
--     npx supabase db query --linked -f /tmp/e2e180.sql
--
-- Una vez aplicada la migración, se corre solo este archivo.

begin;

create temp table _r (n serial, prueba text, ok boolean, detalle text) on commit drop;

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

do $$
declare
  ua uuid := gen_random_uuid();
  pa uuid; prov uuid;
  r jsonb; corregida jsonb; nueva jsonb; sin_plazo jsonb; contado jsonb; vieja jsonb;
  hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-compra-' || ua || '@test.invalid', '{}');

  insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, costo, controla_stock, stock_actual, stock_minimo)
  values (ua, 'Harina 1 kg', 20000, 12000, true, 10, 3) returning id into pa;
  insert into public.eos_crm_contactos (usuario_id, nombre, es_proveedor) values (ua, 'Molino Sur', true) returning id into prov;

  -- Una compra a crédito con vencimiento pactado.
  r := public.eos_erp_registrar_compra(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 10, 'precio_unitario', 12000)),
    prov, hoy, 'PYG', 'credito', false, 'F-001', null, hoy + 15);

  perform pg_temp.chk('la compra a crédito nace con su vencimiento',
    (select vence_el from public.eos_erp_compras where id = (r->>'compra_id')::uuid) = hoy + 15);

  -- Corregirla como lo hace el chat (CORREGIR_COMPRA, v170): 11 argumentos, sin vencimiento.
  corregida := public.eos_erp_editar_compra(
    ua, (r->>'compra_id')::uuid,
    jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 20, 'precio_unitario', 12000)),
    prov, hoy, 'PYG', 'credito', false, 'F-001', null, 'Corregida desde el chat');

  perform pg_temp.chk('corregir la compra (11 argumentos, como el chat) CONSERVA el vencimiento',
    (select vence_el from public.eos_erp_compras where id = (corregida->>'compra_id')::uuid) = hoy + 15,
    (select vence_el::text from public.eos_erp_compras where id = (corregida->>'compra_id')::uuid));
  perform pg_temp.chk('y la corrección efectivamente cambió la cantidad',
    (corregida->>'total')::numeric = 240000);

  nueva := public.eos_erp_editar_compra(
    ua, (corregida->>'compra_id')::uuid,
    jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 20, 'precio_unitario', 12000)),
    prov, hoy, 'PYG', 'credito', false, 'F-001', null, 'Nuevo plazo', hoy + 30);
  perform pg_temp.chk('con una fecha nueva, se usa la nueva',
    (select vence_el from public.eos_erp_compras where id = (nueva->>'compra_id')::uuid) = hoy + 30);

  -- Sin plazo pactado: sigue sin plazo (no se inventa uno).
  sin_plazo := public.eos_erp_registrar_compra(
    ua, jsonb_build_array(jsonb_build_object('descripcion', 'Flete', 'cantidad', 1, 'precio_unitario', 50000)),
    prov, hoy, 'PYG', 'credito', false, null, null);
  sin_plazo := public.eos_erp_editar_compra(
    ua, (sin_plazo->>'compra_id')::uuid,
    jsonb_build_array(jsonb_build_object('descripcion', 'Flete', 'cantidad', 1, 'precio_unitario', 60000)),
    prov, hoy, 'PYG', 'credito', false, null, null, 'Sin plazo');
  perform pg_temp.chk('una compra sin plazo, corregida, sigue sin plazo (y las llamadas con los 9 argumentos de antes andan)',
    (select vence_el from public.eos_erp_compras where id = (sin_plazo->>'compra_id')::uuid) is null);

  -- Al contado el vencimiento no aplica aunque se lo pasen.
  contado := public.eos_erp_registrar_compra(
    ua, jsonb_build_array(jsonb_build_object('descripcion', 'Combustible', 'cantidad', 1, 'precio_unitario', 100000)),
    prov, hoy, 'PYG', 'contado', true, null, null, hoy + 10);
  perform pg_temp.chk('al contado no se guarda vencimiento',
    (select vence_el from public.eos_erp_compras where id = (contado->>'compra_id')::uuid) is null);
  perform pg_temp.chk('y el gasto de la compra al contado sigue registrado',
    (select movimiento_id from public.eos_erp_compras where id = (contado->>'compra_id')::uuid) is not null);

  -- Queda como cuenta por pagar vencida cuando pasa la fecha.
  vieja := public.eos_erp_registrar_compra(
    ua, jsonb_build_array(jsonb_build_object('descripcion', 'Repuestos', 'cantidad', 1, 'precio_unitario', 300000)),
    prov, hoy - 40, 'PYG', 'credito', false, null, null, hoy - 5);
  perform pg_temp.chk('una compra a crédito NO genera gasto: la plata todavía no salió',
    (select movimiento_id from public.eos_erp_compras where id = (vieja->>'compra_id')::uuid) is null);
  perform pg_temp.chk('y queda como pago a proveedor vencido',
    (select vence_el < hoy and estado not in ('anulada', 'pagada') from public.eos_erp_compras where id = (vieja->>'compra_id')::uuid));

  perform pg_temp.chk('no quedaron las firmas viejas (nada ambiguo)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('eos_erp_registrar_compra', 'eos_erp_editar_compra')) = 2);

  perform pg_temp.chk('el check de avisos acepta pagos_a_proveedores',
    (select pg_get_constraintdef(oid) like '%pagos_a_proveedores%'
       from pg_constraint where conname = 'eos_negocio_avisos_tipo_check'));
end $$;

set local role anon;
do $$
begin
  begin
    perform public.eos_erp_registrar_compra(gen_random_uuid(), '[]'::jsonb);
    perform set_config('e2e.anon', 'si', true);
  exception when others then
    perform set_config('e2e.anon', 'no', true);
  end;
end $$;
reset role;

set local role authenticated;
do $$
begin
  begin
    perform public.eos_erp_editar_compra(gen_random_uuid(), gen_random_uuid(), '[]'::jsonb);
    perform set_config('e2e.auth', 'si', true);
  exception when others then
    perform set_config('e2e.auth', 'no', true);
  end;
end $$;
reset role;

select pg_temp.chk('anon NO ejecuta registrar_compra', current_setting('e2e.anon') = 'no');
select pg_temp.chk('un usuario logueado NO ejecuta editar_compra', current_setting('e2e.auth') = 'no');

select n, prueba, ok, detalle from _r order by n;

rollback;
