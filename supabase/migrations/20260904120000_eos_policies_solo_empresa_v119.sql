-- Etapa 4: las policies quedan solo por empresa (v119).
--
-- ============================================================
-- QUÉ SE SACA, Y POR QUÉ RECIÉN AHORA
-- ============================================================
--
-- La v111 dejó las policies aceptando las dos fronteras:
--
--     (select auth.uid()) = usuario_id
--     or empresa_id = (select public.eos_mi_empresa_v109())
--
-- Ese `or` fue una red mientras `empresa_id` se llenaba. Ahora se saca la
-- primera mitad y queda solo la empresa.
--
-- Se recomendó dos veces esperar, y la condición que se puso era medible:
-- que `eos_empresa_discrepancias_v111()` diera cero. Antes de escribir esto se
-- midió contra producción, no se supuso:
--
--     eos_crm_actividades=0 | eos_crm_contactos=0 | eos_crm_oportunidades=0
--     eos_erp_compras=0 | eos_erp_cuenta_movimientos_v107=0
--     eos_erp_movimientos_stock=0 | eos_erp_productos=0 | eos_erp_ventas=0
--
-- Y se comprobó lo que la cuenta de discrepancias NO mira, que es lo que de
-- verdad podía hacer desaparecer datos:
--
--   · Los ocho triggers que rellenan `empresa_id` están activos y son BEFORE
--     INSERT, así que el `with check` los ve. Sin eso, cada alta fallaría.
--   · Ningún usuario se queda sin empresa: `eos_mi_empresa_v109` resuelve para
--     los diez. Tres tenían su membresía sin activar —lo arregla la v118, que
--     va antes que esta— y ninguno de los tres tenía una sola fila cargada.
--
-- ============================================================
-- LO QUE ESTO CAMBIA DE VERDAD
-- ============================================================
--
-- Con el `or`, alguien seguía viendo sus filas viejas aunque su `empresa_id`
-- no coincidiera con su empresa. Era la red, y por eso ninguna prueba de
-- aislamiento por empresa demostraba nada: el `usuario_id` la salvaba igual.
--
-- Sin el `or`, la empresa pasa a ser la única frontera. Eso es lo que hace
-- que invitar a alguien signifique algo —ve lo del negocio, no lo de la
-- persona que lo cargó— y lo que hace que sacarlo del equipo sea efectivo.
--
-- ============================================================
-- LO QUE NO SE TOCA
-- ============================================================
--
-- `eos_movimientos_financieros`, `eos_finanzas_fijos`, la memoria, los
-- objetivos y los aprendizajes siguen por `usuario_id` y no aparecen acá.
-- Son de la persona, no del negocio: EOS también es para quien no tiene una
-- empresa, y meterlos en esta frontera le daría a un empleado las finanzas
-- personales de su jefe.

-- ============================================================
-- 0. No se aplica si alguien quedaría sin empresa
-- ============================================================
--
-- La v118 arregla el trigger y rellena a los que nacieron mal. Esto lo
-- comprueba en vez de confiar: si alguien quedó sin empresa activa, sacar el
-- `usuario_id` le esconde sus propios datos, y prefiero que falle la
-- migración a que se entere el usuario.

do $$
declare
  v_sin int;
begin
  select count(*) into v_sin from public.eos_empresa_sin_activa_v118();

  if v_sin > 0 then
    raise exception
      'v119: hay % usuario(s) sin empresa activa. Corré eos_empresa_sin_activa_v118() y arreglalo antes de sacar usuario_id de las policies.',
      v_sin;
  end if;

  raise notice 'v119: todos los usuarios tienen empresa activa.';
end $$;

-- ============================================================
-- 1. Las siete tablas con empresa_id propio
-- ============================================================

do $$
declare
  t text;
  tablas text[] := array[
    'eos_erp_ventas',
    'eos_erp_compras',
    'eos_erp_productos',
    'eos_erp_movimientos_stock',
    'eos_crm_contactos',
    'eos_crm_oportunidades',
    'eos_crm_actividades'
  ];
  v_huerfanas bigint;
begin
  foreach t in array tablas loop
    /*
     * Una fila sin `empresa_id` se volvería invisible para todos. Se cuenta
     * antes de tocar nada: si hay alguna, la migración se cae y nadie pierde
     * acceso mientras tanto.
     */
    execute format('select count(*) from public.%I where empresa_id is null', t)
      into v_huerfanas;

    if v_huerfanas > 0 then
      raise exception 'v119: % tiene % fila(s) sin empresa_id. Corré eos_empresa_relleno_v110() primero.',
        t, v_huerfanas;
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_propio', t);

    /*
     * El `(select ...)` se conserva: sin él, Postgres evalúa la función una
     * vez POR FILA en vez de una vez por consulta. Con `eos_mi_empresa_v109`,
     * que hace su propia consulta, la diferencia no es teórica.
     */
    execute format(
      'create policy %I on public.%I
         for all to authenticated
         using (empresa_id = (select public.eos_mi_empresa_v109()))
         with check (empresa_id = (select public.eos_mi_empresa_v109()))',
      t || '_propio', t
    );

    raise notice 'v119: policy de % ahora es solo por empresa', t;
  end loop;
end $$;

-- ============================================================
-- 2. Los ítems, que cuelgan de su cabecera
-- ============================================================
--
-- No tienen columna propia: su dueño es la venta o la compra. La regla se
-- hereda de arriba, así que acá solo se saca el `usuario_id` del mismo modo.

drop policy if exists eos_erp_venta_items_propio on public.eos_erp_venta_items;
create policy eos_erp_venta_items_propio
  on public.eos_erp_venta_items
  for all to authenticated
  using (
    exists (
      select 1 from public.eos_erp_ventas v
      where v.id = venta_id
        and v.empresa_id = (select public.eos_mi_empresa_v109())
    )
  )
  with check (
    exists (
      select 1 from public.eos_erp_ventas v
      where v.id = venta_id
        and v.empresa_id = (select public.eos_mi_empresa_v109())
    )
  );

drop policy if exists eos_erp_compra_items_propio on public.eos_erp_compra_items;
create policy eos_erp_compra_items_propio
  on public.eos_erp_compra_items
  for all to authenticated
  using (
    exists (
      select 1 from public.eos_erp_compras c
      where c.id = compra_id
        and c.empresa_id = (select public.eos_mi_empresa_v109())
    )
  )
  with check (
    exists (
      select 1 from public.eos_erp_compras c
      where c.id = compra_id
        and c.empresa_id = (select public.eos_mi_empresa_v109())
    )
  );

-- ============================================================
-- 3. La cuenta corriente
-- ============================================================
--
-- Sigue siendo `for select`: escribir un cobro pasa por la función de la v107,
-- que garantiza que el movimiento financiero se cree en la misma transacción.

drop policy if exists eos_cuenta_mov_propio on public.eos_erp_cuenta_movimientos_v107;
create policy eos_cuenta_mov_propio
  on public.eos_erp_cuenta_movimientos_v107
  for select to authenticated
  using (empresa_id = (select public.eos_mi_empresa_v109()));

-- ============================================================
-- 4. Qué mirar si algo sale mal
-- ============================================================
--
-- La vuelta atrás es volver a aplicar la v111: reinstala las mismas policies
-- con el `or`. No hace falta tocar datos, porque esta migración no los toca.
--
-- `eos_empresa_discrepancias_v111()` sigue existiendo y sigue teniendo que dar
-- cero. Desde ahora también importa `eos_empresa_sin_activa_v118()`: con las
-- policies solo por empresa, un usuario sin empresa activa no ve nada suyo.

do $$
declare
  v_con_or int;
begin
  select count(*) into v_con_or
  from pg_policies
  where schemaname = 'public'
    and policyname like '%_propio'
    and qual ilike '%usuario_id%';

  if v_con_or > 0 then
    raise warning 'v119: quedan % policy(s) mencionando usuario_id. Revisá si son de tablas personales (esperado) o de negocio (no).', v_con_or;
  else
    raise notice 'v119: ninguna policy de negocio menciona ya usuario_id.';
  end if;
end $$;
