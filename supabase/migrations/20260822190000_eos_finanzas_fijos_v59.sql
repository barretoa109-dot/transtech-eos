-- EOS Finanzas — ingresos y gastos fijos declarados
--
-- El detector de recurrencia necesita ver un movimiento DOS VECES para
-- reconocerlo. Para el alquiler eso son dos meses: hasta entonces el panel no
-- sabe nada de los gastos fijos del usuario y no le sirve a nadie.
--
-- Con esta tabla el usuario lo declara una vez al configurarse y el panel
-- funciona desde el primer día. No rompe la doctrina: ya declara su
-- Constitución Financiera una vez, y esto es la misma categoría —configuración
-- inicial, no carga diaria—. Lo que sigue prohibido es que cargue cada gasto
-- del supermercado.
--
-- Lo declarado es una SEMILLA, no una verdad congelada: cuando el correo
-- empieza a traer el alquiler real, la serie detectada reemplaza a la
-- declarada (ver lib/finanzas/fijos.ts). Por eso acá no se guarda nada
-- calculado, solo lo que el usuario dijo.

create table if not exists public.eos_finanzas_fijos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  tipo text not null check (tipo in ('ingreso', 'gasto')),
  descripcion text not null,
  monto numeric(16,2) not null check (monto > 0),

  -- Día del mes en que ocurre. Si el mes es más corto se ancla al último día,
  -- como cualquier débito automático (se resuelve en el código, no acá).
  dia_del_mes smallint not null check (dia_del_mes between 1 and 31),

  -- Se desactiva en vez de borrarse: si el usuario deja de pagar el colegio,
  -- perder el registro impediría entender su historial de proyecciones.
  activo boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eos_fijos_usuario_idx
  on public.eos_finanzas_fijos (usuario_id) where activo;

comment on table public.eos_finanzas_fijos is
  'Ingresos y gastos fijos que el usuario declara una vez. Semilla del panel hasta que la realidad los confirme por correo.';

-- ============================================================
-- RLS
-- ============================================================
alter table public.eos_finanzas_fijos enable row level security;

drop policy if exists fijos_select on public.eos_finanzas_fijos;
create policy fijos_select on public.eos_finanzas_fijos
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists fijos_insert on public.eos_finanzas_fijos;
create policy fijos_insert on public.eos_finanzas_fijos
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists fijos_update on public.eos_finanzas_fijos;
create policy fijos_update on public.eos_finanzas_fijos
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists fijos_delete on public.eos_finanzas_fijos;
create policy fijos_delete on public.eos_finanzas_fijos
  for delete to authenticated using ((select auth.uid()) = usuario_id);

-- Mismo blindaje que el resto de finanzas.
drop trigger if exists eos_fijos_set_usuario_id_trg on public.eos_finanzas_fijos;
create trigger eos_fijos_set_usuario_id_trg
  before insert on public.eos_finanzas_fijos
  for each row execute function public.eos_finanzas_set_usuario_id();
