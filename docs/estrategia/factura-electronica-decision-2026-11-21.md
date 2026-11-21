# Factura electrónica completa: la decisión que falta (21/11/2026)

Punto 5 del plan para subir la aceptación. En la simulación de 100 clientes,
cuatro negocios grandes (autopartes, ferretería, supermercado, fábrica de
uniformes) compran Full o Emprendedor apenas EOS emita la factura electrónica
**completa**: firmada y aceptada por SIFEN. Hoy no la emite.

## Dónde está hoy

Del módulo `facturacion` (ver `docs/facturacion-quien-emite-que.md`):

| Paso | Estado |
| --- | --- |
| Armar el documento con numeración correlativa | Hecho |
| Calcular el CDC de 44 dígitos (`lib/facturacion/cdc.ts`) | Hecho |
| Generar el comprobante imprimible (KuDE) | Hecho |
| **Firmar con el certificado del contribuyente** | Falta |
| **Enviar a SIFEN y guardar la respuesta** | Falta |

Los dos pasos que faltan no se pueden programar "a ciegas": dependen de un
certificado digital de cada cliente, de que su RUC esté habilitado como
facturador electrónico ante la SET y de un ambiente de pruebas de SIFEN con
ese RUC. Nada de eso existe en el repositorio ni en una sesión de trabajo.

## Las tres formas de cerrarlo

### A. Delegar en Bancard (si lo vende a terceros)
TransTech ya usa el producto de facturación de Bancard para sus propias
ventas. Si Bancard ofrece emitir **en nombre de los clientes de TransTech**
(cada uno con su RUC y su timbrado), EOS le manda el documento que ya arma y
guarda la respuesta.

- A favor: el mismo proveedor que ya cobra; EOS no guarda certificados de nadie.
- En contra: depende de que exista ese producto y de su precio por documento.
- Trabajo en EOS: una integración (enviar, consultar estado, guardar el XML
  aprobado y el CDC). Estimo 1 a 2 semanas una vez que haya credenciales de
  prueba.

### B. Un proveedor de facturación electrónica con API
Hay empresas habilitadas en Paraguay que firman y envían a SIFEN por API, para
muchos RUC. El cliente de EOS le da su certificado a ese proveedor, no a EOS.

- A favor: no depende de Bancard; EOS tampoco guarda certificados.
- En contra: otro proveedor, otro contrato, costo por documento o mensual.
- Trabajo en EOS: igual que A.

### C. Firmar en EOS
El cliente sube su certificado `.p12` y EOS firma y envía directo a SIFEN.

- A favor: sin intermediarios ni costo por documento.
- En contra: EOS pasa a guardar la identidad tributaria de cada cliente. La
  v68 lo evitó a propósito: un respaldo filtrado sería un desastre. Exige
  cifrado con un servicio de claves aparte, rotación y un plan de incidentes.
  Además hay que implementar y mantener la firma XML y los web services de
  SIFEN.
- Trabajo en EOS: 4 a 6 semanas, más la parte de seguridad.

## Recomendación

**A si Bancard lo ofrece; si no, B.** C solo si el volumen hace que el costo
por documento pese más que el riesgo, y no es el caso con los clientes de hoy.

## Lo que necesita el dueño antes de programar

1. Preguntarle a Bancard si su facturación electrónica emite por terceros
   (RUC y timbrado de cada cliente de TransTech) y a qué precio.
2. Si no, pedir propuesta a uno o dos proveedores con API para SIFEN.
3. Un cliente piloto con RUC habilitado como facturador electrónico y su
   certificado, para probar en el ambiente de pruebas de SIFEN.

Con las credenciales de prueba del proveedor elegido, la integración se arma
en una sesión de trabajo como las demás: el documento y el CDC ya están.
