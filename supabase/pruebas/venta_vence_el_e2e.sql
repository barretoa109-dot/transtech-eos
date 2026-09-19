-- Prueba de la v178: corregir una venta conserva o cambia su vencimiento.
--
-- Se corre DESPUÉS de la migración, en una transacción con rollback:
--
--     cat supabase/migrations/20260919000000_eos_editar_venta_conserva_vence_el_v178.sql \
--         supabase/pruebas/venta_vence_el_e2e.sql > /tmp/e2e178.sql
--     npx supabase db query --linked -f /tmp/e2e178.sql

begin;

create temp table _r (n serial, prueba text, ok boolean, detalle text) on commit drop;

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

do $$
declare
  ua uuid := gen_random_uuid();
  pa uuid; ca uuid;
  r jsonb; corregida jsonb; y jsonb; z jsonb; contado jsonb;
  hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-vence-' || ua || '@test.invalid', '{}');

  insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, costo, controla_stock, stock_actual, stock_minimo)
  values (ua, 'Harina 1 kg', 20000, 12000, true, 50, 3) returning id into pa;
  insert into public.eos_crm_contactos (usuario_id, nombre) values (ua, 'Carlos') returning id into ca;

  -- Una venta a crédito con vencimiento pactado.
  r := public.eos_erp_registrar_venta(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 2)),
    ca, hoy, 'PYG', 'credito', false, null, hoy + 15);

  perform pg_temp.chk('la venta a crédito nace con su vencimiento',
    (select vence_el from public.eos_erp_ventas where id = (r->>'venta_id')::uuid) = hoy + 15);

  -- Corregirla como lo hace el chat: DIEZ argumentos, sin vencimiento.
  corregida := public.eos_erp_editar_venta(
    ua, (r->>'venta_id')::uuid,
    jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 3)),
    ca, hoy, 'PYG', 'credito', false, null, 'Corregida desde el chat');

  perform pg_temp.chk('corregir la venta (llamada de 10 argumentos, como el chat) CONSERVA el vencimiento',
    (select vence_el from public.eos_erp_ventas where id = (corregida->>'venta_id')::uuid) = hoy + 15,
    (select vence_el::text from public.eos_erp_ventas where id = (corregida->>'venta_id')::uuid));
  perform pg_temp.chk('y la corrección efectivamente cambió la cantidad',
    (corregida->>'total')::numeric = 60000);

  -- Corregir de nuevo, ahora cambiando el plazo.
  y := public.eos_erp_editar_venta(
    ua, (corregida->>'venta_id')::uuid,
    jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 3)),
    ca, hoy, 'PYG', 'credito', false, null, 'Nuevo plazo', hoy + 30);

  perform pg_temp.chk('con una fecha nueva, se usa la nueva',
    (select vence_el from public.eos_erp_ventas where id = (y->>'venta_id')::uuid) = hoy + 30);

  -- Una venta a crédito SIN vencimiento sigue sin él (no se inventa uno).
  z := public.eos_erp_registrar_venta(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 1)),
    ca, hoy, 'PYG', 'credito', false, null, null);
  z := public.eos_erp_editar_venta(
    ua, (z->>'venta_id')::uuid,
    jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 2)),
    ca, hoy, 'PYG', 'credito', false, null, 'Sin plazo');
  perform pg_temp.chk('una venta sin plazo, corregida, sigue sin plazo',
    (select vence_el from public.eos_erp_ventas where id = (z->>'venta_id')::uuid) is null);

  -- Al contado el vencimiento no aplica aunque se lo pasen.
  contado := public.eos_erp_registrar_venta(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 1)),
    ca, hoy, 'PYG', 'contado', true, null, null);
  contado := public.eos_erp_editar_venta(
    ua, (contado->>'venta_id')::uuid,
    jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 2)),
    ca, hoy, 'PYG', 'contado', true, null, 'Contado', hoy + 10);
  perform pg_temp.chk('al contado no se guarda vencimiento',
    (select vence_el from public.eos_erp_ventas where id = (contado->>'venta_id')::uuid) is null);
  perform pg_temp.chk('y el ingreso de la venta al contado sigue registrado',
    (contado->>'ok')::boolean and exists (
      select 1 from public.eos_erp_ventas where id = (contado->>'venta_id')::uuid and movimiento_id is not null));

  -- La firma vieja ya no existe: no puede haber una llamada ambigua.
  perform pg_temp.chk('no quedó la firma vieja de 10 argumentos (nada ambiguo)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'eos_erp_editar_venta') = 1);
end $$;

-- Permisos: solo service_role.
set local role anon;
do $$
begin
  begin
    perform public.eos_erp_editar_venta(gen_random_uuid(), gen_random_uuid(), '[]'::jsonb);
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
    perform public.eos_erp_editar_venta(gen_random_uuid(), gen_random_uuid(), '[]'::jsonb);
    perform set_config('e2e.auth', 'si', true);
  exception when others then
    perform set_config('e2e.auth', 'no', true);
  end;
end $$;
reset role;

select pg_temp.chk('anon NO ejecuta la función', current_setting('e2e.anon') = 'no');
select pg_temp.chk('un usuario logueado NO ejecuta la función', current_setting('e2e.auth') = 'no');

select n, prueba, ok, detalle from _r order by n;

rollback;
