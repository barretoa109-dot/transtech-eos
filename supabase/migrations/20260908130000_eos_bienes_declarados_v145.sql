-- Los bienes declarados: la mitad del patrimonio que no es plata.
--
-- ============================================================
-- POR QUÉ HACE FALTA UNA TABLA
-- ============================================================
--
-- `eos_finanzas_cuentas` sabe dónde vive la plata y `eos_finanzas_deudas` a
-- quién se le debe. Con eso alcanza para el disponible real y para el plan de
-- pago, pero no para un patrimonio: falta lo que la persona TIENE y no es
-- líquido — la casa, el auto, una inversión, una parte de un negocio.
--
-- Sin eso, el neto de alguien con casa propia y un préstamo hipotecario sale
-- profundamente negativo: está el pasivo entero y falta el activo que lo
-- justifica. Es peor que no mostrarlo.
--
-- ============================================================
-- DECLARADO Y CON FECHA, COMO TODO LO DEMÁS
-- ============================================================
--
-- EOS no tasa inmuebles ni cotiza autos. Guarda lo que la persona dijo el día
-- que lo dijo, y esa fecha viaja pegada al número hasta la pantalla: un
-- patrimonio armado con una casa valuada hace tres años no es de hoy.
--
-- Por eso `valor_declarado_el` es NOT NULL y no admite un bien sin fecha, a
-- diferencia de las cuentas, donde el saldo es opcional. Un bien sin valor no
-- tiene sentido cargarlo; un valor sin fecha no se puede interpretar después.
--
-- ============================================================
-- EL ÁMBITO VIENE DE FÁBRICA
-- ============================================================
--
-- Nace con `ambito` en vez de agregárselo tres migraciones después, como pasó
-- con las cuentas y las deudas. Una camioneta puede ser del negocio o de la
-- persona, y de esa diferencia depende si aparece en el patrimonio de uno o en
-- el activo del otro.

create table if not exists public.eos_finanzas_activos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  ambito text not null default 'personal'
    check (ambito in ('negocio', 'personal')),

  nombre text not null,
  tipo text not null check (tipo in (
    'inmueble', 'vehiculo', 'inversion', 'participacion', 'otro'
  )),
  moneda text not null default 'PYG',

  valor_declarado numeric(16,2) not null check (valor_declarado >= 0),
  valor_declarado_el date not null default current_date,

  notas text,
  activo boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eos_activos_usuario_idx
  on public.eos_finanzas_activos (usuario_id, ambito) where activo;

comment on table public.eos_finanzas_activos is
  'Lo que la persona o el negocio TIENE y no es plata: inmuebles, vehículos, inversiones. Declarado, con fecha, nunca tasado por EOS.';

comment on column public.eos_finanzas_activos.valor_declarado_el is
  'Cuándo lo valuó la persona. Viaja hasta la pantalla: un patrimonio con una casa valuada hace tres años no es de hoy.';

-- ============================================================
-- RLS: cada quien ve y escribe únicamente lo suyo
-- ============================================================

alter table public.eos_finanzas_activos enable row level security;

drop policy if exists finanzas_activos_select on public.eos_finanzas_activos;
create policy finanzas_activos_select on public.eos_finanzas_activos
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists finanzas_activos_insert on public.eos_finanzas_activos;
create policy finanzas_activos_insert on public.eos_finanzas_activos
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists finanzas_activos_update on public.eos_finanzas_activos;
create policy finanzas_activos_update on public.eos_finanzas_activos
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists finanzas_activos_delete on public.eos_finanzas_activos;
create policy finanzas_activos_delete on public.eos_finanzas_activos
  for delete to authenticated using ((select auth.uid()) = usuario_id);

-- La regla de la casa: ninguna tabla con datos de una persona le habla a la
-- clave pública. Verificable con `anon` desde afuera.
revoke all on public.eos_finanzas_activos from anon;
