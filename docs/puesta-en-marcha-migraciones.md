# Puesta en marcha: migraciones v64 a v75

> **Estado al 2026-08-26: las doce migraciones YA ESTÁN APLICADAS** en el
> proyecto `TransTech EOS`, verificado con `supabase migration list --linked`:
> no queda ninguna pendiente. Lo que falta es **desplegar el código**, que hoy
> está commiteado y sin pushear.
>
> Este documento queda como registro de qué trae cada una y de lo que se
> aprendió aplicándolas.

Doce migraciones. **El orden importa y el momento del deploy también**: hay un
caso en el que desplegar antes de migrar apaga funciones para todos, y por eso
se aplicaron primero.

| # | Archivo | Qué trae |
| --- | --- | --- |
| v64 | `20260826140000_eos_documentos_generados_v64.sql` | Documentos que EOS arma a pedido |
| v65 | `20260826150000_eos_finanzas_multimoneda_v65.sql` | `moneda` en los gastos fijos + índice |
| v66 | `20260826160000_eos_plan_armado_v66.sql` | El plan que arma el usuario |
| v67 | `20260826170000_eos_erp_crm_v67.sql` | Tablas de ERP y CRM |
| v68 | `20260826180000_eos_factura_electronica_v68.sql` | Facturación electrónica |
| v69 | `20260826190000_eos_erp_registrar_venta_v69.sql` | Registrar una venta, entera |
| v70 | `20260826200000_eos_erp_registrar_compra_v70.sql` | Registrar una compra, entera |
| v71 | `20260826210000_eos_bancard_armado_v71.sql` | Cobrar el armado con tarjeta y renovarlo |
| v72 | `20260826220000_eos_revocar_anon_finanzas_v72.sql` | Sacarle a `anon` el permiso sobre las tablas de plata |
| v73 | `20260826230000_eos_vitrina_negocio_v73.sql` | Poner ERP, CRM y facturación en la vitrina |
| v74 | `20260826240000_eos_cortesia_facturacion_v74.sql` | Completar la cortesía de las cuentas viejas |
| v75 | `20260826250000_eos_facturacion_de_quien_v75.sql` | Aclarar de quién son las facturas del módulo |

Correlas en orden. v66 depende de que exista `eos_modulos` (v63, ya aplicada),
v68 depende de las tablas de v67, y v69 y v70 de las de v67 y de
`eos_movimientos_financieros`. La v69 además ensancha el `check` de
`origen` para admitir `erp`, del que dependen las dos.

## El orden entre migrar y desplegar

**Aplicar las migraciones ANTES de desplegar el código.** Ya se hizo en ese
orden; queda escrito para el próximo entorno.

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

El camino de tarjeta hace lo mismo desde la v71: `/pago/tarjeta?armado=…` crea
la solicitud con `eos_bancard_crear_pago_armado_v71`, que es idéntica a las
funciones certificadas de Bancard salvo en de dónde sale el monto. Y la
renovación lee `eos_armado_vigente` antes de cobrar, así que el mes dos cobra
el armado y no el tramo.

Ninguna función de Bancard existente fue modificada: la certificación en curso
no se toca.

### El armado sin conversaciones: resuelto, y lo que destapó

Un armado sin tramo de conversaciones manda `plan_codigo = 'free'` a la
confirmación. Se leyó la definición real de `asignar_plan_eos` en la base —no
está versionada en el repo— y **acepta `free` sin error**: existe como plan
activo con cupo de 5 mensajes.

Pero deja `plan_vencimiento = NULL` para todo lo que sea free, y un NULL no
entra en un filtro de rango. Con la consulta vieja, ese usuario nunca habría
sido candidato a renovación: sus módulos vencían en silencio, perdía el producto
que paga y nadie volvía a cobrarle.

Por eso el cron ahora busca dos poblaciones: los planes de siempre por su
`plan_vencimiento`, y los EOS armados por el vencimiento de **sus módulos**, que
es lo que de verdad se les acaba. Los que caen en las dos listas se deduplican
antes de cobrar.

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

## Lista para salir a vender

~~1. Aplicar las migraciones.~~ **Hecho el 2026-08-26.**

~~2. Probar el armado sin conversaciones.~~ **Resuelto leyendo la base**: ver la
sección de arriba. Se encontró y se corrigió un problema de renovación que la
prueba habría tardado un mes en mostrar.

Queda:

1. **Desplegar** (hoy son varios commits sin pushear).
2. **Pegar en el prompt de n8n** el texto de
   [`documentos-a-pedido.md`](documentos-a-pedido.md). Sin eso, EOS sabe armar
   archivos pero nunca los pide: es lo único que separa esa función de estar
   andando.
3. **Para la factura electrónica del USUARIO** (no la de TransTech, que la emite
   Bancard): el certificado digital y la habilitación del RUC los consigue cada
   usuario. Ver [`facturacion-quien-emite-que.md`](facturacion-quien-emite-que.md),
   que separa los tres circuitos que usan esa palabra.
4. **Facturar los pagos por transferencia.** Bancard emite solo lo que pasa por
   su pasarela; las transferencias quedan afuera y hay que facturarlas aparte.

Lo que **no** hace falta para vender, pero conviene mirar después:

- La deuda de `any` en `lib/bancard.ts`, `lib/bancard-cobro.ts` y los dos
  `worker-gate-*`. CI ya la muestra en cada PR sin bloquear; el día que llegue a
  cero, sacar el `continue-on-error` del workflow.
- Doce componentes vacíos en `app/components/ui/` y dos archivos vacíos en la
  raíz (`lib-backup.txt`, `supabase-schema.sql`). Son ruido, no riesgo; se
  dejaron por si son andamio de algo en curso.
- `public.usuarios` no tiene su política de RLS versionada en el repo. Se
  verificó que con la clave anónima da 401, así que hoy está bien cerrada — pero
  esa garantía vive solo en la base y nadie la puede revisar desde acá.
