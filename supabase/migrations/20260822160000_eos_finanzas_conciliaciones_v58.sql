-- EOS Finanzas — conciliación de saldo
--
-- EOS ve lo que llega por correo, documentos o chat. No ve los pagos con
-- billetera, el efectivo, ni nada sin rastro digital. En Paraguay hoy no hay
-- forma de capturar todo eso automáticamente, así que `disponible_real`
-- mostraba un número con total confianza estando equivocado — y el usuario
-- decide con él.
--
-- La corrección NO es pedirle que cargue lo que falta: eso lo convierte en el
-- empleado de EOS, que es lo que la doctrina rechaza. Es pedirle UN número
-- —cuánto tiene de verdad— dos veces, y a partir de ahí no volver a
-- preguntar: con dos puntos EOS calcula a qué ritmo se le escapa dinero y lo
-- descuenta solo.
--
-- Cada fila es una foto: "el día X yo tenía Y". Nunca se modifican ni se
-- borran, porque la serie completa es la que permite calcular el ritmo.

create table if not exists public.eos_finanzas_conciliaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  fecha date not null default current_date,
  saldo_declarado numeric(16,2) not null,

  -- Lo que EOS calculaba en ese momento. No se usa para calcular nada: se
  -- guarda para poder mostrarle al usuario cuánto se había desviado, y para
  -- poder auditar el comportamiento del algoritmo con datos reales.
  saldo_calculado numeric(16,2),

  -- 'usuario' = lo declaró a mano; 'chat' = se lo dijo a EOS conversando.
  origen text not null default 'usuario'
    check (origen in ('usuario', 'chat')),

  created_at timestamptz not null default now(),

  -- Una foto por día. Si el usuario corrige el mismo día, se reemplaza:
  -- dos valores distintos para la misma fecha romperían el cálculo del ritmo.
  unique (usuario_id, fecha)
);

create index if not exists eos_conciliaciones_usuario_fecha_idx
  on public.eos_finanzas_conciliaciones (usuario_id, fecha desc);

comment on table public.eos_finanzas_conciliaciones is
  'Saldo real declarado por el usuario. Con dos filas EOS aprende su ritmo de gasto invisible y deja de preguntar.';

-- ============================================================
-- RLS: cada usuario ve y escribe solo lo suyo.
-- ============================================================
alter table public.eos_finanzas_conciliaciones enable row level security;

drop policy if exists conciliaciones_select on public.eos_finanzas_conciliaciones;
create policy conciliaciones_select on public.eos_finanzas_conciliaciones
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists conciliaciones_insert on public.eos_finanzas_conciliaciones;
create policy conciliaciones_insert on public.eos_finanzas_conciliaciones
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists conciliaciones_update on public.eos_finanzas_conciliaciones;
create policy conciliaciones_update on public.eos_finanzas_conciliaciones
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

-- Mismo blindaje que el resto de finanzas: nunca una fila huérfana que RLS
-- deje invisible pero siga contando en los cálculos del servidor.
drop trigger if exists eos_conciliaciones_set_usuario_id_trg on public.eos_finanzas_conciliaciones;
create trigger eos_conciliaciones_set_usuario_id_trg
  before insert on public.eos_finanzas_conciliaciones
  for each row execute function public.eos_finanzas_set_usuario_id();
