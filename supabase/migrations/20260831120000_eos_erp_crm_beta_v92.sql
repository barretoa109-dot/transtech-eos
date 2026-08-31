-- Que el ERP y el CRM se llamen por lo que hacen hoy (v92).
--
-- ============================================================
-- LA MISMA DECISIÓN QUE YA SE TOMÓ EN LA v87
-- ============================================================
--
-- La v87 renombró "Factura electrónica" a "Comprobantes de venta (beta)" con
-- un argumento que no era exclusivo de la facturación: en una lista de doce
-- módulos la gente lee NOMBRES, no descripciones. Un nombre que promete de más
-- se paga con la sensación de que le vendieron otra cosa — y esa sensación no
-- se queda en el módulo, se lleva la confianza en todo el producto.
--
-- ERP y CRM están en la misma situación y no se habían corregido.
--
-- Lo que el ERP hace hoy: productos con código, precio, costo, moneda, IVA,
-- stock y mínimo; ventas y compras con ítems y movimientos financieros y de
-- stock atómicos; anulación en una sola transacción con auditoría; ajustes de
-- inventario con motivo. Es un ERP que funciona.
--
-- Lo que NO hace, y alguien que contrata "ERP" da por sentado:
--
--   * empresas con miembros, roles y sucursales — la cuenta es de UNA persona;
--   * depósitos, ubicaciones, transferencias, lotes, series y vencimientos —
--     el stock es un solo saldo por producto;
--   * cuenta corriente con vencimientos, cuotas y saldos parciales — "crédito"
--     hoy significa nada más "todavía no cobrado";
--   * kardex valorizado — el costo es el último costo conocido;
--   * ciclo documental previo: orden, cotización, pedido, recepción y entrega
--     parcial, devolución, nota de crédito;
--   * caja y tesorería con turno, arqueo y cierre.
--
-- El CRM tiene contactos, oportunidades y actividades. No tiene embudo con
-- etapas, razones de pérdida ni reportes de desempeño comercial.
--
-- Ver `docs/erp-profesional-arquitectura.md` para la brecha completa y
-- `docs/lanzamiento/alcance-congelado.md` para qué se anuncia y qué no.
--
-- El día que cada fase esté cerrada, esta migración se revierte con otra y el
-- nombre vuelve a ser el que corresponde. Que sea fácil de revertir es parte
-- del punto: el nombre sigue a la realidad, no al revés.
--
-- ============================================================
-- EL PRECIO NO SE TOCA — Y POR ESO MISMO URGE EL RÓTULO
-- ============================================================
--
-- El ERP sale Gs. 120.000 por mes y el CRM Gs. 90.000 (v66). El ERP es el
-- módulo más caro del catálogo después de conversaciones ilimitadas. Nadie
-- paga eso esperando menos de lo que dice el nombre, y ahí está el riesgo:
-- cuanto más caro el módulo, más cara la sensación de que le vendieron otra
-- cosa.
--
-- Los precios quedan como están: el tope de Gs. 500.000 del armado está
-- calibrado con ellos adentro. Esta migración cambia texto y nada más.

update public.eos_modulos
   set nombre = 'ERP (beta)',
       descripcion =
         'Productos, ventas, compras, stock y anulaciones, conectados a lo que EOS ya sabe de tu '
         || 'negocio. Todavía NO hay sucursales ni usuarios de equipo, depósitos, cuenta corriente '
         || 'con vencimientos y cuotas, ni costeo valorizado: la cuenta es de una persona y el stock '
         || 'es un saldo por producto.'
 where codigo = 'erp';

update public.eos_modulos
   set nombre = 'CRM (beta)',
       descripcion =
         'Tus clientes y proveedores, las oportunidades que tenés abiertas y las actividades de cada '
         || 'una, sobre el mismo contexto de EOS. Todavía NO hay embudo con etapas, razones de '
         || 'pérdida ni reportes de desempeño comercial.'
 where codigo = 'crm';

-- ============================================================
-- Comprobación: que el tope siga siendo el que promete la vitrina
-- ============================================================
--
-- Misma guarda que trae la v73, y con el mismo `raise warning` y no una
-- excepción: esta migración no toca ningún precio, así que abortar el renombre
-- por un desbalance que viene de otro lado sería frenar lo correcto por un
-- problema ajeno. Lo que hace falta es que quede GRITADO en el log.

do $$
declare
  v_total bigint;
  v_tope constant bigint := 500000;
begin
  select coalesce(sum(precio_mensual_pyg), 0) into v_total
  from (
    select distinct on (coalesce(grupo, codigo)) precio_mensual_pyg
    from public.eos_modulos
    where activo = true and es_publico = true
    order by coalesce(grupo, codigo), precio_mensual_pyg desc
  ) as uno_por_grupo;

  if v_total <> v_tope then
    raise warning
      'EOS: prender todos los módulos suma % y el tope prometido es %. Rebalancear el catálogo o cambiar el tope.',
      v_total, v_tope;
  else
    raise notice 'EOS: el catálogo completo sigue sumando exactamente el tope (%).', v_tope;
  end if;
end;
$$;
