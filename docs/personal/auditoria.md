# Personal: auditoría antes de construir

Fecha: **8 de septiembre de 2026**. Hecha contra el repositorio y contra la base
de producción, no contra documentos — la lista de lanzamiento ya envejeció mal
tres veces por confiar en lo escrito.

El encargo es convertir Personal en una vertical tan profunda como Negocio,
bajo la doctrina que ya está escrita en la constitución del producto: *"en
finanzas, EOS trabaja y el usuario observa"*.

## El hallazgo que ordena todo el trabajo

**El motor de finanzas personales ya está construido, y buena parte no tiene
pantalla.** Diecinueve módulos en `lib/finanzas/` con pruebas, que resuelven
—hoy, en producción— cosas que el encargo pide construir: proyección de caja
día por día, detección de recurrencia, plan de pago, riesgo de quedarse corto
antes de una fecha, conciliación que declara lo que no sabe, trazabilidad de
cada cifra, desglose por destino con comparación contra el mes anterior.

Lo que falta casi nunca es el cálculo. Es **conectar, completar y hacer que EOS
actúe con eso**.

Por eso el orden de abajo no arranca por funciones nuevas.

---

## Matriz

### EXISTE Y FUNCIONA

| Capacidad | Dónde |
|---|---|
| Separación estricta negocio / persona | `ambito` + trigger (v136), 29 consultas filtradas, `npm run ambito` en CI |
| Contexto del chat separado por ámbito | v137, `textoContexto` con bloques rotulados |
| Movimientos, alta en una línea | `gastoRapido.ts`, `/api/finanzas/rapido` |
| Clasificación automática por destino | `destinos.ts` — infiere al leer, con corrección manual que manda |
| Comparación contra el mes anterior | `LineaDestino.antes`, renderizado en `FinanzasDestino` |
| Constitución Financiera | `eos_finanzas_politica`, `FinanzasSetup` |
| Fijos declarados, los dos ámbitos | `eos_finanzas_fijos`, `FinanzasFijos` con prop `ambito` |
| Detección de recurrencia | `recurrencia.ts`, `FinanzasCandidatos` |
| Deudas con cuota, plazo y cuotas restantes | `eos_finanzas_deudas`, `deudas.ts`, `FinanzasDeudas` |
| Proyección del saldo día por día | `trayectoria.ts` + `panorama.ts` |
| Riesgo de quedarse corto antes de una fecha | `riesgo.ts`, con dedupe y cooldown en `avisos.ts` |
| Conciliación y "gasto invisible" | `conciliacion.ts`, `FinanzasConciliar` |
| Ingesta por correo bancario | `extraerDeCorreo.ts`, `/api/finanzas/correo`, buzón con token |
| Ingesta por documento | pipeline de documentos → `extraerMovimientos.ts` |
| Trazabilidad de cifras | `trazabilidad.ts`, `Traza.tsx` |
| Multimoneda sin sumar entre monedas | `monedas.ts`, respetado en todo el panel |
| Cuentas: dónde vive la plata | `eos_finanzas_cuentas`, `FinanzasCuentas` (8 sep) |
| Informe descargable | `/api/informes`, Excel/PDF/Word |
| Acciones de chat de Personal | `REGISTRAR_MOVIMIENTO_PERSONAL`, `REGISTRAR_GASTO_FIJO` |
| Autonomía, aprobaciones y auditoría | Worker Gate, `SYSTEM_RISK`, `eos_worker_gate_audit_v15` |

### EXISTE PERO NO ESTÁ CONECTADO

Lo más caro de la auditoría: capacidades completas, con pruebas, que ningún
usuario puede ver.

| Qué | Estado |
|---|---|
| **Plan de pago + borradores de negociación** | `/api/finanzas/plan` (GET arma el plan, POST lo adopta y lo audita), `planPago.ts`, `negociacion.ts`. **Ninguna pantalla lo consume.** Es la fase "EOS prepara la solución completa y el usuario solo aprueba", construida y invisible. |
| **Resumen del período para el contador** | `/api/finanzas/periodo`, `periodoFiscal.ts`. Ninguna pantalla. |
| ~~**Objetivos**~~ | **Conectado en P4 (v144).** `objetivos.ts` convierte cada objetivo en aporte por mes, ritmo real y desvío; `FinanzasObjetivos` lo muestra y lo contrasta con el ahorro comprometido. |
| **Historia diaria de indicadores** | `eos_kpi_historia_v105` la escribe el cron. No alimenta ninguna vista personal. |

### EXISTE PERO ESTÁ INCOMPLETO

| Qué | Qué le falta |
|---|---|
| Cuentas | Sin `inversiones` ni `ahorro` como tipo; sin historial de saldo; sin evolución |
| Deudas | Sin tasa, sin prioridad, sin escenarios (avalancha / bola de nieve), sin fecha de salida |
| ~~Tarjetas~~ | **HECHO en P5 (v146).** Tabla propia con línea, utilización, cierre, vencimiento, resumen y compras en cuotas. |
| Alertas | El motor de riesgo avisa por correo; no hay hallazgos proactivos priorizados en pantalla |
| Briefing | No tiene sección Personal |
| Informe | No incluye cuentas, deuda, objetivos ni proyección |
| Aprendizaje | Las correcciones de categoría se guardan en la fila, no como criterio reutilizable |

### NO EXISTE

| Qué | Prioridad |
|---|---|
| **Transferencias entre cuentas** | P0 — hoy mover plata de un banco a otro se cuenta como gasto Y como ingreso: infla las dos columnas y ensucia todo ratio |
| **Reembolsos y devoluciones** | P0 — una devolución aparece como ingreso nuevo |
| ~~Presupuesto construido por EOS~~ | HECHO en P3 |
| ~~Fondo de emergencia~~ | HECHO en P4 |
| Salud financiera explicable | P6 |
| Escenarios ("¿puedo comprar…?") | P6 |
| ~~Calendario financiero como vista~~ | HECHO en P2 |
| ~~Patrimonio neto real (activos − pasivos)~~ | HECHO en P4, con `eos_finanzas_activos` |
| Movimiento con dos lados (retiro del negocio → ingreso personal) | P7 |

### NO DEBE CONSTRUIRSE TODAVÍA

| Qué | Por qué |
|---|---|
| Integración bancaria automática | No hay open banking en Paraguay. Documentado en la memoria del proyecto; la vía es documento, correo y chat |
| Patrimonio contable con ROE/ROA | Necesita plan de cuentas y asientos. Un ROE falso se ve idéntico a uno verdadero |
| Presupuesto por 25 categorías configurado a mano | La constitución lo prohíbe explícitamente: es trabajo que EOS existe para no delegar |
| Tasas e intereses de tarjetas | No los conocemos. Inventarlos sería asesoramiento financiero irresponsable |

---

## Estado al 8 de septiembre

**P0 — exactitud: HECHO.** Transferencias en tabla propia (v138) y devoluciones
como gasto de monto negativo (v141+v142). Los dos modelos son opuestos a
propósito: una hay que excluirla del flujo, la otra tiene que entrar restando.
La prueba de la devolución encontró que `acumular` en `destinos.ts` descartaba
todo `monto <= 0` como importe roto.

**P1 — conectar lo que existía: HECHO.** `FinanzasPlanDeudas.tsx` consume
`/api/finanzas/plan`, que llevaba semanas calculando el orden de pago con su
motivo, qué negociar y en cuántos meses se sale, sin que ninguna pantalla lo
mostrara. Y `REGISTRAR_DEUDA` / `REGISTRAR_PAGO_DEUDA` para cargarlas
hablando — el motor estaba detrás de un formulario por acreedor.

**P2 — disponible real y calendario: HECHO.** El disponible real YA tenía su
trazabilidad completa (`Traza` + `Cifra`): eso no había que construirlo. Lo
que faltaba era el calendario, `/api/finanzas/calendario` +
`FinanzasCalendario.tsx`, con la cuenta del saldo corrido en
`lib/finanzas/calendario.ts` y sus cinco pruebas.

**P3 — presupuesto que arma EOS: HECHO.** Cuatro entradas, ninguna pedida en
un formulario. El margen sale de la mediana de los meses anteriores y no de un
porcentaje inventado. Verificarlo contra datos reales encontró que una cuota
pagada el día 8 se seguía proyectando como pendiente el 10: la misma plata
descontada dos veces.

**P4 — objetivos, fondo de emergencia y patrimonio: HECHO.**

· **Objetivos** (`lib/finanzas/objetivos.ts`, 15 pruebas). Un objetivo se
  convierte en aporte por mes, aportes restantes, ritmo real, desvío y fecha de
  llegada. El atraso se mide contra el esfuerzo ORIGINAL —si el aporte
  necesario subió desde que lo definió— y no contra un porcentaje de avance,
  que obligaría a inventar una tolerancia que no sale de ningún lado. Los
  aportes se cuentan por mes de calendario: del 8 de septiembre al 31 de
  diciembre hay CUATRO, no 3,8. Y no se restan del disponible real, que ya
  descuenta el ahorro: los objetivos compiten contra el ahorro, así que hay un
  contraste y no una resta.

· **Fondo de emergencia** (`lib/finanzas/fondoEmergencia.ts`, 9 pruebas). Nada
  de "tres a seis meses": es una recomendación de economías con seguro de
  desempleo. EOS calcula lo que cuesta cada opción con el gasto esencial de
  esta persona y la deja elegir. Sugiere solo cuando hay un dato que lo
  sostenga —si su ingreso llega parejo o varía— y siempre con el motivo al
  lado.

· **Patrimonio** (`lib/finanzas/patrimonio.ts`, 9 pruebas, tabla
  `eos_finanzas_activos` en la v145). Se niega a dar un neto mientras falte una
  de las dos mitades, y dice cuál falta. Verificado contra producción: con tres
  deudas cargadas y ninguna cuenta devuelve `neto: null` en vez de −10.800.000.

· **El ámbito llegó a cuentas y deudas (v143).** La posición del NEGOCIO leía
  `eos_finanzas_deudas` sin filtro alguno: el préstamo del auto de la persona
  bajaba el capital de trabajo de su empresa y empeoraba su liquidez.
  `npm run ambito` vigila ahora seis tablas y 66 consultas, no dos y 29.

· **CREAR_OBJETIVO escribe el ámbito.** El trigger `eos_process_goal_command()`
  quedó parcheado en la v144 con la misma técnica que usó la v25 sobre esa
  misma función: leerla de `pg_get_functiondef`, reemplazar un patrón conocido
  y fallar ruidosamente si no está. Probado de punta a punta insertando el
  comando como lo hace el worker.

**P5 — tarjetas de crédito: HECHO.**

El problema central no era mostrar una línea de crédito: era **no contar la
misma plata dos veces**. Una compra con tarjeta puede aparecer como gasto del
día, como saldo de la tarjeta y como pago del resumen el mes siguiente.

La regla que sigue todo el módulo: **lo que sale del bolsillo es el pago del
resumen, no la compra**. Por eso  devuelve una línea por
vencimiento y nunca una por compra, y las obligaciones pasan por el mismo
 que las cuotas de deuda — así una tarjeta cargada además como
deuda, o un "pagué la tarjeta" ya anotado, no se descuenta dos veces.

· , 18 pruebas, cuatro de ellas sobre el doble
  conteo.  es el único lugar que las lee, para
  las CINCO pantallas que arman la línea de tiempo: si cada una leyera lo
  suyo, bastaría con que una se olvidara para que mostrara un disponible
  distinto sobre la misma plata. Ya pasó con las cuotas de deuda.

· Sin resumen cargado, lo que se muestra es la suma de las cuotas conocidas y
  queda marcado como PISO: en el mes casi con seguridad hubo compras de un
  solo pago que nadie cargó, y presentar el piso como total haría pagar de
  menos. Un resumen de más de 45 días tampoco se usa como si fuera el de este
  ciclo.

· Ni tasas, ni intereses, ni cargos. Y  NO es lo que costó la
  compra cuando hubo financiación:  es un dato aparte y opcional.

Verificado contra producción: una tarjeta con dos compras en cuotas produce
TRES vencimientos en 90 días (no seis), y la diferencia que introduce en el
panorama es exactamente la suma de esas tres obligaciones.

Queda desde P6: inteligencia comparativa, escenarios y el resto de la
autonomía.

## El orden, y por qué

**P0 — exactitud.** Transferencias y devoluciones. Va primero porque todo lo
demás se calcula sobre estos números: un presupuesto, un forecast y una salud
financiera construidos sobre ingresos inflados por transferencias son tres
mentiras en vez de una.

**P1 — conectar lo que ya existe.** Plan de pago y período no tienen pantalla.
Es la mejor relación entre valor y riesgo de todo el encargo: el cálculo ya
está probado.

**P2 — disponible real y calendario.** El motor (`panorama`, `trayectoria`,
`riesgo`) está; falta la vista temporal y que el disponible real explique de
dónde sale.

**P3 — presupuesto que arma EOS**, no que llena el usuario.

**P4 — objetivos atados a la plata**, fondo de emergencia, y recién ahí
patrimonio con activos declarados.

**P5 — tarjetas** como vertical propia.

**P6 — inteligencia**: qué cambió, anomalías priorizadas, salud explicable,
escenarios.

**P7 — autonomía**: las acciones de chat que falten, cada una por el circuito
completo. Recordar que una acción no está terminada porque aparezca en el
prompt: son cuatro lugares en n8n, tres `check` y una rama del ejecutor.

**P8 — UX**: subáreas dentro de Personal, mobile first, sin romper el oscuro.

**P9 — pruebas de punta a punta** con los casos A–I del encargo.
