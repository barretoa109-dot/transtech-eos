-- La frontera de empresa, etapa 3a: las policies aceptan las dos (v111).
--
-- ============================================================
-- POR QUÉ "LAS DOS" Y NO DIRECTAMENTE EMPRESA
-- ============================================================
--
-- Hoy `usuario_id` y `empresa_id` dicen lo mismo: la v110 rellenó la segunda
-- desde la primera y cada usuario tiene exactamente una empresa. Pero "dicen
-- lo mismo" es una afirmación sobre el estado actual, no una garantía.
--
-- Una policy que mire SOLO empresa deja sin acceso a cualquier fila que, por
-- lo que sea, tenga la columna en null. Y el modo en que eso se manifiesta es
-- el peor posible: no un error, sino datos que desaparecen de la pantalla sin
-- decir por qué.
--
-- Con `OR`, una fila es accesible si CUALQUIERA de las dos rutas la alcanza.
-- Durante la transición eso no afloja nada —siguen siendo datos del mismo
-- usuario— y permite que la etapa 4 saque `usuario_id` cuando esté probado
-- que sobra.
--
-- ============================================================
-- ESTO NO ES TODAVÍA LA RED DE SEGURIDAD
-- ============================================================
--
-- Estas policies aplican a `authenticated`, o sea al cliente. Pero casi todas
-- las rutas de EOS usan `adminSinTipos()`, que es `service_role` y NO pasa por
-- RLS: filtran a mano. Así que esto endurece el acceso directo desde el
-- navegador y no sustituye la revisión de las 59 rutas, que viene después.
--
-- Decirlo importa: creer que las policies ya cubren todo es exactamente el
-- error que dejaría una ruta filtrando mal sin que nada lo delate.

-- ============================================================
-- 1. Las tablas con `usuario_id` y `empresa_id`
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
begin
  foreach t in array tablas loop
    execute format('drop policy if exists %I on public.%I', t || '_propio', t);

    /*
     * `(select ...)` alrededor de las dos funciones a propósito.
     *
     * Sin el subquery, Postgres las evalúa UNA VEZ POR FILA. Con él quedan
     * como InitPlan y se calculan una sola vez por consulta. Es la misma
     * forma que ya usaban estas policies para `auth.uid()`, y con
     * `eos_mi_empresa_v109()` —que hace su propia consulta— la diferencia
     * es mucho mayor.
     */
    execute format(
      'create policy %I on public.%I
         for all to authenticated
         using (
           (select auth.uid()) = usuario_id
           or empresa_id = (select public.eos_mi_empresa_v109())
         )
         with check (
           (select auth.uid()) = usuario_id
           or empresa_id = (select public.eos_mi_empresa_v109())
         )',
      t || '_propio', t
    );

    raise notice 'v111: policy de % acepta usuario o empresa', t;
  end loop;
end $$;

-- ============================================================
-- 2. Los ítems, que no tienen dueño propio
-- ============================================================
--
-- `eos_erp_venta_items` y `eos_erp_compra_items` no llevan `usuario_id` ni
-- `empresa_id`: su dueño es la cabecera. La policy sigue colgando de ella y
-- por eso hereda automáticamente la regla nueva — no hace falta agregarles
-- una columna que ya está un nivel más arriba.

drop policy if exists eos_erp_venta_items_propio on public.eos_erp_venta_items;
create policy eos_erp_venta_items_propio
  on public.eos_erp_venta_items
  for all to authenticated
  using (
    exists (
      select 1 from public.eos_erp_ventas v
      where v.id = venta_id
        and (
          v.usuario_id = (select auth.uid())
          or v.empresa_id = (select public.eos_mi_empresa_v109())
        )
    )
  )
  with check (
    exists (
      select 1 from public.eos_erp_ventas v
      where v.id = venta_id
        and (
          v.usuario_id = (select auth.uid())
          or v.empresa_id = (select public.eos_mi_empresa_v109())
        )
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
        and (
          c.usuario_id = (select auth.uid())
          or c.empresa_id = (select public.eos_mi_empresa_v109())
        )
    )
  )
  with check (
    exists (
      select 1 from public.eos_erp_compras c
      where c.id = compra_id
        and (
          c.usuario_id = (select auth.uid())
          or c.empresa_id = (select public.eos_mi_empresa_v109())
        )
    )
  );

-- ============================================================
-- 3. La cuenta corriente, que es solo de lectura para el cliente
-- ============================================================
--
-- Se conserva `for select`: escribir un cobro pasa por la función de la v107,
-- que es la que garantiza que el movimiento financiero se cree en la misma
-- transacción. Abrirla a insert desde el cliente rompería esa garantía.

drop policy if exists eos_cuenta_mov_propio on public.eos_erp_cuenta_movimientos_v107;
create policy eos_cuenta_mov_propio
  on public.eos_erp_cuenta_movimientos_v107
  for select to authenticated
  using (
    (select auth.uid()) = usuario_id
    or empresa_id = (select public.eos_mi_empresa_v109())
  );

-- ============================================================
-- 4. Comprobar que las dos fronteras coinciden
-- ============================================================
--
-- Mientras el resultado de esto sea cero en todas las tablas, sacar
-- `usuario_id` de las policies (etapa 4) no le quita acceso a nadie. Si
-- alguna vez da distinto de cero, ahí hay una fila cuyo dueño y cuya empresa
-- no se corresponden, y eso hay que mirarlo antes de seguir.

create or replace function public.eos_empresa_discrepancias_v111()
returns table (tabla text, filas_discrepantes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t text;
  tablas text[] := array[
    'eos_erp_ventas',
    'eos_erp_compras',
    'eos_erp_productos',
    'eos_erp_movimientos_stock',
    'eos_crm_contactos',
    'eos_crm_oportunidades',
    'eos_crm_actividades',
    'eos_erp_cuenta_movimientos_v107'
  ];
  v_n bigint;
begin
  foreach t in array tablas loop
    execute format(
      'select count(*) from public.%I d
        where d.empresa_id is null
           or d.empresa_id is distinct from public.eos_empresa_de_v109(d.usuario_id)',
      t
    ) into v_n;

    tabla := t;
    filas_discrepantes := v_n;
    return next;
  end loop;
end;
$$;

comment on function public.eos_empresa_discrepancias_v111() is
  'v111: filas donde empresa_id no coincide con la empresa del usuario_id. Tiene que dar cero antes de la etapa 4.';

revoke all on function public.eos_empresa_discrepancias_v111() from public, anon, authenticated;
grant execute on function public.eos_empresa_discrepancias_v111() to service_role;
