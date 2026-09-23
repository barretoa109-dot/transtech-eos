# EOS Personal: revisión del trabajo de Claude y lista de implementación

Fecha: 8 de septiembre de 2026. OUTCOME: completed para la revisión; Personal sigue parcial.

## Alcance y versión realmente revisada

La carpeta inicial `transtech-eos` está en `codex/anka-foundation`, commit
`826cc2c9e8d7a39d55159e483160de16a590bf95`. No contiene el Personal más reciente.
La revisión principal corresponde a `C:/Users/galea/transtech-eos-business-os`,
rama `main`, commit `e61f806814657a0d915b3d0b435b2d7c55c1bca2`, también señalado por
la referencia local `origin/main`. Los commits examinados atribuyen coautoría a
Claude Opus 5. No se verificó el HEAD remoto con una consulta Git exitosa.

Claude continúa editando esa copia. Durante esta revisión se observaron cambios
sin commit en `app/api/finanzas/fijos/route.ts`, `FinanzasFijos.tsx` y, después,
`negocio/Resultado.tsx`. Son trabajo en curso, no funcionalidad certificada.
Los hashes de los dos archivos usados en las reproducciones están en la evidencia.

No se modificó código del producto, se aplicaron migraciones ni se insertaron
datos en producción. No había una sesión de EOS en el navegador disponible para
esta tarea. Por tanto, esta revisión combina lectura del código, pruebas locales
y reproducciones con dependencias simuladas; no certifica la interfaz autenticada
ni la base remota. `CLAUDE_REVIEW.md` es una fotografía del 26 de agosto y sus
cantidades y pendientes no describen esta versión.

## Qué construyó realmente Claude

| Cambio | Evidencia | Estado |
|---|---|---|
| Separación Personal/Negocio en movimientos y fijos, filtros y regla del ERP | `9822442`, migraciones v136, script `ambito-declarado.mjs` | Implementado; separación completa de extremo a extremo pendiente de certificar |
| Navegación Personal y explicación del alcance | `fd0dc50`, `Sidebar.tsx`, `GastosView.tsx` | Implementado |
| Reunir disponible, trayectoria, categorías, deudas e informes en Personal | `1b851c1`, `GastosView.tsx`, `DashboardView.tsx` | Implementado; componentes reutilizados |
| Ver y editar cuentas declaradas | `1b851c1`, `FinanzasCuentas.tsx` | Implementado con fallos reproducidos abajo |
| Contexto del chat con bloques financieros separados | `e61f806`, `contexto-negocio.ts`, migración v137 | Implementado; dos pruebas del formateo, sin nueva certificación del modelo real |
| Registrar compras y gastos fijos por chat; corregir producto y costo | `a27dd36`, `10f4054` y migraciones v133/v134 | Implementado en el código examinado |
| Evitar afirmar movimiento de stock en productos que no llevan stock | `86edb39`, v135 | Implementado |
| Poder ver/corregir fijos del negocio desde su resultado | Diff actual de tres archivos | En progreso durante esta revisión |

La dirección general es correcta: la separación tiene cambios reales en datos,
consultas y conversación. Sin embargo, trasladar componentes existentes a Personal
no garantiza que sus acciones se coordinen ni que cada recorrido esté completo.
Negocio tiene más operaciones conectadas: registrar, corregir, cobrar/pagar,
anular, importar y consultar la evidencia. Personal todavía tiene varias APIs
que el usuario no puede utilizar desde su pantalla habitual.

## Hallazgos que deben corregirse primero

Las referencias son relativas a la copia `transtech-eos-business-os` indicada arriba.
P1 significa riesgo de información financiera incorrecta o pérdida de datos; P2,
funcionalidad incompleta o respuesta engañosa recuperable. No se afirma que haya
ocurrido pérdida de datos de un cliente.

### P1-01. Las cuentas pierden la moneda al leer, sumar y guardar

`app/eos/components/FinanzasCuentas.tsx:87-103, 140, 165, 192, 221`.
El estado del componente no conserva `moneda`. Suma todas las cuentas y etiqueta
el resultado con una prop que viene del movimiento más reciente del diario
(`GastosView.tsx:219`). Guardar envía esa moneda para todas las cuentas.

Reproducción ejecutando el componente real con respuestas ficticias: una cuenta
de PYG 1.000.000 y otra de USD 100 muestran PYG 1.000.100. Pulsar Editar y Guardar
sin cambiar nada envía las dos como PYG. El problema no es sólo visual: el PUT
recibe los datos alterados. Cambiar el período del diario puede cambiar también
la moneda usada para etiquetar estas cuentas.

**Cierre:** conservar moneda por cuenta; totalizar por moneda; moneda explícita
al crear; editar nombre o cobertura debe preservar moneda, saldo e identidad.
Prueba obligatoria PYG+USD, incluida guardar sin cambios y cambiar de período.

### P1-02. Guardar cuentas o fijos puede borrar la información anterior

`app/api/finanzas/cuentas/route.ts:142-167`; patrón equivalente en
`app/api/finanzas/fijos/route.ts`.
Se hace DELETE y luego INSERT como llamadas distintas. Si la segunda falla,
la primera ya eliminó la lista. Dos pestañas concurrentes tampoco tienen un
control de versión. Describirlo como un «estado honesto» no evita la pérdida.

La reproducción de cuentas con fallo simulado del INSERT devuelve HTTP 500 y
deja cero filas. Es una simulación de persistencia, no un experimento en la base.

**Cierre:** reemplazo transaccional o edición por identificador estable, con
validación previa y control de concurrencia. Una falla debe dejar la versión
anterior intacta. Probar la transacción contra una base de validación.

### P1-03. Una fila inválida desaparece y el servidor responde éxito

`app/api/finanzas/cuentas/route.ts:115-122`.
Filas con nombre/tipo inválidos o saldo negativo se descartan con `continue`;
después se reemplaza la colección. Se reprodujo una cuenta existente enviada
con saldo -1: HTTP 200, cero cuentas guardadas. Los renglones vacíos nuevos y
la edición inválida de una cuenta existente requieren tratamientos distintos.

El editor además parsea `1.000.000` con `Number`, que produce NaN; al serializar
se transforma en null. `1.000` produce 1. Debe usarse una regla consistente con
la entrada paraguaya y con los decimales de USD.

**Cierre:** errores por campo, ninguna escritura ante entrada inválida, parseo
monetario compartido y aceptación explícita de los formatos soportados.

### P1-04. Registrar movimientos deja el diagnóstico financiero desactualizado

`GastosView.tsx:115, 164, 199, 211, 264, 372-382` y efectos de carga de
`FinanzasPanel`, `FinanzasTrayectoria`, `FinanzasDestino`, `FinanzasDeudas`.
Anotar/borrar/recategorizar sólo recarga el diario. Los componentes hermanos
conservan su estado y cargan al montarse; no reciben invalidación del padre.
La persona puede ver un gasto nuevo y arriba el disponible o riesgo anterior.
Guardar cuentas tampoco notifica al cálculo financiero.

**Cierre:** una política compartida de actualización de Personal para toda
mutación; actualizar disponible, categorías, previsión y monedas de informes.
Prueba de navegador: anotar un gasto y comprobar los números sin recargar la página.

### P1-05. Fallos parciales de datos se convierten en un cálculo aparentemente válido

`app/api/finanzas/estado/route.ts:140-206, 242`.
Las respuestas de movimientos, fijos, deudas, cuentas y objetivos se consumen
como `data ?? []` sin comprobar sus errores. Si fallan las deudas, sus cuotas
pueden desaparecer del cálculo; si falla la política se responde como si faltara
configurar. La nueva UI muestra errores HTTP, pero no puede detectar un 200 que
ya convirtió datos desconocidos en ceros.

**Cierre:** resultado incompleto explícito o fallo controlado; nunca declarar
«seguro» con fuentes necesarias fallidas. Probar fallos separados por fuente.

### P2-01. Editar una cuenta renueva la fecha del saldo sin haberlo actualizado

`app/api/finanzas/cuentas/route.ts:135`.
Todo saldo no nulo se fecha con el día actual. Se reprodujo guardar un saldo
del 1 de agosto sin cambiarlo: pasa a figurar como declarado el 8 de septiembre.
Esto contradice el aviso de antigüedad y puede alterar las bases de cálculo.

**Cierre:** preservar fecha e ID; actualizar fecha sólo al confirmar un nuevo
saldo. Editar nombre o avisos no debe actualizar la declaración monetaria.

### P2-02. Una lectura fallida invita a crear cuentas como si no hubiera ninguna

`FinanzasCuentas.tsx:118`.
El `catch` hace `setCuentas([])`. Reproducido: un fallo de lectura muestra
«Decirle a EOS» sin aviso de error. Si se guarda después, el reemplazo puede
afectar cuentas anteriores que no se llegaron a mostrar.

**Cierre:** separar carga/error/vacío, ofrecer reintento y no habilitar reemplazo
de una colección que no se pudo leer.

### P2-03. Próxima cuota puede mostrarse con la moneda de otra deuda

`FinanzasDeudas.tsx:55, 109, 138`; `app/api/finanzas/deudas/route.ts:70-88`.
La próxima cuota no lleva moneda y se etiqueta con la del primer total. Los
totales se ordenan por importe numérico, pero la próxima cuota se elige por fecha.
Una deuda grande en PYG puede hacer que la cuota próxima de USD 100 se muestre
como PYG 100. Hallazgo por lectura del contrato, no reproducido en navegador.

**Cierre:** conservar ID y moneda de la deuda en cada cuota y usar esa moneda.

### P2-04. El diario presenta totales recortados como totales del período

`app/api/finanzas/diario/route.ts:82, 147-160`.
La consulta devuelve hasta 500 movimientos y calcula los totales con esas mismas
filas; no devuelve señal de truncamiento. Con 501 movimientos no resume todo el
período anunciado. También acepta tipos persistidos más amplios que los dos de
la UI: verificar que los compromisos no entren como gastos realizados.

**Cierre:** agregar totales sobre el período completo y paginar el detalle;
tipos reales explícitos. Probar 501 y más movimientos.

### P2-05. Fijos todavía no preservan moneda en su editor/API

`app/api/finanzas/fijos/route.ts`, GET/PUT; `FinanzasFijos.tsx`.
La selección y las filas de reemplazo omiten `moneda`, aunque otras consultas y
el registro por chat sí trabajan con esa columna. Guardar fijos ya cargados en
USD necesita conservarla. Los cambios de ámbito que Claude está haciendo no
resuelven por sí solos este problema ni el reemplazo no transaccional.

**Cierre:** moneda por fijo, identidad estable, validación y persistencia atómica.

## Lista maestra de Personal, comparable con la de Negocio

✅ implementado con evidencia local indicada; 🟡 parcial o integración pendiente;
⬜ recorrido no localizado/no iniciado en la superficie revisada. «No localizado»
no descarta una integración externa no versionada.

| # | Bloque / función | Estado real y trabajo necesario | Condición de cierre |
|---|---|---|---|
| 01 | Identidad y entrada a Personal | ✅ Navegación, encabezado y sección propia | Verificar con sesión en escritorio y móvil |
| 02 | Separación de movimientos/fijos | 🟡 Columnas, filtros y trigger; migración histórica sólo clasifica automáticamente origen ERP | Matriz Personal/Negocio, dos empresas y usuarios, correo/documentos y chat |
| 03 | Corrección de ámbito equivocado | ⬜ Falta recorrido para mover una carga manual al ámbito correcto | Cambiar ámbito sin duplicar y con trazabilidad; ERP se corrige desde su origen |
| 04 | Alta rápida ingreso/gasto | ✅ Intérprete y POST conectados; 12 casos en `personal.test.ts` | Añadir prueba UI→API→DB y confirmar texto, fecha, moneda y ámbito |
| 05 | Edición completa de movimientos | 🟡 PATCH admite monto, tipo, fecha, descripción y moneda; la UI sólo categoría | Corregir cada campo y recalcular todo sin borrar/recrear |
| 06 | Borrado y recuperación | 🟡 Borrado directo, sin deshacer ni confirmación contextual | Evitar borrado accidental y mantener evidencia suficiente |
| 07 | Reintentos sin duplicados | 🟡 Alta rápida inserta directamente, sin clave de idempotencia | Repetir una solicitud tras corte de red no duplica el movimiento |
| 08 | Historial y búsqueda | 🟡 Ventanas 7/30/90 días; tope 500 | Paginación, búsqueda, fechas personalizadas y filtros por tipo/categoría/cuenta |
| 09 | Cuentas personales | 🟡 Nueva tarjeta y API, cinco reproducciones de fallos | Corregir P1/P2 de cuentas y preservar identidad |
| 10 | Cuenta de origen de cada movimiento | ⬜ El alta rápida no vincula una cuenta | Saber qué saldo afecta cada operación y cómo conciliarlo |
| 11 | Monedas consistentes | 🟡 Panel y categorías separan monedas; cuentas/fijos/cuota tienen huecos | Preservar moneda en todo recorrido, sin conversiones implícitas |
| 12 | Transferencias entre cuentas propias | ⬜ Documentado como pendiente también en lista de lanzamiento, punto 24 | Dos apuntes vinculados; no inflar ingreso/gasto; transferencias explícitas antes de detección heurística |
| 13 | Disponible, reserva y ahorro | 🟡 Motor y panel reales; errores parciales y actualización pendientes | Número trazable y coherente después de cada cambio |
| 14 | Ingresos y gastos recurrentes | 🟡 Fijos, detección y proyección existentes | Crear/cambiar/pausar/cancelar con fecha, moneda e identidad; transacción segura |
| 15 | Vencimientos y agenda | 🟡 Próxima cuota y trayectoria; falta una vista operable de pendientes | Ver qué vence, registrar cumplimiento y evitar contar el mismo pago dos veces |
| 16 | Deudas: alta y mantenimiento habitual | 🟡 Alta en onboarding y APIs POST/PATCH/DELETE; tarjeta sólo lectura | Declarar, corregir, actualizar cuotas, renegociar y saldar desde Personal o chat con acciones verificadas |
| 17 | Tarjeta de crédito | 🟡 Existe tipo de cuenta/deuda | Cierre, vencimiento, saldo de resumen, mínimo, cuotas y pagos sin duplicación; no sumar deuda como efectivo |
| 18 | Presupuestos por categoría | ⬜ Desglose existente, no límites operables por categoría | Límites mensuales, consumido/restante y aviso configurable |
| 19 | Metas personales de ahorro | 🟡 Objetivos generales y porcentaje de ahorro; sin recorrido personal completo | Meta con monto, moneda, plazo y aportes; distinguirla de objetivos del negocio |
| 20 | Categorías y tendencias | ✅ Clasificación, corrección y comparación histórica existentes | Actualización al recategorizar y definición explícita de categoría desconocida |
| 21 | Buzón y conciliación | 🟡 Existen correo, candidatos y conciliación de saldo | Vincular cuenta y ámbito, conservar evidencia y resolver duplicados/transferencias |
| 22 | Importación personal | 🟡 Correo/documentos; no se localizó flujo completo de extracto CSV personal | Vista previa, mapeo, moneda, ámbito, duplicados y resumen de errores |
| 23 | Proyección y alertas | 🟡 Trayectoria personal a 45 días, riesgos y avisos existentes | Verificación por moneda; no confundir el horizonte con el 30/60/90 del negocio |
| 24 | Informes y exportación | 🟡 Excel/PDF/Word por período y moneda | Totales íntegros y conciliados; filtros de ámbito y protección de descarga probados |
| 25 | Chat como vía de gestión | 🟡 Movimiento personal y fijo ejecutables; no se localizaron acciones equivalentes para ciclo completo de cuentas/deudas | Cada instrucción debe producir ID, estado y resultado real; nunca prometer un guardado inexistente |
| 26 | Memoria, recomendaciones y objetivos | 🟡 Contexto financiero separado, otras memorias/objetivos siguen compartidos | Ámbito explícito donde haga falta; no reutilizar consejo empresarial como personal |
| 27 | Acceso para alguien sin empresa | 🟡 Alta rápida/cuentas requieren sesión; varios paneles exigen módulo `dashboard` | Probar nuevo usuario personal sin empresa y módulo vigente/vencido; explicar acceso restringido sin simular falla de red |
| 28 | Estados de interfaz y sincronización | 🟡 Varias tarjetas ya avisan errores; cuentas y mutaciones aún tienen huecos | Carga, vacío, error, reintento, desconexión y actualización coherentes |
| 29 | Calidad y certificación | 🟡 Tests unitarios y controles estáticos pasan; navegador/DB de Personal pendientes | Suite de recorridos reales y matriz de aislamiento; regresiones de esta auditoría |

Presupuestos, tarjetas completas e importación estructurada son propuestas para
cerrar un producto personal completo, no promesas ya implementadas. Integración
bancaria directa, cambio automático de divisas, inversiones y patrimonio total
requieren alcance y fuentes adicionales; no deben anunciarse como existentes.

## Pruebas y evidencia de esta revisión

| Verificación | Resultado observado |
|---|---|
| `npm test`, copia de Claude | 1.197/1.197; 0 fallos, 0 omitidos |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Termina sin errores |
| `npm run evals` | 76/76, aprobado; corpus determinístico, no certificación del modelo real |
| `npm run lint:tope` | Pasa con deuda existente: 20 errores, 5 avisos; no equivale a lint limpio |
| `npm run ambito` | 29 consultas revisadas por el script |
| `npm run rutas` | Pasa revisión estática de alcance de consultas privilegiadas |
| `npm run migraciones` | 220 versiones únicas; una excepción vacía conocida; no aplica SQL |
| `npm run tema` | Pasa su alcance estático declarado |
| Reproducciones de cuentas | 5/5 escenarios confirman fallos actuales con datos sintéticos |
| Build de producción | No ejecutado en esta auditoría |
| Navegador con sesión, RLS y migraciones remotas | No verificados en esta auditoría |

La primera pasada sobre la rama ANKA dio 1.097 pruebas; no usar ese resultado
como medida del Personal nuevo. Los logs de esta revisión se guardaron en
`tmp/eos-personal-{tests,types,evals,lint}.log` de la carpeta inicial.

Reproducciones persistidas:

- [Resultado y hashes](evidence/eos-personal-2026-09-08.json).
- [Sonda ejecutable](evidence/repro-personal-2026-09-08.cjs).
- Ejecutar desde la raíz: `node docs/reviews/evidence/repro-personal-2026-09-08.cjs C:/Users/galea/transtech-eos-business-os`.

La sonda transpila el componente y la ruta reales. Sustituye hooks, renderizado,
HTTP y persistencia por implementaciones controladas; confirma el código que
se ejecuta ante esos escenarios, no el comportamiento completo del navegador
ni las garantías de una base real. Si se arreglan los fallos sus aserciones
dejan de pasar: es evidencia de reproducción, no la suite final de aceptación.

Los controles estáticos no bastan: `ambito-declarado.mjs` inspecciona fragmentos
de 12 líneas en TS/TSX y dos tablas. No certifica SQL, n8n, propiedad entre
usuarios, saldos, transacciones ni que el ámbito elegido sea el correcto.

## Próximos cinco pasos, en orden

1. Corregir cuentas y fijos: moneda, parseo, validación, ID/fecha y transacción;
   convertir las reproducciones en pruebas de comportamiento correcto.
2. Conectar la actualización de todo Personal y manejar datos incompletos;
   cerrar edición de movimientos, reintentos idempotentes y totales completos.
3. Completar cuentas, deudas y pagos/transferencias con acciones utilizables y
   verificables; revisar el acceso de una persona sin empresa.
4. Añadir los recorridos personales faltantes de presupuesto, metas, tarjetas
   e importación conforme al alcance elegido, reutilizando motores existentes.
5. Certificar Personal en navegador y base de validación: dos usuarios, dos
   empresas, PYG/USD, fallos de red, concurrencia y comparación de cifras con
   informes y chat. Actualizar esta lista por evidencia, no por cantidad de pantallas.

Conclusión de revisión: base funcional sustancial, todavía no lista para declarar
Personal completo. El primer trabajo debe proteger los datos y la coherencia de
los números antes de sumar más tarjetas.
