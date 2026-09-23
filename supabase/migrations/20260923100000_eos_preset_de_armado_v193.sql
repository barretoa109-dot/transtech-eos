-- EOS — Registrar desde qué combinación armada llegó cada compra
--
-- ============================================================
-- QUÉ PROBLEMA RESUELVE
-- ============================================================
--
-- El punto 9 del plan de fortalecimiento
-- (docs/estrategia/simplificacion-precios-diseno.md) agrega a /planes tres
-- combinaciones ya armadas ("Empezar", "Negocio", "Negocio completo") que
-- PRE-LLENAN el armador. No son planes: el precio sigue saliendo de
-- `eos_precio_armado` y todo queda editable.
--
-- Para saber si el atajo ayuda o sobra hace falta anotar, en cada armado, si
-- se partió de una combinación y si la persona la dejó tal cual o la editó.
-- Sin eso, dentro de dos meses la pregunta "¿los presets venden?" se contesta
-- con intuición.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- Dos columnas NULLABLES en `eos_planes_armados`. No se toca
-- `eos_guardar_armado` ni nada del cobro: la ruta las completa en un update
-- aparte, después de guardar, y si ese update falla el armado queda igual
-- (solo se pierde el dato de medición, nunca la compra).
--
--   preset_origen   'empezar' | 'negocio' | 'negocio_completo', o null si armó
--                   desde cero.
--   preset_editado  true si partió de un preset y lo cambió antes de pagar.
--
-- Y una vista de solo lectura, solo para service_role, que cuenta cuántos
-- armados de cada origen llegaron a quedar vigentes (= se pagaron).

alter table public.eos_planes_armados
  add column if not exists preset_origen text,
  add column if not exists preset_editado boolean;

alter table public.eos_planes_armados
  drop constraint if exists eos_planes_armados_preset_origen_chk;

alter table public.eos_planes_armados
  add constraint eos_planes_armados_preset_origen_chk
  check (preset_origen is null or preset_origen in ('empezar', 'negocio', 'negocio_completo'));

comment on column public.eos_planes_armados.preset_origen is
  'Combinación armada desde la que se partió en /planes (v193). Null = armado desde cero. Solo medición: no afecta el precio.';
comment on column public.eos_planes_armados.preset_editado is
  'True si se partió de un preset y se cambió antes de pagar (v193). Null si no hubo preset.';

create or replace view public.eos_conversion_presets_v193 as
select
  coalesce(a.preset_origen, 'desde_cero') as origen,
  coalesce(a.preset_editado, false) as editado,
  count(*) as armados,
  count(*) filter (where a.estado in ('vigente', 'reemplazado')) as pagados,
  round(avg(a.monto) filter (where a.estado in ('vigente', 'reemplazado')))::bigint as monto_promedio_pagado
from public.eos_planes_armados a
join public.eos_cuentas_v172 c on c.usuario_id = a.usuario_id and c.tipo = 'real'
where a.creado_en >= timestamptz '2026-09-23 00:00:00-03'
group by 1, 2;

comment on view public.eos_conversion_presets_v193 is
  'Armados de cuentas reales desde la v193, por origen (preset o desde cero) y si se editó: cuántos se crearon y cuántos se pagaron. Solo lectura. Ver docs/estrategia/simplificacion-precios-diseno.md.';

revoke all on table public.eos_conversion_presets_v193 from public, anon, authenticated;
grant select on table public.eos_conversion_presets_v193 to service_role;
