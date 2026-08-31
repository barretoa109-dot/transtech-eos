# EOS ERP profesional: brecha, arquitectura y fases

Estado auditado: 28 de agosto de 2026.

## Decisión de producto

EOS ERP se construye como una plataforma de gestión empresarial profesional para
emprendedores y PYMEs. No es un anexo reducido del chat. El chat, las finanzas,
el CRM, los documentos y las automatizaciones son canales del mismo sistema;
ninguno reemplaza al núcleo transaccional ni puede saltarse sus controles.

Una función se considera comercializable solo cuando su flujo completo está
implementado, autorizado, auditado y probado. La comunicación pública puede
describir lo que ya funciona y la dirección del producto, pero no presentar
como disponible una fase todavía pendiente.

## Inventario actual

### 1. Operativo y verificado hoy

- Contactos como clientes/proveedores, oportunidades y actividades CRM.
- Productos/servicios con código, precio final, costo, moneda, IVA, stock y
  mínimo; edición y baja lógica.
- Ventas y compras con ítems, IVA incluido, contado/crédito, cobro/pago,
  movimientos financieros y movimientos de stock atómicos.
- Anulación de ventas/compras y ajustes de inventario con motivo.
- Panel financiero multimoneda y documentos descargables.
- Comprobante interno con numeración y CDC; se identifica explícitamente como
  borrador mientras no esté firmado y aprobado por SIFEN.
- Contexto empresarial de lectura para EOS y acciones ERP/CRM autorizadas a
  través del Worker Gate.
- RLS y endurecimiento de relaciones entre usuarios en el modelo actual.

### 2. Existente, pero incompleto o no certificado

- La propiedad es principalmente `usuario_id`; no existe una empresa con
  miembros, roles y sucursales como raíz del tenant.
- Inventario de un solo saldo por producto, sin depósitos ni reservas.
- Venta y compra nacen como operación final; no hay ciclo documental previo.
- Crédito significa “todavía no cobrado/pagado”, sin vencimientos, cuotas,
  saldos parciales ni cuenta corriente.
- Costo es último costo conocido; no existe kardex valorizado ni método de
  costeo configurable.
- La auditoría general existe, pero no todas las operaciones ERP escriben un
  evento empresarial uniforme con antes/después y autor.
- SIFEN no está integrado oficialmente: faltan firma, envío, respuesta,
  contingencia y eventos fiscales homologados.
- Las migraciones v78-v80 tuvieron edición/despliegue concurrente. Debe
  documentarse el drift y toda corrección futura debe ser forward-only.

### 3. Ausente

- Empresas, sucursales, establecimientos, usuarios empresariales y permisos.
- Variantes, categorías jerárquicas, marcas, unidades convertibles, códigos de
  barras y listas de precios.
- Depósitos, ubicaciones, transferencias, reservas, lotes, series y vencimiento.
- Órdenes de compra, recepciones, devoluciones y cuentas por pagar.
- Cotizaciones, pedidos, entregas, devoluciones, notas de crédito y cuentas por
  cobrar.
- Caja, turnos, arqueos, bancos y tesorería empresarial.
- Márgenes por documento/producto/cliente y rentabilidad consistente.
- Cierres operativos/fiscales y reaperturas autorizadas.
- Importadores masivos, exportaciones operativas, webhooks y API pública
  versionada.
- Reportes profesionales de inventario, ventas, compras, cartera, tesorería y
  rentabilidad.

### 4. Dependencias externas o regulatorias

- SIFEN/e-Kuatia: habilitación del contribuyente, certificado digital,
  credenciales, timbrado, pruebas y homologación ante DNIT.
- Bancos/pasarelas: contratos, credenciales, ambientes de certificación,
  webhooks y disponibilidad de cada proveedor.
- Importación contable: formatos y criterios del contador/estudio que recibirá
  la información; EOS no debe inventar equivalencias tributarias.
- Integraciones de terceros: límites, estabilidad, versionado, protección de
  datos y autorización del titular.
- Operación multiusuario: definición contractual de responsabilidades,
  conservación de auditoría y procedimiento de baja de colaboradores.

Una dependencia externa no se resuelve ocultándola detrás de un botón. El flujo
debe declarar qué parte controla EOS, qué parte controla el proveedor y cómo se
recupera una operación inconclusa.

## Matriz de brechas priorizada

| Prioridad | Brecha | Valor para el usuario | Riesgo actual | Dependencias | Criterio de aceptación | Pruebas necesarias |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Invariantes de anulación, costo y documento fiscal | Corregir errores sin mentir en stock, margen ni impuestos | Una anulación puede dejar costo incorrecto o ignorar un documento fiscal relacionado | Modelo actual de compras, ventas, stock, finanzas y FE | Registrar/cobrar/pagar/anular conserva todas las invariantes; la repetición no cambia el resultado | SQL transaccional, concurrencia, idempotencia, líneas repetidas, compra posterior, varios documentos FE, fecha PY |
| P0 | Drift de migraciones v78-v80 | Poder reproducir y auditar producción | El repositorio puede contar una historia distinta a la base | Historial de despliegues y copias exactas | Diferencias documentadas; ninguna migración aplicada vuelve a editarse; toda corrección es forward-only | Comparación local/remota, checksum disponible, instalación desde cero y upgrade |
| P0 | Frontera empresarial y roles | Trabajar con colaboradores sin compartir una cuenta | `usuario_id` mezcla actor y empresa; no escala a permisos ni sucursales | Migración compatible de cuentas actuales | Cada usuario actual obtiene una empresa inicial; roles y sucursales aíslan lectura/escritura | RLS cross-company, matriz de permisos, cambio de sucursal, baja de miembro, service-role abuse |
| P0 | Auditoría empresarial uniforme | Saber quién cambió dinero, stock o documentos y por qué | Hay trazas parciales con formatos distintos | Empresa/actor, catálogo de comandos | Todo comando sensible registra actor, empresa, antes/después, motivo, correlación e idempotency key | Integridad de cadena, fallos parciales, doble comando, exportación de auditoría |
| P1 | Maestros profesionales | Evitar duplicados y vender/comprar variantes reales | Producto plano no representa talla, color, unidad o precios por canal | Empresa, sucursal e impuestos | SKU/variante/unidad/precio vigentes no alteran documentos históricos | Unicidad por empresa, conversiones, vigencias, importación con errores |
| P1 | Inventario multi-depósito | Conocer dónde está cada unidad y moverla sin perder trazabilidad | Un saldo único no distingue local, depósito ni reserva | Maestros y sucursales | Kardex por depósito cierra; transferencias no crean/destruyen stock; reservas no duplican disponibilidad | Concurrencia, transferencia parcial, conteo, merma, lote/serie, saldo negativo autorizado |
| P1 | Ciclo de compras y cuentas por pagar | Comprar, recibir y pagar parcial sin planillas paralelas | Compra final mezcla recepción, obligación y pago | Terceros, inventario, tesorería | Orden, recepción, factura y pago son hechos separados y conciliables | Recepción/factura parcial, anticipo, vencimientos, devolución, idempotencia |
| P1 | Ciclo de ventas y cuentas por cobrar | Cotizar, entregar, facturar y cobrar parcial con estado de cuenta | Venta final mezcla compromisos y ejecución | Inventario, CRM, tesorería y FE | Cotización→pedido→entrega→factura→cobro mantiene cantidades y saldos | Reserva concurrente, entrega parcial, mora, devolución, nota de crédito, límite de crédito |
| P1 | Devoluciones y reversos | Resolver hechos reales sin borrar operaciones | “Anular” no representa devolución ni dinero que volvió | Compras/ventas, stock, tesorería, impuestos | Devolución referencia documento original y revierte exactamente stock, saldo, costo e impuesto aplicable | Parcial/total, período cerrado, documento fiscal, repetición y autorización |
| P1 | Caja, tesorería y conciliación financiera | Saber dónde está el dinero y cerrar el día | Cobro/pago alimenta finanzas, pero no existe caja/arqueo empresarial | Empresa, sucursal, cuentas y medios de pago | Cada movimiento pertenece a caja/cuenta; arqueo y conciliación explican diferencias | Apertura/cierre, cambio de turno, transferencia, diferencia, extracto duplicado |
| P1 | Cierres operativos | Impedir cambios retroactivos silenciosos | Períodos abiertos permiten alterar historia sin procedimiento | Roles, auditoría y ciclos completos | Período cerrado rechaza mutaciones; reapertura exige permiso, motivo y evento | Zona horaria PY, cierre concurrente, reapertura, documento posterior |
| P2 | Costos, márgenes y rentabilidad | Decidir precios y detectar ventas a pérdida | Último costo no alcanza para valorización reproducible | Kardex e inventario | Método de costo único y documentado produce margen trazable por línea | Compra/venta/devolución, moneda, ajuste, cierre y snapshot histórico |
| P2 | Reportes operativos/ejecutivos | Gestionar sin exportar todo a otra herramienta | Informes actuales son financieros generales, no ERP completo | Todos los ciclos fuente | Cada cifra permite llegar al documento origen y se reproduce en períodos cerrados | Reconciliación de totales, permisos, grandes volúmenes, Excel/PDF/Word |
| P2 | Importación/exportación y API | Migrar datos e integrar canales sin recarga manual | Solo hay endpoints internos y exportaciones generales | Maestros, permisos y auditoría | API versionada e importador con simulación, idempotencia y errores por fila | CSV/XLSX adversarial, rate limit, webhook firmado, replay, scopes |
| P2 | SIFEN homologado | Emitir documentos fiscales válidos desde el ciclo de venta | Hoy solo hay borrador interno con CDC | DNIT, certificado, timbrado y homologación | Firma, envío, aprobación/rechazo, contingencia y eventos pasan certificación | Casos oficiales DNIT, reintento, timeout, duplicado, nota de crédito, KuDE |

## MVP comercial profesional

“MVP” define el primer alcance vendible, no una versión simplificada de cada
función. Todo flujo incluido debe estar completo de punta a punta.

### Incluido en el MVP

1. **Empresa y acceso:** una empresa, una o más sucursales, miembros, roles
   operativos y auditoría uniforme.
2. **Maestros:** clientes/proveedores y productos con variantes básicas,
   unidades, impuestos, costo y lista de precio principal por moneda.
3. **Inventario:** al menos un depósito por sucursal, kardex, transferencias,
   conteos, ajustes, mínimos y trazabilidad; lotes/series pueden habilitarse por
   producto, pero si se ofrecen deben cubrir entrada, movimiento y salida.
4. **Compras:** orden opcional, recepción, factura de proveedor, cuenta por
   pagar, vencimiento, pago total/parcial y devolución.
5. **Ventas:** cotización, pedido, entrega, cuenta por cobrar, cobro total/parcial
   y devolución. El comprobante fiscal se mantiene rotulado como interno hasta
   completar SIFEN.
6. **Caja y finanzas:** cajas/cuentas, cobros/pagos, cierre, conciliación con el
   panel EOS y estado de cuenta de terceros.
7. **Control:** cierre de período, reversos autorizados, reportes de stock,
   ventas, compras, cartera, caja y margen básico trazable.
8. **EOS:** lectura de resúmenes y comandos allowlisted con confirmación
   explícita; ninguna escritura genérica ni autorización decidida por el modelo.

### Fuera del MVP, sin bloquear su profesionalidad

- Manufactura/MRP, nómina, activos fijos, proyectos y contabilidad de libro
  mayor completa.
- Personalizaciones por industria, marketplaces y conectores especializados.
- SIFEN productivo hasta completar dependencia y homologación externa.

Estos módulos pueden llegar después porque son dominios adicionales. En cambio,
cuentas parciales, devoluciones, auditoría, permisos, cierres y conciliación no
se recortan: son partes necesarias para que los ciclos ofrecidos sean correctos.

## Arquitectura objetivo

```text
empresa
├── sucursales / establecimientos
├── miembros ── roles ── permisos
├── depósitos ── ubicaciones ── lotes/series
├── maestros (productos, variantes, impuestos, precios, terceros)
├── ventas (cotización → pedido → entrega → factura → cobro/devolución)
├── compras (orden → recepción → factura → pago/devolución)
├── caja y tesorería ── conciliación financiera
└── auditoría, cierres, reportes, documentos, API y automatizaciones
```

Reglas transversales:

1. `empresa_id` es la frontera de datos. `usuario_id` identifica al actor, no
   al dueño económico del documento.
2. Dinero, stock y documentos fiscales cambian solo mediante comandos
   transaccionales; nunca con escrituras genéricas desde el chat o el cliente.
3. Cada comando sensible incluye clave idempotente, actor, empresa, sucursal,
   motivo y vínculo al documento origen.
4. Una corrección se representa con anulación, reverso, devolución o nota de
   crédito. No se borra un hecho confirmado.
5. EOS prepara y explica; ejecuta solo tras autorización clara y por una acción
   allowlisted. El modelo nunca elige `usuario_id`, `empresa_id` ni permisos.
6. Fechas de negocio se calculan en `America/Asuncion`; timestamps se conservan
   en UTC.
7. PYG no usa decimales comerciales; monedas extranjeras mantienen su escala.
   IVA 10 %, 5 % y exento se calcula desde precio final cuando corresponda.

## Plan por fases

### Fase 0 — Integridad del núcleo existente

Objetivo: poder confiar en lo que ya se vende.

- Cerrar la restauración de costo al anular compras con líneas repetidas y
  compras posteriores.
- Bloquear anulación si existe cualquier documento fiscal no cancelable, no
  solo el último; cancelar todos los borradores relacionados.
- Eliminar acciones imposibles de filas anuladas y normalizar errores 4xx.
- Congelar y documentar el drift v78-v80.
- Añadir pruebas SQL de concurrencia, doble ejecución, tenant ajeno, fecha PY y
  reversión completa de stock/dinero/costo.

Criterio de aceptación: las invariantes de stock, finanzas y documentos cierran
antes y después de registrar, cobrar/pagar y anular; repetir el comando no
cambia el resultado.

### Fase 1 — Empresa, sucursales y permisos

- `empresas`, `sucursales`, `miembros`, `roles`, `permisos` y asignaciones.
- Migración compatible desde cada cuenta actual a una empresa inicial.
- Contexto empresarial seleccionado en API, UI, EOS y auditoría.
- Permisos mínimos: propietario, administrador, ventas, compras, depósito,
  caja, contabilidad y solo lectura; alcance opcional por sucursal.

Criterio de aceptación: dos empresas y dos sucursales no pueden cruzar datos;
cada rol puede ejecutar exactamente sus permisos; service role no convierte
un id del modelo en autorización.

### Fase 2 — Maestros profesionales

- Categorías, marcas, variantes, atributos, unidades y conversiones.
- SKU/código de barras únicos por empresa, impuestos y vigencias.
- Listas de precios por moneda, cliente/canal y fecha; historial de costos.
- Terceros completos con condiciones comerciales, contactos y direcciones.
- Importación CSV/XLSX validada con simulación previa y reporte de errores.

Criterio de aceptación: una variante se identifica sin ambigüedad; cambiar
precio/costo no altera documentos históricos; importación es atómica por lote.

### Fase 3 — Inventario multi-depósito

- Depósitos, ubicaciones, existencias por variante y reservas.
- Kardex inmutable, transferencias con salida/recepción y estados.
- Conteos, ajustes, mermas, lotes, series, vencimientos y alertas.
- Valorización definida (inicialmente promedio móvil o último costo, no ambos).

Criterio de aceptación: saldo físico = suma del kardex por depósito; ninguna
transferencia crea o destruye unidades; lote/serie mantiene trazabilidad total.

### Fase 4 — Compras y cuentas por pagar

- Solicitud/orden, aprobación, recepción parcial, factura de proveedor.
- Cuentas por pagar con vencimientos, pagos parciales, anticipos y retenciones.
- Devolución a proveedor y nota de débito/crédito vinculada.

Criterio de aceptación: recibir mueve stock, facturar crea obligación y pagar
mueve tesorería, cada hecho una sola vez aunque llegue repetido.

### Fase 5 — Ventas y cuentas por cobrar

- Cotización, pedido, reserva, entrega parcial, factura y cobro parcial.
- Condiciones, límites de crédito, vencimientos y estado de cuenta.
- Devoluciones, notas de crédito y reversos fiscales/operativos.

Criterio de aceptación: entregar, facturar y cobrar son hechos separados; una
devolución revierte cantidades, costo, cuenta corriente e impuesto con vínculo
al documento original.

### Fase 6 — Caja, tesorería y conciliación

- Cajas, turnos, apertura/cierre, ingresos/egresos y arqueo.
- Cuentas bancarias, transferencias internas y medios de pago.
- Conciliación entre ERP, finanzas EOS y extractos; diferencias explicables.

Criterio de aceptación: cada cobro/pago pertenece a una caja o cuenta; el
cierre detecta diferencias y no puede reabrirse sin permiso y auditoría.

### Fase 7 — Costos, cierres y reportes

- Margen bruto y rentabilidad por producto, cliente, canal y sucursal.
- Inventario valorizado, rotación, quiebres, cartera y antigüedad de saldos.
- Cierres por período y snapshots reproducibles.
- Reportes ejecutivos conectados con Dashboard, Briefing y documentos EOS.

Criterio de aceptación: cada cifra enlaza a sus documentos fuente y se
reproduce para un período cerrado sin depender del estado actual del maestro.

### Fase 8 — SIFEN, integraciones y API

- Certificados por empresa, firma, envío, consulta, rechazo y reintento.
- Eventos, notas de crédito, contingencia y KuDE según homologación vigente.
- API versionada, webhooks firmados, límites, idempotencia e integraciones.
- Exportaciones para contador y trazabilidad de cada intercambio.

Criterio de aceptación: suite de homologación SIFEN aprobada en ambiente de
prueba antes de producción; webhook repetido no duplica ningún efecto.

## Puertas de calidad por fase

Cada fase debe pasar, como mínimo:

- migración nueva forward-only y comparación local/remota;
- RLS/privilegios/advisors y pruebas cross-tenant;
- tests unitarios y SQL de invariantes, concurrencia e idempotencia;
- TypeScript, lint focal, suite completa y evals EOS;
- recorrido de navegador de los flujos felices y errores recuperables;
- prueba de autorización del chat y rechazo de comandos manipulados;
- documentación operativa, rollback lógico y claims comerciales actualizados.

No se inicia una fase dependiente si la anterior no tiene sus invariantes
cerradas. En particular, multi-depósito no comienza antes de empresa/roles, y
SIFEN no se presenta como disponible antes de homologación real.
