# Facturación: quién le factura a quién

Tres cosas distintas que usan la palabra "factura" y no son la misma. Mezclarlas
es fácil y caro, así que quedan separadas acá.

## 1. TransTech le factura al cliente de EOS

**Lo resuelve Bancard.** TransTech contrató el producto de facturación
electrónica de Bancard, que emite la factura automáticamente con el timbrado de
TransTech (RUC 80174259-5, TRANSTECH E.A.S.) por los pagos que pasan por su
pasarela.

EOS no emite nada de esto y no debería empezar a hacerlo: duplicar la emisión
sería emitir dos veces el mismo hecho imponible.

### Lo que hay que tener en cuenta

- **El webhook de Bancard no devuelve la factura.** Se verificó contra un pago
  confirmado real: la respuesta trae `response`, `response_code`,
  `ticket_number` y `authorization_description`, y nada del documento
  electrónico. Así que EOS **no sabe** qué factura corresponde a qué cobro. Si un
  cliente la pide, hay que buscarla en el panel de Bancard.
- **Los pagos por TRANSFERENCIA no pasan por Bancard.** El armador ofrece
  transferencia como alternativa a la tarjeta, y esos cobros quedan fuera de la
  emisión automática: hay que facturarlos aparte. Es una tarea operativa, no un
  agujero del software, pero si nadie la hace es una obligación tributaria sin
  cumplir.

## 2. El usuario de EOS le factura a SU cliente

**Es el módulo `facturacion` del ERP.** Una panadería que le vende a Rossana
necesita emitir con **su** RUC, **su** timbrado y **su** certificado digital.
El producto que TransTech contrató a Bancard no cubre eso: cubre las ventas de
TransTech, no las de sus usuarios.

Hoy ese módulo hace tres de los cinco pasos:

| Paso | Estado |
| --- | --- |
| Armar el documento con numeración correlativa | ✅ |
| Calcular el CDC de 44 dígitos | ✅ |
| Firmarlo con el certificado del contribuyente | ❌ |
| Enviarlo a SIFEN y esperar aprobación | ❌ |
| Generar el comprobante imprimible | ✅ |

Por eso el documento nace en estado `borrador` y el papel sale rotulado. Los dos
pasos que faltan dependen del **certificado digital que compra cada usuario** y
de la **habilitación de su propio RUC** ante la SET.

### El camino corto para cuando se quiera cerrar

Si Bancard vende el mismo producto de facturación a terceros, el módulo podría
delegar la emisión en ellos en vez de firmar por su cuenta: EOS ya arma el
documento entero y le faltaría solo mandarlo. Sería el mismo proveedor que ya
usa la plataforma para cobrar, con una integración menos que mantener y sin
guardar certificados de nadie.

La alternativa es firmar en el servidor, y ahí aparece el problema que la
migración v68 evita a propósito: guardar el `.p12` de cada usuario es guardar su
identidad tributaria dentro de cualquier backup que se filtre.

## 3. Lo que EOS no hace, y no debería

- No emite las facturas de TransTech (las hace Bancard).
- No guarda certificados digitales de nadie.
- No llama "factura" a un comprobante que la SET no aprobó.

Esa última no es prolijidad de vocabulario: quien entrega un comprobante creyendo
que es una factura electrónica tiene un problema con la SET, y confía en que el
sistema no le mienta sobre eso.
