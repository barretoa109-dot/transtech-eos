-- EOS — Grafo de contexto financiero: cuentas y deudas (fase 0 de la hoja de ruta)
--
-- Hasta hoy EOS conoce MOVIMIENTOS (lo que pasó) y FIJOS (lo que se repite),
-- pero no conoce la ESTRUCTURA: dónde vive la plata y a quién se le debe. Sin
-- eso, media hoja de ruta no se puede construir:
--
--   * Las alertas de fase 3 ("el 28 te vas a quedar corto para el alquiler")
--     necesitan saber qué cuota cae antes del próximo ingreso.
--   * La fase 4 entera —plan de pago armado solo, mensaje de negociación con
--     el acreedor— no tiene sobre qué pararse si no hay acreedores en la base.
--
-- Esto NO rompe "el usuario nunca carga transacciones a mano". Declarar una
-- vez que existe un préstamo con el Banco X no es cargar transacciones: es
-- contexto, la misma categoría que la Constitución Financiera (v51) y los
-- fijos declarados (v59). Lo prohibido sigue siendo cargar cada gasto.

-- ============================================================
-- 1) Cuentas: dónde vive la plata.
--
-- `eos_finanzas_politica.saldo_inicial` es un número único, y una PYME
-- paraguaya real tiene cuenta en un banco, algo en una cooperativa, saldo en
-- Tigo Money y efectivo en el cajón. Esta tabla no reemplaza a aquel saldo:
-- lo detalla.
-- ============================================================
create table if not exists public.eos_finanzas_cuentas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  nombre text not null,
  tipo text not null check (tipo in (
    'banco', 'cooperativa', 'financiera', 'billetera', 'efectivo', 'tarjeta_credito'
  )),
  institucion text,
  moneda text not null default 'PYG',

  -- Declarado, con su fecha. EOS no ve el saldo real de nadie: lo que puede
  -- hacer es partir de lo que el usuario dijo y aplicarle los movimientos que
  -- sí ve. Sin la fecha, ese arrastre no se puede calcular.
  saldo_declarado numeric(16,2),
  saldo_declarado_el date,

  -- Si EOS recibe avisos de esta cuenta por correo, acá queda el vínculo: es
  -- lo que le permite decir "de esta cuenta veo todo" y "de esta, nada".
  recibe_avisos boolean not null default false,

  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint eos_cuentas_saldo_con_fecha check (
    saldo_declarado is null or saldo_declarado_el is not null
  )
);

create index if not exists eos_cuentas_usuario_idx
  on public.eos_finanzas_cuentas (usuario_id) where activa;

comment on table public.eos_finanzas_cuentas is
  'Dónde vive la plata del usuario. Saldos declarados con fecha, nunca calculados a ciegas.';

comment on column public.eos_finanzas_cuentas.recibe_avisos is
  'Si EOS recibe avisos por correo de esta cuenta. Es lo que separa "veo todo" de "no veo nada" al hablar de cobertura.';

-- ============================================================
-- 2) Deudas: a quién se le debe, cuánto y cuándo.
--
-- El saldo es DECLARADO y con fecha, no calculado. EOS no ve los pagos al
-- préstamo salvo que lleguen por correo; un saldo que se recalcula solo se
-- desincroniza en silencio, y en una deuda eso es peor que no saber. Se
-- muestra siempre como "según lo que declaraste el <fecha>".
-- ============================================================
create table if not exists public.eos_finanzas_deudas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  acreedor text not null,
  tipo text not null check (tipo in (
    'prestamo', 'tarjeta', 'proveedor', 'familiar', 'impuesto', 'otro'
  )),
  moneda text not null default 'PYG',

  saldo_declarado numeric(16,2) not null check (saldo_declarado >= 0),
  saldo_declarado_el date not null default current_date,

  -- La cuota es lo que conecta la deuda con el disponible real: es plata que
  -- va a salir en una fecha conocida.
  cuota_monto numeric(16,2) check (cuota_monto is null or cuota_monto > 0),
  cuota_dia smallint check (cuota_dia is null or cuota_dia between 1 and 31),

  -- Con estos dos, la proyección SABE CUÁNDO TERMINAR. Un préstamo de 12
  -- cuotas con 10 pagadas debe descontar dos más, no descontar para siempre.
  cuotas_totales smallint check (cuotas_totales is null or cuotas_totales > 0),
  cuotas_pagadas smallint not null default 0 check (cuotas_pagadas >= 0),

  tasa_anual numeric(6,2),
  vence_el date,

  estado text not null default 'al_dia'
    check (estado in ('al_dia', 'atrasada', 'en_negociacion', 'saldada')),

  -- "¿Qué es lo que más te preocupa?" del onboarding. No es decorativo: es lo
  -- que le permite a EOS hablar primero de lo que al usuario le pesa, en vez
  -- de ordenar por monto como haría una planilla.
  preocupa boolean not null default false,
  notas text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint eos_deudas_cuota_completa check (
    (cuota_monto is null and cuota_dia is null)
    or (cuota_monto is not null and cuota_dia is not null)
  ),
  constraint eos_deudas_cuotas_coherentes check (
    cuotas_totales is null or cuotas_pagadas <= cuotas_totales
  )
);

create index if not exists eos_deudas_usuario_idx
  on public.eos_finanzas_deudas (usuario_id) where estado <> 'saldada';

comment on table public.eos_finanzas_deudas is
  'A quién le debe el usuario. Saldo declarado con fecha; las cuotas alimentan la proyección del disponible real.';

comment on column public.eos_finanzas_deudas.preocupa is
  'Marcada en el onboarding. Ordena de qué habla EOS primero: lo que pesa, no lo que es más grande.';

-- ============================================================
-- 3) Onboarding: el estado de la conversación fundacional.
--
-- Una fila por usuario. Existe para que EOS pueda cumplir la promesa del
-- cierre —"ya no tenés que contarme nada más"— y no vuelva a preguntar lo que
-- ya preguntó. Sin esto, cada sesión empezaría de cero y el producto se
-- sentiría como un formulario que no termina nunca.
-- ============================================================
create table if not exists public.eos_onboarding (
  usuario_id uuid primary key references auth.users(id) on delete cascade,

  paso text not null default 'bienvenida' check (paso in (
    'bienvenida', 'cuentas', 'ingresos', 'gastos_fijos', 'deudas', 'preocupaciones', 'correo', 'cierre', 'completado'
  )),

  -- Lo cualitativo que releva la conversación: qué le preocupa, qué evita
  -- mirar. Va acá y no en el chat porque tiene que sobrevivir a que el usuario
  -- borre una conversación.
  preocupacion_principal text,
  evita_mirar text,

  completado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.eos_onboarding is
  'Estado de la conversación fundacional. Existe para que EOS no vuelva a preguntar lo que ya preguntó.';

-- ============================================================
-- 4) RLS y blindaje de usuario_id, igual que el resto de finanzas.
-- ============================================================
alter table public.eos_finanzas_cuentas enable row level security;
alter table public.eos_finanzas_deudas enable row level security;
alter table public.eos_onboarding enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['eos_finanzas_cuentas', 'eos_finanzas_deudas', 'eos_onboarding']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = usuario_id)',
      t || '_select', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = usuario_id)',
      t || '_insert', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = usuario_id) with check ((select auth.uid()) = usuario_id)',
      t || '_update', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = usuario_id)',
      t || '_delete', t
    );

    -- Nunca filas huérfanas invisibles por RLS (lección de la migración v50).
    execute format('drop trigger if exists %I on public.%I', t || '_set_usuario_id_trg', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.eos_finanzas_set_usuario_id()',
      t || '_set_usuario_id_trg', t
    );
  end loop;
end $$;
