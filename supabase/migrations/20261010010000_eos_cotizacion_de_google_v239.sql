-- La cotización, como una vista más y nunca como un reemplazo (v239).
--
-- ============================================================
-- POR QUÉ ESTA TABLA, Y POR QUÉ ASÍ
-- ============================================================
--
-- `lib/finanzas/monedas.ts` documenta desde el 31/08 por qué EOS nunca
-- convierte entre monedas en ningún cálculo: "la cotización no la sabe
-- EOS", y traerla de algún lado sin avisar de dónde ni de cuándo sería
-- peor que no tenerla. El mismo comentario deja la puerta abierta: "si
-- mañana el usuario declara una cotización, se suma como una vista más
-- -- no como el reemplazo de estas".
--
-- El 10/10/2026 el dueño declaró esa cotización: tiene que salir de
-- Google. Google no tiene una API pública para esto -- la única forma
-- real de leer "el número de Google" es un Google Sheet publicado con la
-- fórmula GOOGLEFINANCE, exportado como CSV. Esta tabla guarda lo último
-- que se leyó de ahí, con su origen y su fecha, para que cualquier
-- pantalla que la muestre pueda decir las dos cosas -- igual que ya hace
-- cada tarjeta de "También tenés" en FinanzasPanel.tsx con el saldo
-- declarado.
--
-- Una fila por par de monedas, no un historial: la pregunta que contesta
-- esta tabla es "¿a cuánto está el dólar, según Google, y desde
-- cuándo?", no "cuánto valió cada día del año". Si alguna vez hiciera
-- falta una serie, se agrega entonces.
--
-- Sin `usuario_id` a propósito: una cotización no es un dato personal, es
-- la misma para cualquiera que la mire el mismo día. Meterla en una tabla
-- por persona la duplicaría sin necesidad.

create table if not exists public.eos_cotizaciones (
  moneda_desde text not null,
  moneda_hasta text not null,
  valor numeric(16,4) not null check (valor > 0),
  origen text not null default 'google',
  obtenida_en timestamptz not null default now(),
  primary key (moneda_desde, moneda_hasta)
);

comment on table public.eos_cotizaciones is
  'v239: la última cotización conocida por par de monedas, con su origen y su fecha. Es una vista informativa -- ningún cálculo financiero la usa. Ver lib/finanzas/monedas.ts.';

alter table public.eos_cotizaciones enable row level security;

-- De lectura pública para cualquier sesión autenticada: no es un dato de
-- nadie en particular, y las pantallas que la muestran ya exigen sesión
-- por su cuenta. Escribe únicamente el cron, con service_role.
drop policy if exists eos_cotizaciones_lectura on public.eos_cotizaciones;
create policy eos_cotizaciones_lectura on public.eos_cotizaciones
  for select to authenticated
  using (true);

revoke all on public.eos_cotizaciones from anon;
