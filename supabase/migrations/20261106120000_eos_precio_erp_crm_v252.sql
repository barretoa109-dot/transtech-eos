-- Baja el precio de ERP y CRM: el dueño pide Gs. 70.000 y Gs. 50.000 (antes
-- 120.000 y 90.000), el mismo criterio de "el anual sale diez meses" de la v66.
--
-- El total de todos los módulos prendidos baja con esto (de 500.000 a
-- 430.000), así que la comprobación de la v92 va a mostrar un `raise warning`
-- de que ya no suma exactamente el tope prometido. Es intencional: bajar un
-- precio no rompe la promesa de "no pagás más de Gs. 500.000", solo la deja
-- de ajustar al centavo. No se toca `TOPE_MENSUAL_PYG`.

update public.eos_modulos
set precio_mensual_pyg = 70000,
    precio_anual_pyg = 700000
where codigo = 'erp';

update public.eos_modulos
set precio_mensual_pyg = 50000,
    precio_anual_pyg = 500000
where codigo = 'crm';
