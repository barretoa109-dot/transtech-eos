-- EOS Finanzas — que cada moneda sea su propio mundo
--
-- ============================================================
-- EL BUG QUE ESTO CIERRA
-- ============================================================
--
-- `eos_movimientos_financieros.moneda` existe desde la primera migración de
-- finanzas (v51) y nunca se leyó: el panel sumaba todos los `monto` como si
-- fueran guaraníes. Alguien que cobra 500 dólares y gasta 500.000 guaraníes
-- veía "saldo 500.500", un número que no existe en ninguna moneda, mostrado
-- con la misma confianza que el resto del panel.
--
-- El cálculo pasa a hacerse por moneda (ver `lib/finanzas/monedas.ts`). De las
-- piezas que alimentan ese cálculo, la única que no sabía en qué moneda estaba
-- era el gasto fijo declarado — y una suscripción en dólares es de lo más común
-- que hay acá.
--
-- ============================================================
-- POR QUÉ LA COLUMNA ES NULA Y NO 'PYG'
-- ============================================================
--
-- Un default 'PYG' etiquetaría como guaraníes las filas que ya existen, y para
-- un usuario cuya Constitución Financiera está en dólares eso sería falso —
-- justamente el tipo de dato inventado que este cambio viene a eliminar.
--
-- `null` significa "la moneda del usuario", que es lo que esas filas siempre
-- quisieron decir. La aplicación resuelve el `null` contra
-- `eos_finanzas_politica.moneda`, así que un cambio de moneda principal las
-- reinterpreta a todas juntas, sin migración de datos.

alter table public.eos_finanzas_fijos
  add column if not exists moneda text;

comment on column public.eos_finanzas_fijos.moneda is
  'Moneda del fijo. NULL = la de la Constitución Financiera del usuario.';

-- ============================================================
-- LO QUE ESTA MIGRACIÓN NO TOCA, A PROPÓSITO
-- ============================================================
--
-- `eos_finanzas_conciliaciones` sigue siendo de UNA moneda: la principal.
--
-- Conciliar es "decime tu saldo real para que aprenda cuánto se te va sin que
-- yo lo vea", y el gasto invisible —efectivo, billetera— ocurre en la moneda
-- con la que se vive, no en los ahorros en dólares. Además la tabla tiene un
-- `unique (usuario_id, fecha)` del que depende el upsert de
-- `app/api/finanzas/conciliar`: abrirlo por moneda obliga a cambiar la
-- restricción y el destino del ON CONFLICT, y eso es un cambio con riesgo
-- propio para resolver un caso que todavía no existe.
--
-- El punto de partida de las OTRAS monedas ya tiene su lugar y es mejor:
-- `eos_finanzas_cuentas` guarda saldo declarado, fecha y moneda de cada cuenta
-- desde la v61.

-- El panel consulta los movimientos filtrando por moneda; sin este índice, cada
-- carga del dashboard recorre la tabla entera una vez por moneda.
create index if not exists eos_movimientos_usuario_moneda_fecha_idx
  on public.eos_movimientos_financieros (usuario_id, moneda, fecha desc);
