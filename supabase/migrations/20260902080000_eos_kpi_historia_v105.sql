-- La historia de cada indicador, una foto por día (v105).
--
-- ============================================================
-- POR QUÉ HACE FALTA GUARDARLA
-- ============================================================
--
-- El motor de KPIs (`lib/kpi/`) calcula todo al vuelo desde las ventas, las
-- compras y los movimientos. Eso alcanza para responder "¿cuánto vendí este
-- mes?" y "¿más o menos que el mes pasado?", porque las dos salen de datos que
-- todavía existen.
--
-- Lo que NO se puede reconstruir es el pasado de un indicador cuyo insumo
-- cambió. El margen de julio se calcula con el costo que el producto tiene
-- HOY: si el costo se actualizó en agosto, el "margen de julio" que muestra la
-- pantalla hoy no es el que se vio en julio. Lo mismo con el stock, que es un
-- saldo del momento y no tiene historia: "capital inmovilizado en agosto" es
-- incalculable hacia atrás.
--
-- Guardar la foto del día es la única forma de que "cómo venías" signifique
-- algo. Y es lo que separa "subió 24% contra el mes pasado" —dos puntos— de
-- "viene subiendo hace seis semanas", que es una afirmación distinta y mucho
-- más útil.
--
-- ============================================================
-- UNA FILA POR INDICADOR, MONEDA Y DÍA
-- ============================================================
--
-- La clave primaria incluye la moneda porque el catálogo devuelve un resultado
-- por moneda y nunca los suma: guardar "ventas del 1 de septiembre" sin decir
-- en qué moneda sería exactamente el error que este proyecto ya corrigió en la
-- v94.
--
-- Incluye la fecha para que capturar dos veces el mismo día no duplique nada.
-- El cron corre una vez, pero un reintento tras un timeout parcial es normal;
-- el `on conflict` lo vuelve idempotente y además deja que la segunda corrida
-- CORRIJA a la primera si entre medio se cargaron datos.
--
-- ============================================================
-- POR QUÉ EL VALOR ES NULLABLE
-- ============================================================
--
-- Un indicador que no se pudo calcular es un hecho que vale la pena guardar,
-- y no es lo mismo que un cero. "El margen no se pudo calcular durante tres
-- semanas porque nadie cargaba los costos" es justamente el patrón que EOS
-- tiene que poder ver para avisarlo. Por eso `valor` admite null y va con su
-- `motivo` al lado.
--
-- `confianza` acompaña al valor por la misma razón: una ganancia calculada con
-- 6 de 15 ventas sin costo vale menos que una calculada con todas, y esa
-- diferencia se pierde si solo se guarda el número.

create table if not exists public.eos_kpi_historia_v105 (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  indicador text not null,
  moneda text not null,
  fecha date not null,

  -- Sin escala fija: acá conviven guaraníes enteros, porcentajes con decimal
  -- y días con decimal. Redondear en la base perdería el detalle del que
  -- depende la tendencia.
  valor numeric,
  motivo text,

  familia text not null,
  unidad text not null,
  estado text not null check (estado in ('bien', 'atencion', 'alerta', 'sin_datos')),
  confianza numeric(4, 3) not null default 1 check (confianza >= 0 and confianza <= 1),

  capturado_en timestamptz not null default now(),

  primary key (usuario_id, indicador, moneda, fecha)
);

comment on table public.eos_kpi_historia_v105 is
  'v105: una foto diaria de cada indicador por moneda, para poder ver la tendencia real y no solo el período contra el anterior.';

comment on column public.eos_kpi_historia_v105.valor is
  'Null cuando el indicador no se pudo calcular ese día; el porqué va en motivo. Null no es cero.';

comment on column public.eos_kpi_historia_v105.confianza is
  'De 0 a 1. Menos de 1 significa que el número salió con datos incompletos (ej.: ventas sin costo cargado).';

-- La consulta que sirve a la pantalla es siempre "la serie de ESTE indicador,
-- en ESTA moneda, de los últimos N días", en orden.
create index if not exists eos_kpi_historia_serie_idx
  on public.eos_kpi_historia_v105 (usuario_id, indicador, moneda, fecha desc);

alter table public.eos_kpi_historia_v105 enable row level security;

drop policy if exists eos_kpi_historia_select_own on public.eos_kpi_historia_v105;
create policy eos_kpi_historia_select_own
  on public.eos_kpi_historia_v105
  for select to authenticated
  using ((select auth.uid()) = usuario_id);

-- La regla del proyecto: toda tabla con datos de una persona le revoca todo a
-- `anon`. Esto dice cuánto vende y cuánto gana alguien todos los días; es de
-- lo más sensible que guarda EOS.
--
-- `authenticated` recibe SELECT y nada más: la escritura es del servidor. Si
-- el dueño pudiera escribir su propia historia, dejaría de ser evidencia.
revoke all on table public.eos_kpi_historia_v105 from public, anon, authenticated;
grant select on table public.eos_kpi_historia_v105 to authenticated;
grant all on table public.eos_kpi_historia_v105 to service_role;
