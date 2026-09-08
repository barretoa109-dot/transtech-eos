-- Tarjetas de crédito: la vertical que hoy está partida en dos mitades ciegas.
--
-- ============================================================
-- LO QUE HAY, Y POR QUÉ NO ALCANZA
-- ============================================================
--
-- Una tarjeta se puede cargar hoy de dos formas, y ninguna sirve:
--
--   · como CUENTA de tipo 'tarjeta_credito' — guarda un saldo y nada más;
--   · como DEUDA de tipo 'tarjeta' — guarda un saldo y una cuota mensual.
--
-- De las dos falta todo lo que hace que una tarjeta sea una tarjeta: la línea,
-- cuánto queda disponible, cuándo cierra, cuándo vence, el pago mínimo, el
-- total del resumen y las compras en cuotas.
--
-- Sin la fecha de cierre, EOS no puede decir "esto que comprás hoy lo pagás
-- recién el mes que viene", que es la diferencia entre una tarjeta y un débito.
-- Sin la línea no hay utilización. Y sin las compras en cuotas, la obligación
-- del mes que viene es un número que nadie puede explicar.
--
-- ============================================================
-- TODO ES OPCIONAL, PORQUE NADIE SABE TODO DE SU TARJETA
-- ============================================================
--
-- Casi ninguna columna es obligatoria. Alguien puede saber su línea y no su
-- fecha de cierre, o tener el resumen del mes pasado y no el de éste. El
-- motor calcula lo que puede con lo que hay y DECLARA lo que le falta.
--
-- Lo que nunca se guarda acá es una tasa, un interés o un cargo. EOS no los
-- conoce —dependen del contrato, del plazo y de la promoción de turno— y un
-- interés estimado se ve idéntico a uno real. Si alguien pide "cuánto me sale
-- financiar esto", la respuesta honesta es que no lo sabe.
--
-- ============================================================
-- EL RESUMEN TIENE FECHA, Y NO ES UN DETALLE
-- ============================================================
--
-- `pago_minimo` y `pago_total` describen UN resumen, el que llegó tal día.
-- Guardarlos sin `resumen_al` haría que el del mes pasado se lea como el de
-- éste, y alguien pagaría el mínimo de un ciclo que ya cerró.

-- ============================================================
-- 1) La tarjeta
-- ============================================================

create table if not exists public.eos_finanzas_tarjetas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  ambito text not null default 'personal'
    check (ambito in ('negocio', 'personal')),

  emisor text not null,
  -- "la azul", "la de Ueno". Como la llama la persona, no como figura en el
  -- plástico: es el nombre con el que va a hablar de ella en el chat.
  nombre text,
  moneda text not null default 'PYG',

  -- Cuánto le prestan y cuánto lleva usado. Los dos opcionales: sin línea no
  -- hay utilización, y se dice, en vez de suponer una.
  linea_total numeric(16,2) check (linea_total is null or linea_total > 0),
  saldo_utilizado numeric(16,2) check (saldo_utilizado is null or saldo_utilizado >= 0),
  saldo_al date,

  -- El ciclo. Cierre y vencimiento son días del mes, no fechas: se repiten.
  dia_cierre smallint check (dia_cierre is null or dia_cierre between 1 and 31),
  dia_vencimiento smallint check (dia_vencimiento is null or dia_vencimiento between 1 and 31),

  -- El último resumen, con su fecha. Sin la fecha, el del mes pasado se leería
  -- como el de éste y alguien pagaría el mínimo de un ciclo cerrado.
  pago_minimo numeric(16,2) check (pago_minimo is null or pago_minimo >= 0),
  pago_total numeric(16,2) check (pago_total is null or pago_total >= 0),
  resumen_al date,

  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint eos_tarjetas_saldo_con_fecha check (
    saldo_utilizado is null or saldo_al is not null
  ),
  constraint eos_tarjetas_resumen_con_fecha check (
    (pago_minimo is null and pago_total is null) or resumen_al is not null
  ),
  -- El mínimo no puede superar al total del mismo resumen. Si pasa, alguien se
  -- equivocó al escribirlo y conviene saberlo al cargarlo y no al proyectar.
  constraint eos_tarjetas_minimo_menor check (
    pago_minimo is null or pago_total is null or pago_minimo <= pago_total
  )
);

create index if not exists eos_tarjetas_usuario_idx
  on public.eos_finanzas_tarjetas (usuario_id, ambito) where activa;

comment on table public.eos_finanzas_tarjetas is
  'Tarjetas de crédito con su ciclo: línea, utilización, cierre, vencimiento y resumen. Nunca guarda tasas ni intereses: EOS no los conoce.';

comment on column public.eos_finanzas_tarjetas.resumen_al is
  'De qué resumen son el pago mínimo y el total. Sin esta fecha, el del mes pasado se lee como el de éste.';

-- ============================================================
-- 2) Las compras en cuotas
-- ============================================================
--
-- Es lo que convierte "debo 8 millones" en "me quedan cuatro cuotas de la
-- heladera y seis del pasaje". La diferencia importa: el saldo dice cuánto
-- debe hoy, las cuotas dicen cuánto le va a salir cada mes y hasta cuándo.

create table if not exists public.eos_finanzas_tarjeta_compras (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tarjeta_id uuid not null references public.eos_finanzas_tarjetas(id) on delete cascade,

  descripcion text not null,
  moneda text not null default 'PYG',

  monto_total numeric(16,2) check (monto_total is null or monto_total > 0),
  monto_cuota numeric(16,2) not null check (monto_cuota > 0),
  cuotas_totales smallint not null check (cuotas_totales > 0),
  cuotas_pagadas smallint not null default 0 check (cuotas_pagadas >= 0),

  -- Cuándo cae la primera. Con eso y las cuotas ya pagadas se sabe en qué mes
  -- termina, sin tener que preguntarlo.
  primera_cuota date not null default current_date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint eos_tarjeta_compras_coherentes check (cuotas_pagadas <= cuotas_totales)
);

create index if not exists eos_tarjeta_compras_tarjeta_idx
  on public.eos_finanzas_tarjeta_compras (tarjeta_id)
  where cuotas_pagadas < cuotas_totales;

comment on table public.eos_finanzas_tarjeta_compras is
  'Compras en cuotas de una tarjeta. El saldo dice cuánto debe hoy; esto dice cuánto le sale cada mes y hasta cuándo.';

comment on column public.eos_finanzas_tarjeta_compras.monto_total is
  'Lo que costó la compra, si se sabe. Opcional a propósito: cuota × cuotas NO da el total cuando hubo intereses, y EOS no los conoce.';

-- ============================================================
-- 3) RLS en las dos, y ni una palabra para la clave pública
-- ============================================================

alter table public.eos_finanzas_tarjetas enable row level security;
alter table public.eos_finanzas_tarjeta_compras enable row level security;

drop policy if exists tarjetas_select on public.eos_finanzas_tarjetas;
create policy tarjetas_select on public.eos_finanzas_tarjetas
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists tarjetas_insert on public.eos_finanzas_tarjetas;
create policy tarjetas_insert on public.eos_finanzas_tarjetas
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists tarjetas_update on public.eos_finanzas_tarjetas;
create policy tarjetas_update on public.eos_finanzas_tarjetas
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists tarjetas_delete on public.eos_finanzas_tarjetas;
create policy tarjetas_delete on public.eos_finanzas_tarjetas
  for delete to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists tarjeta_compras_select on public.eos_finanzas_tarjeta_compras;
create policy tarjeta_compras_select on public.eos_finanzas_tarjeta_compras
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists tarjeta_compras_insert on public.eos_finanzas_tarjeta_compras;
create policy tarjeta_compras_insert on public.eos_finanzas_tarjeta_compras
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists tarjeta_compras_update on public.eos_finanzas_tarjeta_compras;
create policy tarjeta_compras_update on public.eos_finanzas_tarjeta_compras
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists tarjeta_compras_delete on public.eos_finanzas_tarjeta_compras;
create policy tarjeta_compras_delete on public.eos_finanzas_tarjeta_compras
  for delete to authenticated using ((select auth.uid()) = usuario_id);

revoke all on public.eos_finanzas_tarjetas from anon;
revoke all on public.eos_finanzas_tarjeta_compras from anon;
