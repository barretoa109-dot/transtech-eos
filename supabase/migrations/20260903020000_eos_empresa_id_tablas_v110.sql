-- La frontera de empresa, etapa 2: la columna existe y está llena (v110).
--
-- ============================================================
-- QUÉ HACE Y QUÉ NO
-- ============================================================
--
-- Agrega `empresa_id` a las tablas del NEGOCIO, lo rellena desde el dueño
-- actual y lo mantiene con un trigger para las filas nuevas.
--
-- Lo que NO hace, a propósito: ninguna policy lo mira, ninguna función lo
-- recibe, ninguna ruta lo filtra. Todo sigue funcionando por `usuario_id`
-- exactamente igual que ayer. Esta migración es reversible sin consecuencias
-- porque nada depende todavía de la columna.
--
-- La etapa 3 —cambiar las policies y las rutas— se hace después y con las dos
-- columnas ya coherentes, que es lo que permite compararlas y comprobar que
-- dicen lo mismo antes de confiar en la nueva.
--
-- ============================================================
-- QUÉ TABLAS, Y POR QUÉ NO TODAS
-- ============================================================
--
-- Solo las de ERP y CRM. EOS tiene dos clases de usuario y la memoria del
-- proyecto lo dice: "EOS también para quien no tiene un negocio". Los
-- movimientos financieros, las deudas, los fijos y la Constitución Financiera
-- son de la PERSONA. Ponerles una empresa sería decirle a alguien que su
-- sueldo pertenece a una sociedad que nunca quiso tener.
--
-- Las tablas de inteligencia (objetivos, memoria, aprendizajes, decisiones)
-- tampoco: son del usuario que conversa con EOS, no de la empresa. Cuando haya
-- dos personas en una empresa, cada una tendrá su propia memoria — y eso es
-- correcto, no una omisión.
--
-- ============================================================
-- NULLABLE, Y ASÍ SE QUEDA POR AHORA
-- ============================================================
--
-- Un `not null` obligaría a que el relleno sea perfecto en el mismo instante,
-- y si una fila quedara afuera la migración fallaría entera. Nullable permite
-- verificar el relleno con una consulta antes de endurecerlo, que es lo que
-- hará la etapa 3.

-- ============================================================
-- 1. La columna, en las tablas del negocio
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
    'eos_crm_actividades',
    'eos_erp_cuenta_movimientos_v107'
  ];
begin
  foreach t in array tablas loop
    execute format(
      'alter table public.%I add column if not exists empresa_id uuid references public.eos_empresas(id) on delete restrict',
      t
    );

    -- El índice va desde el principio: la etapa 3 va a filtrar por acá en
    -- cada consulta, y agregarlo después sobre una tabla con datos es una
    -- operación que bloquea.
    execute format(
      'create index if not exists %I on public.%I (empresa_id)',
      t || '_empresa_idx', t
    );

    raise notice 'v110: empresa_id agregada a %', t;
  end loop;
end $$;

-- ============================================================
-- 2. Rellenar desde el dueño actual
-- ============================================================
--
-- Cada fila hereda la empresa de su `usuario_id`, que hasta hoy ES el dueño.
-- Es el único mapeo posible y es exacto: mientras cada usuario tenga una sola
-- empresa, no hay ambigüedad.

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
    'eos_crm_actividades',
    'eos_erp_cuenta_movimientos_v107'
  ];
  v_filas bigint;
begin
  foreach t in array tablas loop
    execute format(
      'update public.%I d
         set empresa_id = public.eos_empresa_de_v109(d.usuario_id)
       where d.empresa_id is null',
      t
    );
    get diagnostics v_filas = row_count;
    raise notice 'v110: % filas rellenadas en %', v_filas, t;
  end loop;
end $$;

-- ============================================================
-- 3. Mantenerla en las filas nuevas
-- ============================================================
--
-- Un trigger y no un default: el default no puede leer `usuario_id` de la
-- misma fila. Y `before insert` para que la columna ya venga puesta cuando
-- corran las policies.
--
-- Si el insert ya trae `empresa_id`, se respeta: la etapa 3 va a empezar a
-- mandarla explícitamente y este trigger no tiene que pisarla.

create or replace function public.eos_empresa_heredar_v110()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.empresa_id is null then
    new.empresa_id := public.eos_empresa_de_v109(new.usuario_id);
  end if;
  return new;
end;
$$;

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
    'eos_crm_actividades',
    'eos_erp_cuenta_movimientos_v107'
  ];
begin
  foreach t in array tablas loop
    execute format('drop trigger if exists eos_empresa_heredar on public.%I', t);
    execute format(
      'create trigger eos_empresa_heredar before insert on public.%I
         for each row execute function public.eos_empresa_heredar_v110()',
      t
    );
  end loop;
end $$;

-- ============================================================
-- 4. Comprobar el relleno
-- ============================================================
--
-- Una función, no un `raise` de una vez: la etapa 3 la va a llamar de nuevo
-- justo antes de cambiar las policies, para confirmar que nada quedó afuera
-- en el tiempo que pase entre las dos.

create or replace function public.eos_empresa_relleno_v110()
returns table (tabla text, filas bigint, sin_empresa bigint)
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
  v_filas bigint;
  v_sin bigint;
begin
  foreach t in array tablas loop
    execute format('select count(*), count(*) filter (where empresa_id is null) from public.%I', t)
      into v_filas, v_sin;

    tabla := t;
    filas := v_filas;
    sin_empresa := v_sin;
    return next;
  end loop;
end;
$$;

comment on function public.eos_empresa_relleno_v110() is
  'v110: cuántas filas de cada tabla de negocio quedaron sin empresa. Tiene que dar cero antes de la etapa 3.';

revoke all on function public.eos_empresa_relleno_v110() from public, anon, authenticated;
grant execute on function public.eos_empresa_relleno_v110() to service_role;
