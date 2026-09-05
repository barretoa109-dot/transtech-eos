-- La caja del negocio (v120).
--
-- ============================================================
-- EL DATO QUE DESBLOQUEA MÁS POR MENOS
-- ============================================================
--
-- `docs/contabilidad-hasta-donde-llega.md` lo dejó anotado: de todo lo que
-- falta para cerrar los números de un negocio, el saldo de caja y bancos es el
-- único que, con una sola tabla, enciende tres cosas a la vez.
--
--   · La liquidez corriente deja de ser un PISO y pasa a ser el número.
--   · La prueba ácida se puede calcular por primera vez.
--   · El pronóstico deja de decir "no se conoce el disponible" y puede avisar
--     qué día se cae la caja.
--
-- ============================================================
-- POR QUÉ NO SE REUSA `eos_finanzas_cuentas`
-- ============================================================
--
-- Esa tabla es de la PERSONA y cuelga de `usuario_id`. Meter ahí la caja del
-- negocio cruzaría la frontera que el resto del sistema respeta desde la
-- etapa 4: un empleado invitado vería la cuenta personal de su jefe, y el
-- resultado del negocio se mezclaría con los ahorros de quien lo cargó.
--
-- EOS también es para quien no tiene una empresa. Las dos tablas conviven
-- porque son dos cosas distintas.
--
-- ============================================================
-- DECLARADO MÁS LO QUE EOS SÍ VE
-- ============================================================
--
-- Misma forma que `eos_finanzas_cuentas`, y por el mismo motivo escrito allá:
-- EOS no ve el saldo real de nadie. Lo que puede hacer es partir de lo que el
-- dueño declaró, con su fecha, y arrastrarle los movimientos que sí conoce
-- —los cobros y pagos de la cuenta corriente (v107)— desde ese día.
--
-- Sin `saldo_declarado_el` ese arrastre no se puede calcular, y un saldo sin
-- fecha envejece sin avisar. Por eso las dos columnas van juntas y el
-- constraint las obliga: o están las dos o no está ninguna.

create table if not exists public.eos_empresa_cajas_v120 (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.eos_empresas(id) on delete cascade,

  nombre text not null,
  tipo text not null default 'efectivo' check (tipo in (
    'efectivo', 'banco', 'cooperativa', 'financiera', 'billetera'
  )),

  -- Una caja es de UNA moneda. Un saldo mixto no es un saldo: sumar guaraníes
  -- con dólares exigiría un tipo de cambio que este sistema no tiene.
  moneda text not null default 'PYG',

  saldo_declarado numeric(16, 2),
  saldo_declarado_el date,

  -- Cerrar una caja no la borra: sus movimientos históricos siguen siendo
  -- ciertos. Deja de sumar al disponible y deja de ofrecerse.
  activa boolean not null default true,

  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint eos_caja_saldo_con_fecha check (
    (saldo_declarado is null and saldo_declarado_el is null)
    or (saldo_declarado is not null and saldo_declarado_el is not null)
  ),

  -- Una caja declarada al futuro haría que el arrastre reste movimientos que
  -- ya estaban contados en ella.
  constraint eos_caja_fecha_no_futura check (
    saldo_declarado_el is null or saldo_declarado_el <= current_date
  )
);

comment on table public.eos_empresa_cajas_v120 is
  'v120: dónde tiene la plata el negocio. Saldo declarado con su fecha; los cobros y pagos posteriores se le arrastran. NO es la caja personal, que vive en eos_finanzas_cuentas.';

comment on column public.eos_empresa_cajas_v120.saldo_declarado_el is
  'Desde cuándo vale el saldo. Sin esto no se puede arrastrar nada y el número envejece sin avisar.';

create index if not exists eos_empresa_cajas_por_empresa
  on public.eos_empresa_cajas_v120 (empresa_id)
  where activa;

-- ============================================================
-- Quién la ve
-- ============================================================
--
-- Solo por empresa, como quedó todo después de la etapa 4 (v119). Sin `or
-- usuario_id`: esta tabla nace después de esa decisión y no tiene por qué
-- arrastrar la red que las otras ya soltaron.

alter table public.eos_empresa_cajas_v120 enable row level security;

drop policy if exists eos_empresa_cajas_propia on public.eos_empresa_cajas_v120;
create policy eos_empresa_cajas_propia
  on public.eos_empresa_cajas_v120
  for all to authenticated
  using (empresa_id = (select public.eos_mi_empresa_v109()))
  with check (empresa_id = (select public.eos_mi_empresa_v109()));

-- La clave pública está en el JavaScript del navegador y no es un secreto.
-- Cualquier tabla con plata adentro le revoca todo a `anon`.
revoke all on table public.eos_empresa_cajas_v120 from anon;
grant select, insert, update, delete on table public.eos_empresa_cajas_v120 to authenticated;
grant all on table public.eos_empresa_cajas_v120 to service_role;

-- ============================================================
-- Mantener `actualizado_en` honesto
-- ============================================================

create or replace function public.eos_caja_tocar_v120()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists eos_caja_tocar on public.eos_empresa_cajas_v120;
create trigger eos_caja_tocar
  before update on public.eos_empresa_cajas_v120
  for each row
  execute function public.eos_caja_tocar_v120();
