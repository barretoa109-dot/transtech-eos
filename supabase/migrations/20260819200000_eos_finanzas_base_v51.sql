-- EOS Finanzas — base mínima del panel "¿Estoy bien?"
--
-- Diseñado según la doctrina financiera del usuario (memoria
-- eos-finanzas-principios), NO según los KPIs de la maqueta:
--   * "El saldo deja de ser la métrica principal" -> la métrica central es
--     el DISPONIBLE REAL (después de compromisos, reserva y ahorro).
--   * "Cero carga manual como objetivo" -> `origen` deja explícito de dónde
--     salió cada movimiento; la carga manual es la excepción, no la norma,
--     y el modelo ya contempla documento/chat/integración bancaria futura.
--   * "Autonomía con límites" -> la Constitución Financiera se define una
--     sola vez y EOS opera dentro de ella.

-- ============================================================
-- 1) Constitución Financiera: la política del usuario, una sola vez.
-- ============================================================
create table if not exists public.eos_finanzas_politica (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  moneda text not null default 'PYG',
  -- Saldo declarado una única vez al configurar; a partir de ahí EOS lo
  -- mantiene aplicando los movimientos. Evita depender de carga manual diaria.
  saldo_inicial numeric(16,2) not null default 0,
  saldo_inicial_fecha date not null default current_date,
  -- "¿Cuánto dinero mínimo querés mantener siempre disponible?"
  reserva_minima numeric(16,2) not null default 0,
  -- "¿Qué porcentaje de tus ingresos querés proteger para ahorro?"
  porcentaje_ahorro numeric(5,2) not null default 0
    check (porcentaje_ahorro >= 0 and porcentaje_ahorro <= 100),
  -- "¿A partir de qué monto querés que te consulte antes de actuar?"
  umbral_autorizacion numeric(16,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.eos_finanzas_politica is
  'Constitución Financiera: política que el usuario define una vez y dentro de la cual EOS opera.';

-- ============================================================
-- 2) Movimientos financieros, con trazabilidad de origen.
-- ============================================================
create table if not exists public.eos_movimientos_financieros (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('ingreso','gasto','compromiso')),
  monto numeric(16,2) not null check (monto >= 0),
  moneda text not null default 'PYG',
  descripcion text,
  categoria text,
  -- 'compromiso' = pago futuro ya conocido (alquiler, tarjeta, cuota).
  fecha date not null default current_date,
  recurrente boolean not null default false,
  -- De dónde salió el dato. 'manual' debe ser la excepción.
  origen text not null default 'manual'
    check (origen in ('manual','documento','chat','integracion','estimado')),
  documento_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.eos_movimientos_financieros.origen is
  'Procedencia del movimiento. La doctrina EOS exige que "manual" sea excepción, no norma.';

create index if not exists eos_movimientos_usuario_fecha_idx
  on public.eos_movimientos_financieros (usuario_id, fecha desc);

create index if not exists eos_movimientos_usuario_tipo_idx
  on public.eos_movimientos_financieros (usuario_id, tipo, fecha);

-- ============================================================
-- 3) RLS: cada usuario ve y escribe únicamente lo suyo.
--    Mismo patrón que el resto de las tablas user-scoped del proyecto.
-- ============================================================
alter table public.eos_finanzas_politica enable row level security;
alter table public.eos_movimientos_financieros enable row level security;

drop policy if exists finanzas_politica_select on public.eos_finanzas_politica;
create policy finanzas_politica_select on public.eos_finanzas_politica
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists finanzas_politica_insert on public.eos_finanzas_politica;
create policy finanzas_politica_insert on public.eos_finanzas_politica
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists finanzas_politica_update on public.eos_finanzas_politica;
create policy finanzas_politica_update on public.eos_finanzas_politica
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists movimientos_select on public.eos_movimientos_financieros;
create policy movimientos_select on public.eos_movimientos_financieros
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists movimientos_insert on public.eos_movimientos_financieros;
create policy movimientos_insert on public.eos_movimientos_financieros
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists movimientos_update on public.eos_movimientos_financieros;
create policy movimientos_update on public.eos_movimientos_financieros
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists movimientos_delete on public.eos_movimientos_financieros;
create policy movimientos_delete on public.eos_movimientos_financieros
  for delete to authenticated using ((select auth.uid()) = usuario_id);

-- ============================================================
-- 4) Blindaje usuario_id (misma lección que `mensajes`, migración v50):
--    nunca permitir filas huérfanas invisibles por RLS.
-- ============================================================
create or replace function public.eos_finanzas_set_usuario_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.usuario_id is null then
    new.usuario_id := auth.uid();
  end if;

  if new.usuario_id is null then
    raise exception 'usuario_id no pudo determinarse para %', tg_table_name
      using errcode = 'not_null_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists eos_movimientos_set_usuario_id_trg on public.eos_movimientos_financieros;
create trigger eos_movimientos_set_usuario_id_trg
  before insert on public.eos_movimientos_financieros
  for each row execute function public.eos_finanzas_set_usuario_id();

drop trigger if exists eos_finanzas_politica_set_usuario_id_trg on public.eos_finanzas_politica;
create trigger eos_finanzas_politica_set_usuario_id_trg
  before insert on public.eos_finanzas_politica
  for each row execute function public.eos_finanzas_set_usuario_id();
