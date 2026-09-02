-- ============================================================
-- v102 · Una venta de las diez de la noche es de hoy, no de mañana
-- ============================================================
--
-- QUÉ PASABA
--
-- El 1 de septiembre de 2026 a las 22:24 de Paraguay se registró una venta por
-- chat. Funcionó todo: la aprobación se consumió, la venta se creó, el
-- movimiento de dinero también. Y no se veía en ninguna pantalla.
--
-- La venta había quedado fechada el 2 de septiembre.
--
-- POR QUÉ
--
-- Las cuatro funciones del ERP que ponen una fecha usaban `current_date`, que
-- es la fecha del servidor en UTC. Paraguay está tres o cuatro horas atrás,
-- así que entre las 20:00 y la medianoche —hora local— `current_date` ya es el
-- día siguiente.
--
-- El efecto es feo de una manera particular: todas las noches, durante las
-- horas de más venta de cualquier comercio, lo que se registra queda con fecha
-- de mañana. No se pierde, pero desaparece de "hoy", de "esta semana" y de
-- "este mes" hasta que el reloj alcanza a la fecha. Quien lo mira concluye que
-- el sistema no guardó nada.
--
-- La app ya hacía lo correcto: `hoyEnParaguay()` en `lib/fecha.ts` existe desde
-- hace tiempo y usa la zona horaria. La base no tenía su equivalente, y ahí es
-- donde se decide la fecha de una venta.
--
-- QUÉ SE ARREGLA
--
--   1. `eos_hoy_py()`, que es la fecha de hoy en Asunción. Una sola definición,
--      para que no haya dos respuestas a "¿qué día es?".
--   2. Las cuatro funciones pasan a usarla en lugar de `current_date`.
--   3. Las filas que ya quedaron fechadas mañana se corrigen.
--
-- Sobre el punto 3: la condición es estrecha a propósito. Sólo se toca lo que
-- tiene exactamente la firma de este error —fecha igual al día UTC en que se
-- creó, y posterior al día paraguayo en que se creó—. Una compra que alguien
-- fechó a futuro a mano no cumple eso y no se toca.

-- ============================================================
-- 1. Qué día es hoy, una sola vez
-- ============================================================

create or replace function public.eos_hoy_py()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (now() at time zone 'America/Asuncion')::date;
$$;

comment on function public.eos_hoy_py() is
  'La fecha de hoy en Paraguay. Reemplaza a current_date, que es UTC y desde las 20:00 locales ya es mañana.';

grant execute on function public.eos_hoy_py() to service_role;

-- ============================================================
-- 2. Las cuatro funciones que fechaban en UTC
-- ============================================================
--
-- Se reescriben con su propia definición para no volver a tipear cuerpos
-- largos: `pg_get_functiondef` devuelve el CREATE completo —firma, volatilidad,
-- security definer, search_path— y sólo se le cambia el `current_date`. Copiar
-- los cuerpos a mano acá sería la forma más probable de introducir un error
-- distinto en una función que mueve stock y plata.

do $$
declare
  f record;
  definicion text;
  cambiadas int := 0;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'eos_erp_registrar_venta',
        'eos_erp_registrar_compra',
        'eos_erp_cobrar_venta',
        'eos_erp_pagar_compra'
      )
      and p.prosrc like '%current_date%'
  loop
    definicion := pg_get_functiondef(f.oid);
    definicion := replace(definicion, 'current_date', 'public.eos_hoy_py()');
    execute definicion;
    cambiadas := cambiadas + 1;
    raise notice 'v102: % ahora fecha en hora de Paraguay', f.proname;
  end loop;

  raise notice 'v102: % función(es) corregida(s)', cambiadas;
end $$;

-- ============================================================
-- 3. Lo que ya quedó fechado mañana
-- ============================================================

update public.eos_erp_ventas
set fecha = (creado_en at time zone 'America/Asuncion')::date
where fecha = (creado_en at time zone 'UTC')::date
  and fecha > (creado_en at time zone 'America/Asuncion')::date;

update public.eos_erp_compras
set fecha = (creado_en at time zone 'America/Asuncion')::date
where fecha = (creado_en at time zone 'UTC')::date
  and fecha > (creado_en at time zone 'America/Asuncion')::date;

update public.eos_movimientos_financieros
set fecha = (created_at at time zone 'America/Asuncion')::date
where fecha = (created_at at time zone 'UTC')::date
  and fecha > (created_at at time zone 'America/Asuncion')::date;
