-- Las descripciones de ERP y CRM prometían menos de lo que el producto hace.
--
-- ============================================================
-- UNA PROMESA DESACTUALIZADA TAMBIÉN ES UNA PROMESA FALSA
-- ============================================================
--
-- La v92 rotuló ERP y CRM como beta y escribió en la descripción qué NO tenían
-- todavía. Fue la decisión correcta: son los dos módulos más caros del
-- catálogo después de las conversaciones, y vender "ERP" a secas cuando falta
-- la mitad es cómo se pierde un cliente en la segunda semana.
--
-- Entre el 2 y el 4 de septiembre se construyó buena parte de esa lista, y el
-- texto se quedó donde estaba. Hoy la pantalla dice, textual:
--
--   ERP: "Todavía NO hay sucursales ni usuarios de equipo, depósitos, cuenta
--         corriente con vencimientos y cuotas, ni costeo valorizado: la cuenta
--         es de una persona y el stock es un saldo por producto."
--
--   CRM: "Todavía NO hay embudo con etapas, razones de pérdida ni reportes de
--         desempeño comercial."
--
-- De esas ocho afirmaciones, cinco dejaron de ser ciertas:
--
--   · "usuarios de equipo" — existen desde la v109: empresas, miembros,
--     invitaciones y siete roles. Hay 55 empresas y 13 miembros en producción.
--   · "la cuenta es de una persona" — desde la v119 la empresa es la ÚNICA
--     frontera, en las policies y en el filtro de las rutas.
--   · "cuenta corriente con vencimientos y cuotas" — v107.
--   · "costeo valorizado" y "el stock es un saldo por producto" — v108: kardex
--     con costo unitario y valor resultante por movimiento, y costo promedio
--     ponderado mantenido por trigger.
--   · "embudo con etapas" — v103/v104, y además se llena solo con las ventas.
--
-- Prometer de menos parece la falla segura y no lo es. Alguien que necesita
-- cuenta corriente lee que no está y no contrata; alguien que la contrató
-- igual no la usa porque la pantalla le dijo que no existía. Se paga en ventas
-- que no ocurren y en funciones que nadie encuentra, que es más difícil de
-- notar que una queja.
--
-- ============================================================
-- LO QUE SIGUE SIENDO BETA, Y POR QUÉ
-- ============================================================
--
-- Los dos siguen rotulados "(beta)" y los dos siguen diciendo qué falta. No es
-- un ascenso: es la misma honestidad con la lista al día.
--
-- Lo que falta sale de `docs/lanzamiento/alcance-congelado.md`, que se corrige
-- en el mismo commit: sucursales, depósitos y el circuito de documentos
-- (orden, cotización, entrega parcial, nota de crédito) del lado del ERP;
-- razones de pérdida y reportes de desempeño del lado del CRM.
--
-- Los precios no se tocan. El tope de Gs. 500.000 está calibrado con estos dos
-- adentro y moverlos obligaría a rebalancear el catálogo entero.

update public.eos_modulos
set descripcion =
  'Productos, ventas, compras, stock y anulaciones, conectados a lo que EOS ya sabe de tu negocio. '
  || 'Ya hay costeo valorizado, cuenta corriente con vencimientos, caja del negocio y equipo con roles. '
  || 'Todavía NO hay sucursales ni depósitos, ni el circuito de documentos: orden de compra, cotización, '
  || 'entrega parcial y nota de crédito.'
where codigo = 'erp';

update public.eos_modulos
set descripcion =
  'Tus clientes y proveedores, las oportunidades abiertas y las actividades de cada una, sobre el mismo '
  || 'contexto de EOS. El embudo tiene etapas y se llena solo con tus ventas. Todavía NO hay razones de '
  || 'pérdida ni reportes de desempeño comercial.'
where codigo = 'crm';
