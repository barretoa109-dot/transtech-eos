-- La frontera de empresa, etapa 1: existir sin cambiar nada (v109).
--
-- ============================================================
-- EL PROBLEMA
-- ============================================================
--
-- `usuario_id` es hoy la única frontera de datos, y mezcla dos cosas que no
-- son la misma: QUIÉN hizo algo y DE QUIÉN es económicamente. Mientras el
-- negocio sea una persona sola funciona; en cuanto entra un empleado, no hay
-- forma de que vea las ventas sin ser dueño de ellas.
--
-- `docs/erp-profesional-arquitectura.md` lo clasifica P0 y dice la regla
-- objetivo: "`empresa_id` es la frontera de datos. `usuario_id` identifica al
-- actor, no al dueño económico del documento."
--
-- ============================================================
-- POR QUÉ ESTA MIGRACIÓN NO CAMBIA NINGÚN COMPORTAMIENTO
-- ============================================================
--
-- Hay 59 rutas que filtran por `usuario_id`, 64 funciones que lo reciben y 34
-- archivos de migración con policies que lo comparan contra `auth.uid()`.
-- Cambiar todo eso de una es la clase de movimiento que rompe producción con
-- una clienta adentro.
--
-- Entonces esto es expand/contract, y esta es la parte "expand":
--
--   Etapa 1 (acá) — Existen las empresas y los miembros. Cada usuario actual
--                   tiene la suya. NINGUNA tabla de negocio cambia. Nada lee
--                   todavía de acá, así que no hay nada que se pueda romper.
--   Etapa 2       — `empresa_id` nullable en las tablas de negocio, rellenado
--                   desde el dueño. Las dos columnas conviven.
--   Etapa 3       — Las policies aceptan cualquiera de las dos; las rutas
--                   pasan a empresa.
--   Etapa 4       — `usuario_id` deja de ser la frontera.
--
-- ============================================================
-- LA EMPRESA NO REEMPLAZA A LAS FINANZAS PERSONALES
-- ============================================================
--
-- EOS tiene dos clases de usuario: el que lleva un negocio y el que solo
-- ordena su plata (ver `GastosView` y el módulo de finanzas). La empresa es la
-- frontera del NEGOCIO — ERP y CRM. Los movimientos financieros personales
-- siguen siendo de la persona, y meterlos acá sería decirle a alguien que su
-- sueldo pertenece a una empresa que nunca quiso tener.

-- ============================================================
-- 1. Empresas
-- ============================================================

create table if not exists public.eos_empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 160),

  -- Datos fiscales paraguayos. Todos opcionales: la empresa se crea sola para
  -- cada usuario y nadie cargó nada todavía. Un RUC inventado sería peor que
  -- ninguno.
  ruc text,
  ruc_dv smallint check (ruc_dv between 0 and 9),
  razon_social text,

  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.eos_empresas is
  'v109: la frontera económica del negocio. Etapa 1 del pase de usuario_id a empresa_id; todavía no la lee nadie.';

-- ============================================================
-- 2. Miembros y roles
-- ============================================================
--
-- Los roles son los que enumera el documento de arquitectura. Se declaran
-- todos ahora aunque hoy solo se use `propietario`: agregarlos después
-- obligaría a otra migración sobre un check, y la lista ya está decidida.

create table if not exists public.eos_empresa_miembros (
  empresa_id uuid not null references public.eos_empresas(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,

  rol text not null check (rol in (
    'propietario', 'administrador', 'ventas', 'compras',
    'deposito', 'caja', 'contabilidad', 'solo_lectura'
  )),

  creado_en timestamptz not null default now(),
  primary key (empresa_id, usuario_id)
);

comment on table public.eos_empresa_miembros is
  'v109: quién pertenece a qué empresa y con qué rol. Hoy cada usuario es propietario de la suya.';

-- Un usuario puede pertenecer a varias empresas, pero una sola es su
-- PRINCIPAL: la que se resuelve cuando no dice cuál. Sin esto, el día que
-- alguien sea miembro de dos, cualquier consulta sin empresa explícita
-- devolvería datos de una elegida al azar.
create unique index if not exists eos_empresa_miembros_principal
  on public.eos_empresa_miembros (usuario_id)
  where rol = 'propietario';

create index if not exists eos_empresa_miembros_usuario_idx
  on public.eos_empresa_miembros (usuario_id);

-- ============================================================
-- 3. Cada usuario actual tiene su empresa
-- ============================================================
--
-- El nombre sale del que la persona ya cargó en facturación, si lo cargó.
-- Si no, queda "Mi negocio" y se cambia cuando quiera: inventarle una razón
-- social a partir del correo sería ponerle un nombre que nunca eligió.

do $$
declare
  u record;
  v_empresa uuid;
  v_nombre text;
  v_creadas int := 0;
begin
  for u in
    select au.id
    from auth.users au
    where not exists (
      select 1 from public.eos_empresa_miembros m where m.usuario_id = au.id
    )
  loop
    select nullif(btrim(f.razon_social), '') into v_nombre
    from public.eos_fe_config f
    where f.usuario_id = u.id;

    insert into public.eos_empresas (nombre, razon_social)
    values (coalesce(v_nombre, 'Mi negocio'), v_nombre)
    returning id into v_empresa;

    insert into public.eos_empresa_miembros (empresa_id, usuario_id, rol)
    values (v_empresa, u.id, 'propietario');

    v_creadas := v_creadas + 1;
  end loop;

  raise notice 'v109: % empresa(s) creada(s) para usuarios existentes', v_creadas;
end $$;

-- ============================================================
-- 4. Y cada usuario nuevo también
-- ============================================================
--
-- Va como trigger sobre `auth.users` y no en el código de registro: hay más de
-- un camino de alta (correo, Google, Apple) y uno solo que se olvide dejaría
-- un usuario sin empresa, que es un estado del que después no se sale sin
-- intervención manual.

create or replace function public.eos_crear_empresa_inicial_v109()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  insert into public.eos_empresas (nombre)
  values ('Mi negocio')
  returning id into v_empresa;

  insert into public.eos_empresa_miembros (empresa_id, usuario_id, rol)
  values (v_empresa, new.id, 'propietario');

  return new;
end;
$$;

drop trigger if exists eos_crear_empresa_inicial on auth.users;
create trigger eos_crear_empresa_inicial
  after insert on auth.users
  for each row
  execute function public.eos_crear_empresa_inicial_v109();

-- ============================================================
-- 5. Resolver la empresa de alguien
-- ============================================================
--
-- Es la función que va a usar TODO el código cuando llegue la etapa 3. Que
-- exista una sola es lo que va a permitir cambiar la regla en un lugar en vez
-- de en cincuenta y nueve rutas.

create or replace function public.eos_empresa_de_v109(p_usuario_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.empresa_id
  from public.eos_empresa_miembros m
  where m.usuario_id = p_usuario_id
  order by (m.rol = 'propietario') desc, m.creado_en
  limit 1;
$$;

comment on function public.eos_empresa_de_v109(uuid) is
  'v109: la empresa principal de un usuario. El único lugar donde vive esa regla.';

/** La empresa del usuario de la sesión. Para las policies de la etapa 3. */
create or replace function public.eos_mi_empresa_v109()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.eos_empresa_de_v109((select auth.uid()));
$$;

-- ============================================================
-- 6. Permisos
-- ============================================================

alter table public.eos_empresas enable row level security;
alter table public.eos_empresa_miembros enable row level security;

-- Alguien ve una empresa si es miembro de ella. Nada más.
drop policy if exists eos_empresas_select_miembro on public.eos_empresas;
create policy eos_empresas_select_miembro
  on public.eos_empresas
  for select to authenticated
  using (
    exists (
      select 1 from public.eos_empresa_miembros m
      where m.empresa_id = eos_empresas.id
        and m.usuario_id = (select auth.uid())
    )
  );

-- Y ve la lista de miembros de las empresas a las que pertenece: quién más
-- tiene acceso a sus datos no puede ser información oculta para el dueño.
drop policy if exists eos_empresa_miembros_select_propio on public.eos_empresa_miembros;
create policy eos_empresa_miembros_select_propio
  on public.eos_empresa_miembros
  for select to authenticated
  using (
    exists (
      select 1 from public.eos_empresa_miembros mio
      where mio.empresa_id = eos_empresa_miembros.empresa_id
        and mio.usuario_id = (select auth.uid())
    )
  );

-- La regla del proyecto: toda tabla con datos de una persona le revoca todo a
-- `anon`. Y la escritura es del servidor: invitar a un miembro o cambiarle el
-- rol es una decisión con consecuencias, no un update suelto desde el cliente.
revoke all on table public.eos_empresas from public, anon, authenticated;
grant select on table public.eos_empresas to authenticated;
grant all on table public.eos_empresas to service_role;

revoke all on table public.eos_empresa_miembros from public, anon, authenticated;
grant select on table public.eos_empresa_miembros to authenticated;
grant all on table public.eos_empresa_miembros to service_role;

revoke all on function public.eos_empresa_de_v109(uuid) from public, anon, authenticated;
grant execute on function public.eos_empresa_de_v109(uuid) to service_role;

-- `eos_mi_empresa_v109` sí la puede llamar el cliente: solo devuelve la
-- empresa de quien pregunta, y la van a necesitar las policies de la etapa 3.
revoke all on function public.eos_mi_empresa_v109() from public, anon;
grant execute on function public.eos_mi_empresa_v109() to authenticated, service_role;
