-- EOS — Medir la conversión del panel financiero personal gratis
--
-- ============================================================
-- QUÉ PROBLEMA RESUELVE
-- ============================================================
--
-- Desde la v165 (2026-09-15), el panel financiero personal es gratis para
-- toda cuenta — una apuesta deliberada de adquisición/hábito, no una
-- gentileza sin costo: cada consulta de ese panel cuesta cómputo y, cuando
-- hay movimientos por correo o por chat, también tokens de IA.
--
-- Hoy no existe ninguna forma de saber si esa apuesta rinde: si alguien que
-- usa el panel gratis después contrata un módulo de negocio pago (ERP, CRM,
-- facturación, conversaciones), o si el regalo se queda sin retorno. El
-- documento `docs/estrategia/plan-fortalecimiento-comercial-2026-09-22.md`
-- (punto 5.4, mirada de CFO) lo señala explícitamente: "cero conversión
-- medida... antes de cualquier decisión de pricing basada en este número".
--
-- Esta migración no cambia ningún comportamiento del producto. Es SOLO
-- lectura: dos vistas, nada que el usuario note.
--
-- ============================================================
-- QUÉ NO HACE
-- ============================================================
--
-- No decide si el regalo vale la pena — eso es una decisión de negocio,
-- no una migración. Solo deja la pregunta contestable con un `select`.
--
-- Tampoco distingue causalidad de correlación: una cuenta que usa el panel
-- gratis Y contrata un módulo pago después puede haberlo hecho por el panel,
-- o por cualquier otra razón. Con 6-7 cuentas reales (evidencia al
-- 2026-09-22) esta vista todavía no sirve para sacar conclusiones — sirve
-- para que, cuando haya más cuentas, la pregunta ya esté armada y no haya
-- que reconstruir el dato desde cero sobre datos históricos incompletos.

-- ============================================================
-- 1) Una fila por cuenta REAL con los dos hitos que importan
-- ============================================================

create or replace view public.eos_conversion_panel_gratis_v192 as
with
  uso_personal as (
    select usuario_id, min(fecha) as primer_uso_personal, count(*) as movimientos_personales
    from public.eos_movimientos_financieros
    where ambito = 'personal'
    group by usuario_id
  ),
  modulo_pago as (
    select usuario_id, min(creado_en) as primer_modulo_pago
    from public.eos_usuario_modulos
    where origen = 'pago'
    group by usuario_id
  )
select
  c.usuario_id,
  up.primer_uso_personal,
  coalesce(up.movimientos_personales, 0) as movimientos_personales,
  mp.primer_modulo_pago,
  (up.primer_uso_personal is not null) as uso_panel_gratis,
  (mp.primer_modulo_pago is not null) as contrato_modulo_pago,
  -- Solo tiene sentido si el uso personal vino ANTES del pago: si contrató un
  -- módulo de negocio primero y recién después tocó el panel personal, no es
  -- una conversión que el regalo haya generado.
  case
    when up.primer_uso_personal is not null
      and mp.primer_modulo_pago is not null
      and mp.primer_modulo_pago >= up.primer_uso_personal
    then extract(day from mp.primer_modulo_pago - up.primer_uso_personal)::int
  end as dias_de_panel_gratis_a_pago
from public.eos_cuentas_v172 c
left join uso_personal up on up.usuario_id = c.usuario_id
left join modulo_pago mp on mp.usuario_id = c.usuario_id
where c.tipo = 'real';

comment on view public.eos_conversion_panel_gratis_v192 is
  'Por cuenta real: si usó el panel financiero personal gratis y si después contrató un módulo de negocio pago. Solo lectura, no decide nada. Ver docs/estrategia/plan-fortalecimiento-comercial-2026-09-22.md punto 5.4.';

revoke all on table public.eos_conversion_panel_gratis_v192 from public, anon, authenticated;
grant select on table public.eos_conversion_panel_gratis_v192 to service_role;

-- ============================================================
-- 2) El resumen de una sola fila, para no repetir el conteo cada vez
-- ============================================================

create or replace view public.eos_conversion_panel_gratis_resumen_v192 as
select
  count(*) as cuentas_reales,
  count(*) filter (where uso_panel_gratis) as usan_panel_gratis,
  count(*) filter (where uso_panel_gratis and contrato_modulo_pago) as usan_panel_y_pagaron,
  count(*) filter (where dias_de_panel_gratis_a_pago is not null) as conversiones_atribuibles,
  round(avg(dias_de_panel_gratis_a_pago), 1) as promedio_dias_a_conversion
from public.eos_conversion_panel_gratis_v192;

comment on view public.eos_conversion_panel_gratis_resumen_v192 is
  'Resumen de eos_conversion_panel_gratis_v192 en una fila. Con la muestra de 2026-09-22 (6-7 cuentas reales) no alcanza para conclusiones — releer junto con el tamaño de cuentas_reales, no solo el porcentaje.';

revoke all on table public.eos_conversion_panel_gratis_resumen_v192 from public, anon, authenticated;
grant select on table public.eos_conversion_panel_gratis_resumen_v192 to service_role;
