# Puesta en marcha: migraciones v64 a v70

> El archivo conserva el nombre `v64-v69` porque ya hay documentos que lo
> enlazan así. La v70 llegó después y está incluida acá abajo.

Siete migraciones nuevas. **El orden importa y el momento del deploy también**:
hay un caso en el que desplegar antes de migrar apaga funciones para todos.

| # | Archivo | Qué trae |
| --- | --- | --- |
| v64 | `20260826140000_eos_documentos_generados_v64.sql` | Documentos que EOS arma a pedido |
| v65 | `20260826150000_eos_finanzas_multimoneda_v65.sql` | `moneda` en los gastos fijos + índice |
| v66 | `20260826160000_eos_plan_armado_v66.sql` | El plan que arma el usuario |
| v67 | `20260826170000_eos_erp_crm_v67.sql` | Tablas de ERP y CRM |
| v68 | `20260826180000_eos_factura_electronica_v68.sql` | Facturación electrónica |
| v69 | `20260826190000_eos_erp_registrar_venta_v69.sql` | Registrar una venta, entera |
| v70 | `20260826200000_eos_erp_registrar_compra_v70.sql` | Registrar una compra, entera |

Correlas en orden. v66 depende de que exista `eos_modulos` (v63, ya aplicada),
v68 depende de las tablas de v67, y v69 y v70 de las de v67 y de
`eos_movimientos_financieros`. La v69 además ensancha el `check` de
`origen` para admitir `erp`, del que dependen las dos.

## El orden entre migrar y desplegar

**Aplicar las migraciones ANTES de desplegar el código.**

Desde este cambio, las funciones se piden por módulo (`exigirModulo`). Sin el
catálogo sembrado —que lo siembra la v66— la puerta no encontraría los módulos.
Hay una red de seguridad para eso: **si un módulo no está en el catálogo, se
permite el acceso**, porque negar apagaría una función que nadie tuvo
oportunidad de contratar, justo después de un deploy y a todos a la vez.

Pero esa red cubre el caso "el módulo no existe todavía", no el caso "el módulo
existe y esta cuenta no lo contrató". Por eso la v66 además **le regala todos
los módulos a las cuentas que ya existían**, sin vencimiento y marcados como
`cortesia`, para que las métricas de ingresos no los cuenten como ventas.

## Lo que cambia para el que ya usaba EOS

- Nada se apaga: las cuentas anteriores quedan con todo activo por cortesía.
- La pantalla `/planes` deja de mostrar planes y pasa a ser el armador.
- Los planes `personal`, `pro` y `business` siguen existiendo en la base como
  **portadores del cupo de mensajes**, no como producto. La v66 les fija el cupo
  de cada tramo (300 / 1.000 / sin tope).
- `planes.es_publico` **no se toca**, a propósito: apagarlos rompería las
  compras de prueba de la certificación de Bancard que está en curso.

## Cómo cobra el plan armado

1. El usuario elige funciones en `/planes`; el total se calcula en pantalla para
   que responda al instante.
2. `POST /api/modulos/armado` **recalcula todo en la base** (`eos_precio_armado`)
   y descarta el total que mandó el navegador. Guarda el armado.
3. El checkout de transferencia (`/pago?armado=…`) crea la solicitud con
   `eos_crear_solicitud_armado_v66`, que toma el monto del armado.
4. Cuando la solicitud pasa a `pagado`, un **trigger** activa los módulos.

No se modificó ninguna función de cobro existente. La solicitud sigue llevando
un `plan_codigo` de los de siempre —el del tramo de conversaciones elegido— así
que `asignar_plan_eos` sigue fijando el plan y el cupo sin enterarse de nada.

### Lo que falta conectar

- **Tarjeta.** El camino de Bancard todavía cobra por plan. Para que cobre un
  armado hay que pasarle el `armado_id` en `solicitudes_pago.metadata`: el
  trigger ya hace el resto.
- **Renovación.** El cobro recurrente lee el precio del plan, así que renovaría
  por el tramo y no por el armado completo. El monto correcto está en
  `eos_planes_armados` con `estado = 'vigente'`.

Las dos cosas viven en la cadena de Bancard, que tiene su propia sesión de
trabajo; por eso quedaron señaladas y no tocadas.

## Factura electrónica: hasta dónde llega hoy

Emitir un documento electrónico en Paraguay son cinco pasos. Están hechos el 1,
el 2 y el 5:

1. ✅ Armar el documento con su numeración y sus datos.
2. ✅ Calcular el CDC de 44 dígitos.
3. ❌ **Firmarlo con el certificado digital del contribuyente.**
4. ❌ **Enviarlo a SIFEN y esperar la aprobación.**
5. ✅ Generar el comprobante imprimible.

Los pasos 3 y 4 no son código pendiente: dependen del **certificado digital**
que el contribuyente compra a un prestador habilitado y de la **habilitación del
RUC como facturador electrónico** ante la SET, con sus credenciales de ambiente
de prueba. Hasta que eso exista, el documento nace en estado `borrador` y tanto
la respuesta de la API como el papel lo dicen con todas las letras.

Antes de emitir en producción hay que **contrastar al menos un CDC contra el
ambiente de prueba de SIFEN**. El algoritmo del dígito verificador está
implementado y con tests, pero un dígito mal calculado no se descubre
facturando: se descubre cuando SIFEN rechaza el lote y el comprobante ya se
entregó.

El certificado **no se guarda en la base**. `eos_fe_config.certificado_ref`
guarda el nombre del secreto donde vive, nunca el archivo: un `.p12` en una fila
es la identidad tributaria del usuario dentro de cualquier backup que se filtre.

## Verificación hecha y verificación pendiente

Verificado en el navegador contra un catálogo de prueba: el armador suma bien
(45.000 + 20.000 = 65.000), prender todo da 500.000 clavados, el anual da
5.000.000 y elegir un tramo reemplaza al otro en vez de sumarse.

**Sin verificar en pantalla**: todo lo que vive detrás del login —el panel
multimoneda, la vista Negocio, la descarga de documentos desde el chat— porque
requiere una sesión real. El build de producción pasa y los 334 tests también,
pero eso no reemplaza abrirlo.
