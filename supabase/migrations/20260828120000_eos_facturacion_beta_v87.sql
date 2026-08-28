-- Que el módulo se llame por lo que hace hoy (v87).
--
-- ============================================================
-- EL NOMBRE PROMETÍA MÁS QUE LA DESCRIPCIÓN
-- ============================================================
--
-- Se llamaba "Factura electrónica". La descripción sí aclaraba que la firma y
-- el envío a SIFEN se habilitan cuando el usuario tenga su certificado y su RUC
-- habilitado por la SET — pero en una lista de doce módulos la gente lee
-- nombres, no descripciones.
--
-- Alguien lo contrataba creyendo que iba a facturar, descubría que no, y con
-- razón sentía que le habían vendido otra cosa. Era el único lugar del producto
-- donde prometíamos algo que todavía no cumplimos.
--
-- Hoy el módulo hace tres de los cinco pasos de una factura electrónica: arma
-- el documento con numeración correlativa, calcula el CDC de 44 dígitos y saca
-- el comprobante imprimible. Faltan firmarlo y enviarlo a SIFEN, y ninguno de
-- los dos depende de nosotros. Ver `docs/facturacion-quien-emite-que.md`.
--
-- Así que se llama por lo que hace: comprobantes. Y lleva "(beta)" adelante,
-- que es lo que ya se decidió para no venderlo como certificado.
--
-- El día que la firma y el envío estén andando, esta migración se revierte con
-- otra y el nombre vuelve a ser el que corresponde. Que sea fácil de revertir
-- es parte del punto: el nombre tiene que seguir a la realidad, no al revés.

update public.eos_modulos
   set nombre = 'Comprobantes de venta (beta)',
       descripcion =
         'Emití el comprobante de TUS ventas, con numeración correlativa y código de control (CDC). '
         || 'Todavía NO es una factura electrónica aprobada: la firma digital y el envío a SIFEN se '
         || 'habilitan cuando tengas tu certificado y tu RUC habilitado por la SET. Mientras tanto el '
         || 'papel sale rotulado como borrador.'
 where codigo = 'facturacion';
