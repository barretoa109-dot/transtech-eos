-- EOS — poner en la vitrina lo que ya se puede vender
--
-- ============================================================
-- EL AGUJERO: MÓDULOS CONSTRUIDOS QUE NADIE PUEDE COMPRAR
-- ============================================================
--
-- ERP y CRM entraron en la v63 como `es_publico = false`, y con razón: existían
-- como tablas y no había producto detrás. La v66 les puso precio pero no los
-- mostró, porque todavía no estaban hechos.
--
-- Ahora sí lo están —clientes, productos, ventas con IVA, stock, compras,
-- embudo, seguimiento— y siguen fuera de la vitrina. Es decir: el armador no
-- los ofrece, nadie los puede contratar, y la promesa de "prendé todo y pagás
-- Gs. 500.000" no se puede cumplir porque faltan Gs. 210.000 de cosas que no
-- aparecen.
--
-- ============================================================
-- FACTURACIÓN ENTRA GRATIS, Y NO ES GENEROSIDAD
-- ============================================================
--
-- El módulo de facturación hoy hace tres de los cinco pasos de un documento
-- electrónico: numeración correlativa, CDC y el comprobante imprimible. Los dos
-- que faltan —firmar con el certificado digital y enviar a SIFEN— no son código
-- pendiente: dependen del certificado que compra el contribuyente y de la
-- habilitación de su RUC ante la SET.
--
-- Cobrar por eso hoy sería cobrar por media función. Pero dejarlo apagado es
-- peor: `exigirModulo` niega todo lo que está en el catálogo y no se contrató,
-- así que quien tiene el ERP no podría ni imprimir el comprobante de una venta
-- que ya cargó.
--
-- Entonces entra a precio cero y colgado del ERP. Cuando el circuito con la SET
-- esté cerrado de punta a punta, se le pone precio cambiando una fila — que es
-- exactamente para lo que el precio vive en la base y no en el código.
--
-- La cuenta del tope no se mueve: cero más lo de siempre sigue dando 500.000.

update public.eos_modulos
set es_publico = true
where codigo in ('erp', 'crm')
  and activo = true;

update public.eos_modulos
set es_publico = true,
    precio_mensual_pyg = 0,
    precio_anual_pyg = 0,
    requiere = '{erp}',
    descripcion =
      'Comprobantes de tus ventas con numeración y código de control. ' ||
      'La firma digital y el envío a SIFEN se habilitan cuando tengas tu ' ||
      'certificado y tu RUC habilitado por la SET.'
where codigo = 'facturacion';

-- ============================================================
-- Comprobación: prender todo tiene que seguir dando el tope
-- ============================================================
--
-- El tope de Gs. 500.000 no es una regla que recorta al final: el catálogo está
-- calibrado para que la suma dé exactamente eso. Si alguien agrega un módulo con
-- precio y se olvida de rebalancear, la promesa de la vitrine se rompe en
-- silencio y nadie se entera hasta que un usuario suma los números a mano.
--
-- Esto no lo impide —un `check` sobre una suma de filas no existe— pero lo
-- GRITA en el log de la migración, que es donde alguien lo va a ver el día que
-- pase.
do $$
declare
  v_total bigint;
  v_tope constant bigint := 500000;
begin
  select coalesce(sum(precio_mensual_pyg), 0)
    into v_total
  from (
    select distinct on (coalesce(grupo, codigo)) precio_mensual_pyg
    from public.eos_modulos
    where activo = true and es_publico = true
    order by coalesce(grupo, codigo), precio_mensual_pyg desc
  ) todo;

  if v_total <> v_tope then
    raise warning
      'EOS: prender todos los módulos suma % y el tope prometido es %. Rebalancear el catálogo o cambiar el tope.',
      v_total, v_tope;
  else
    raise notice 'EOS: el catálogo completo suma exactamente el tope (%).', v_tope;
  end if;
end $$;
