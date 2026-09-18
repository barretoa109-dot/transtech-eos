-- Prueba de extremo a extremo del negocio: CRM → venta → ERP → inventario →
-- ingreso → finanzas, con dos empresas y con plata personal de por medio.
--
-- NO es una migración: no se aplica. Corre contra lo que YA está en la base,
-- dentro de una transacción que termina en `rollback` (no deja una fila):
--
--     npx supabase db query --linked -f supabase/pruebas/negocio_e2e.sql
--
-- Devuelve una fila por comprobación; todas tienen que dar `ok = true`.
--
-- Cubre el escenario pedido:
--   cliente del CRM → oportunidad → venta → movimiento del ERP → inventario →
--   ingreso → oportunidad ganada
-- y además:
--   · un producto que queda con stock bajo tras vender
--   · una venta a crédito vencida (cartera)
--   · una plata PERSONAL que NO toca las finanzas del negocio
--   · dos empresas con lo mismo (mismo teléfono, mismo nombre de producto): no
--     se ven ni se mezclan
--   · una venta no puede tocar el producto de otra empresa
--
-- Lo que NO cubre: los indicadores del Dashboard ni la salud financiera, que
-- se calculan en TypeScript (`lib/kpi`) y tienen sus tests; acá se comprueban
-- los DATOS de los que se alimentan.

begin;

create temp table _r (n serial, prueba text, ok boolean, detalle text) on commit drop;

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  pa uuid; pb uuid;
  carlos_a uuid; carlos_b uuid;
  op_a uuid;
  r jsonb; r2 jsonb;
  v_venta uuid;
  neto_antes numeric; neto_despues numeric;
  hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  -- Las funciones del ERP solo las ejecuta `service_role`: se simula ese rol.
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-neg-a-' || ua || '@test.invalid', '{}'),
         (ub, 'authenticated', 'authenticated', 'e2e-neg-b-' || ub || '@test.invalid', '{}');

  -- Lo mismo en las dos empresas: mismo producto, mismo cliente, mismo teléfono.
  insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, costo, controla_stock, stock_actual, stock_minimo)
  values (ua, 'Harina 1 kg', 20000, 12000, true, 10, 3) returning id into pa;
  insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, costo, controla_stock, stock_actual, stock_minimo)
  values (ub, 'Harina 1 kg', 20000, 12000, true, 10, 3) returning id into pb;

  insert into public.eos_crm_contactos (usuario_id, nombre, telefono)
  values (ua, 'Carlos', '0981 123 456') returning id into carlos_a;
  insert into public.eos_crm_contactos (usuario_id, nombre, telefono)
  values (ub, 'Carlos', '0981 123 456') returning id into carlos_b;

  -- Una oportunidad ya trabajada con el cliente de la empresa A.
  insert into public.eos_crm_oportunidades (usuario_id, contacto_id, titulo, monto, moneda, etapa)
  values (ua, carlos_a, 'Pedido de harina', 40000, 'PYG', 'negociacion') returning id into op_a;

  -- ---------------------------------------------------- la venta al contado
  r := public.eos_erp_registrar_venta(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 2)),
    carlos_a, hoy, 'PYG', 'contado', true, 'e2e', null);

  v_venta := (r->>'venta_id')::uuid;

  perform pg_temp.chk('la venta se registra', (r->>'ok')::boolean = true and (r->>'total')::numeric = 40000, r::text);
  perform pg_temp.chk('el inventario baja: 10 → 8',
    (select stock_actual from public.eos_erp_productos where id = pa) = 8);
  perform pg_temp.chk('queda el movimiento de stock (kardex) con la salida',
    (select count(*) from public.eos_erp_movimientos_stock where producto_id = pa and tipo = 'salida' and cantidad = 2) = 1);
  perform pg_temp.chk('el ingreso aparece en las finanzas, por el total',
    (select monto from public.eos_movimientos_financieros where id = (r->>'movimiento_id')::uuid) = 40000
    and (select tipo from public.eos_movimientos_financieros where id = (r->>'movimiento_id')::uuid) = 'ingreso');
  perform pg_temp.chk('y es plata del NEGOCIO, no personal',
    (select ambito from public.eos_movimientos_financieros where id = (r->>'movimiento_id')::uuid) = 'negocio');
  perform pg_temp.chk('la oportunidad del cliente pasa a GANADA, ligada a la venta',
    (select etapa from public.eos_crm_oportunidades where id = op_a) = 'ganada'
    and (select venta_id from public.eos_crm_oportunidades where id = op_a) = v_venta);

  -- --------------------------------------------- stock bajo tras vender más
  perform public.eos_erp_registrar_venta(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 5)),
    carlos_a, hoy, 'PYG', 'contado', true, 'e2e', null);

  perform pg_temp.chk('tras vender 5 más queda en 3: llegó al mínimo (producto con stock bajo)',
    (select stock_actual <= stock_minimo from public.eos_erp_productos where id = pa)
    and (select stock_actual from public.eos_erp_productos where id = pa) = 3);

  -- ------------------------------------------------- venta a crédito vencida
  r2 := public.eos_erp_registrar_venta(
    ua, jsonb_build_array(jsonb_build_object('producto_id', pa, 'cantidad', 1)),
    carlos_a, hoy - 40, 'PYG', 'credito', false, 'e2e', hoy - 10);

  perform pg_temp.chk('una venta a crédito NO genera ingreso: la plata todavía no está',
    r2->>'movimiento_id' is null);
  perform pg_temp.chk('la venta a crédito queda como cuenta por cobrar vencida',
    (select vence_el < hoy and movimiento_id is null and estado not in ('anulada', 'cobrada')
       from public.eos_erp_ventas where id = (r2->>'venta_id')::uuid));

  -- -------------------------------- lo personal NO toca las finanzas del negocio
  select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0) into neto_antes
    from public.eos_movimientos_financieros where usuario_id = ua and ambito = 'negocio';

  insert into public.eos_movimientos_financieros (usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, ambito)
  values (ua, 'gasto', 500000, 'PYG', 'Cuota de la casa', 'vivienda', hoy, 'personal'),
         (ua, 'ingreso', 3000000, 'PYG', 'Sueldo', 'sueldo', hoy, 'personal');

  select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0) into neto_despues
    from public.eos_movimientos_financieros where usuario_id = ua and ambito = 'negocio';

  perform pg_temp.chk('un gasto y un ingreso PERSONALES no cambian el resultado del negocio',
    neto_antes = neto_despues and neto_antes = 40000 + 100000, neto_antes || ' → ' || neto_despues);
  perform pg_temp.chk('lo personal queda en su propio ámbito',
    (select count(*) from public.eos_movimientos_financieros where usuario_id = ua and ambito = 'personal') = 2);

  -- ----------------------------------------------------------- dos empresas
  perform pg_temp.chk('la empresa B no vendió nada, su stock sigue en 10',
    (select stock_actual from public.eos_erp_productos where id = pb) = 10
    and (select count(*) from public.eos_erp_ventas where usuario_id = ub) = 0);
  perform pg_temp.chk('el cliente de B con el mismo teléfono no se tocó',
    (select count(*) from public.eos_erp_ventas where contacto_id = carlos_b) = 0);

  begin
    perform public.eos_erp_registrar_venta(
      ua, jsonb_build_array(jsonb_build_object('producto_id', pb, 'cantidad', 1)),
      carlos_a, hoy, 'PYG', 'contado', true, 'e2e', null);
    perform pg_temp.chk('una venta NO puede usar el producto de otra empresa', false, 'no lanzó');
  exception when others then
    perform pg_temp.chk('una venta NO puede usar el producto de otra empresa', true, sqlerrm);
  end;
  perform pg_temp.chk('y ese intento no movió el stock de la empresa B',
    (select stock_actual from public.eos_erp_productos where id = pb) = 10);

  perform set_config('e2e.ua', ua::text, false);
  perform set_config('e2e.ub', ub::text, false);
end $$;

-- ---------------------------------------------------------------- RLS
-- Como la empresa B: solo ve lo suyo.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('e2e.ub'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config('e2e.b_ventas', (select count(*) from public.eos_erp_ventas)::text, true);
select set_config('e2e.b_productos', (select count(*) from public.eos_erp_productos)::text, true);
select set_config('e2e.b_contactos', (select count(*) from public.eos_crm_contactos)::text, true);
select set_config('e2e.b_oportunidades', (select count(*) from public.eos_crm_oportunidades)::text, true);
select set_config('e2e.b_movimientos', (select count(*) from public.eos_movimientos_financieros)::text, true);
select set_config('e2e.b_kardex', (select count(*) from public.eos_erp_movimientos_stock)::text, true);

-- Como la A: ve todo lo suyo.
select set_config('request.jwt.claim.sub', current_setting('e2e.ua'), true);
select set_config('e2e.a_ventas', (select count(*) from public.eos_erp_ventas)::text, true);
select set_config('e2e.a_movimientos', (select count(*) from public.eos_movimientos_financieros)::text, true);
reset role;

select pg_temp.chk('RLS: la empresa B no ve NINGUNA venta de la A', current_setting('e2e.b_ventas')::int = 0, current_setting('e2e.b_ventas'));
select pg_temp.chk('RLS: B ve solo su producto (no el de la A, aunque se llamen igual)', current_setting('e2e.b_productos')::int = 1, current_setting('e2e.b_productos'));
select pg_temp.chk('RLS: B ve solo su cliente (no el de la A, aunque tenga el mismo teléfono)', current_setting('e2e.b_contactos')::int = 1, current_setting('e2e.b_contactos'));
select pg_temp.chk('RLS: B no ve las oportunidades de la A', current_setting('e2e.b_oportunidades')::int = 0, current_setting('e2e.b_oportunidades'));
select pg_temp.chk('RLS: B no ve la plata de la A (ni la del negocio ni la personal)', current_setting('e2e.b_movimientos')::int = 0, current_setting('e2e.b_movimientos'));
select pg_temp.chk('RLS: B no ve el kardex de la A', current_setting('e2e.b_kardex')::int = 0, current_setting('e2e.b_kardex'));
select pg_temp.chk('RLS: la empresa A sí ve sus ventas y su plata', current_setting('e2e.a_ventas')::int = 3 and current_setting('e2e.a_movimientos')::int = 4, current_setting('e2e.a_ventas') || ' ventas, ' || current_setting('e2e.a_movimientos') || ' movimientos');

select n, prueba, ok, detalle from _r order by n;

rollback;
