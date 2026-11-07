# EOS 2030 — Visión Tecnológica Completa

Fuente: documento de Augusto Barreto, noviembre de 2026 (archivado tal cual para
referencia; el análisis de viabilidad va en la sección final). Es el segundo
documento de visión de esta semana — el anterior, del 04/11, ya tiene su propio
archivo en [`vision-tecnologia-innovacion-2026-11-04.md`](./vision-tecnologia-innovacion-2026-11-04.md),
con 2 de sus 4 puntos accionables ya resueltos (PR #308, PR #309). Este documento
es más ambicioso y más largo: 26 tecnologías en 6 áreas, 3 productos insignia y una
hoja de ruta de 24 meses.

## Resumen del documento original

**Misión propuesta:** convertir EOS en el "sistema operativo financiero" de
TransTech — no un chatbot con gráficos, sino una tecnología que observe,
comprenda, prediga, planifique, ejecute y verifique, y que mejore cuanto más se
use. El documento es explícito en que esto es una **ambición**, no un estado
actual: "no podemos afirmar todavía que EOS será la única aplicación con estas
capacidades... eso habrá que demostrarlo con un producto que funcione, clientes
que paguen recurrentemente y resultados financieros reales."

**Las 26 tecnologías, en 6 áreas:**

- **Área I — Cerebro financiero:** 01 IA multiagente, 02 memoria persistente
  (hechos/transacciones/preferencias/objetivos/relaciones/decisiones, con
  pgvector), 03 Knowledge Graph financiero, 04 razonamiento híbrido
  (IA + reglas deterministas), 05 Model Router por complejidad/costo.
- **Área II — Conectar con la economía del usuario:** 06 Open Finance
  Connector, 07 motor de pagos interoperables (QR/transferencias), 08
  integración SIFEN, 09 Universal Commerce Connector, 10 Document AI.
- **Área III — EOS trabaja por el usuario:** 11 Autonomous Workflows, 12
  Agentic Computer Use, 13 Proactive Intelligence, 14 Autonomous Business
  Operations, 15 EOS Proof Engine (ninguna acción es "terminada" hasta que el
  sistema de destino confirma).
- **Área IV — Predicciones:** 16 Financial Digital Twin, 17 Predictive Cash
  Flow, 18 Optimization Engine, 19 Anomaly Detection, 20 Market Intelligence
  Engine.
- **Área V — Experiencia accesible:** 21 EOS Live Voice, 22 EOS
  Guaraní/Jopará, 23 EOS Vision (cámara), 24 Offline-First Finance.
- **Área VI — Plataforma:** 25 EOS Developer Platform (API pública, SDKs,
  webhooks), 26 Privacy-Preserving Collective Intelligence (indicadores
  sectoriales agregados, requiere escala + anonimización).

**Niveles de autonomía propuestos:** Nivel 1 observar/explicar y Nivel 2
preparar/recomendar → automáticos; Nivel 3 ejecutar con permisos acotados →
requiere permisos; Nivel 4 acciones irreversibles (transferencias, compras,
contrataciones) → requiere aprobación explícita. Coincide exactamente con el
"nunca cobra/registra solo" que ya es doctrina del proyecto.

**Hoja de ruta de 24 meses:** 0–3 m fundación confiable (persistencia,
exactitud, EOS Proof, observabilidad) → 4–6 m inteligencia financiera avanzada
→ 7–12 m autonomía e integraciones → 13–18 m especialización por sector → 19–24
m plataforma/ecosistema. El propio documento marca los plazos como objetivos a
validar, no compromisos.

**Regla de prioridad que propone el documento:** "si una tecnología no mejora
la precisión, reduce trabajo, aumenta la seguridad o genera valor económico
para el cliente, no merece prioridad solamente porque sea novedosa."

## Dónde está EOS hoy frente a esto

Base real (evaluación de accionista del 25/09, sin motivo para haber cambiado de
orden de magnitud desde entonces): ~7 cuentas pagas reales, ~USD 390 de ingresos
históricos. El cuello es **activación/distribución**, según el plan maestro ya
aprobado ([[eos_plan_maestro_2026_09_26]]) — el propio documento de hoy lo
reconoce al decir que el 93 % de las mipymes paraguayas usa redes sociales pero
solo el 13 % sabe aprovecharlas, y que la distribución (contadores,
proveedores de sistemas, cooperativas) es tan importante como la tecnología.

| # | Tecnología del documento | Estado real en el repo |
|---|---|---|
| 05 | Model Router por complejidad/costo | **Hecho** (01/10, PR #220): `elegirModelo` en `lib/eos/enrutamiento-modelo.ts` manda a GPT 6 Sol o GPT 5.5 según adjunto, longitud, idioma, etc. Ver [[eos-modelo-sol-y-55]]. |
| 20 | Market Intelligence Engine (investigación con fuentes y fechas, cruzada con el negocio real) | **Hecho por completo**, verificado el 06/11 con una llamada real (`evals/qa/busqueda-real.mts --tope 0.3`, US$ 0,157): el caso "un proveedor me dijo que el cemento está a ₲40.000 y que estoy caro" contestó calculando el margen EXACTO contra el costo y precio reales del negocio de prueba (₲49.000 de costo, ₲58.000 de precio → ₲9.000 de margen), no una respuesta genérica. `lib/busqueda/sintesis.ts` ya instruye al modelo a "conectalo con su caso… su rubro, sus precios, su objetivo" y `con-busqueda.ts` le pasa el MISMO `contenido` que ya trae el contexto de negocio real (`eos_contexto_negocio`). No había que construir nada; solo faltaba comprobarlo. |
| 10 | Document AI (tickets, facturas, extractos → datos estructurados) | **Hecho en lo esencial**: `lib/eos/comprobante.ts` (comprobantes de pago), `lib/facturacion/leerKude.ts` (facturas de proveedor, recién esta semana), OCR de capturas de WhatsApp. Todo gated por confianza y requiere confirmación humana — nunca registra solo. |
| 23 | EOS Vision (cámara, mostrar interpretación antes de confirmar) | **Ya existe**, verificado el 05/11: `lib/gateway/prompt.ts` manda fotos adjuntas directo al modelo como `input_image` en el mismo turno, con `REGISTRAR_COMPRA` disponible. |
| 04 | Razonamiento híbrido (IA + reglas deterministas) | **Ya es la arquitectura actual**, no una tecnología por sumar: `lib/erp/impuestos.ts` calcula IVA de forma determinista, `lib/finanzas/*` no le pide montos al modelo, el modelo propone y el backend valida. Es exactamente la doctrina del proyecto desde el principio. |
| 13, 19 | Proactive Intelligence + Anomaly Detection | **Parcialmente ya existía, ahora completo para negocio y persona.** El negocio ya tenía (v128) `lib/erp/gasto-anormal.ts`: gasto que no se parece a nada de su categoría, con 5 condiciones para no confundir "raro" con "problema" (precedente, declarado como fijo, etc.). Lo que faltaba era el lado personal — construido el 06/11 (PR #311): mismo detector, reusado, con su propia tabla de dedup (`eos_finanzas_avisos`, v253) porque negocio y persona van separados por columna. |
| 15 | EOS Proof Engine (nada es "terminado" sin confirmación del destino) | **Hecho**, verificado el 06/11 leyendo el código (no es auditoría pasiva): `verificacion.ts` + `acciones-chat.ts` + `resultados.ts` + la transacción atómica de `eos_execute_internal_effect_v64` + el trigger de `eos_auditoria_v60`. Ver detalle abajo. |
| 02 | Memoria persistente (hechos/transacciones/preferencias/objetivos/relaciones/decisiones) | **Parcial**: existe Contexto Maestro y memoria de conversación, pero no hay evidencia de búsqueda semántica con pgvector — es contexto estructurado, no embeddings. |
| 08 | Integración SIFEN | **En curso para la propia facturación de EOS** ([[eos_facturacion_sifen]]), pendiente de certificado y habilitación SET. La integración del documento (leer/emitir SIFEN de los *negocios de los usuarios*) sigue sin construir más allá de la lectura de KuDE por correo (recién esta semana). |
| 17 | Predictive Cash Flow (intervalos de incertidumbre) | **Hecho, 06/11.** La proyección de saldo ya era determinista (`trazarTrayectoria`); se le agregó `trazarBanda` — piso (peor caso: los ingresos que todavía no son seguros no entran) y techo (mejor caso: los gastos que todavía no son un patrón firme no se repiten), usando la `confianza` que cada movimiento proyectado YA traía de `recurrencia.ts`. Nunca una distribución estadística inventada sobre pocos meses de datos — ver el comentario largo en `lib/finanzas/trayectoria.ts`. Se ve como una franja en el gráfico de "Los próximos 45 días". |
| 14 | Autonomous Business Operations | **Dos piezas, 06/11: reposición de stock y cobranza.** `stock_por_agotarse` ya detectaba qué se iba a acabar (desde la v166); se le agregó `cantidad_sugerida` (cubrir el horizonte de 14 días al ritmo actual, nunca negativa) y una tarjeta en Compras. La cobranza automática —la mitad que quedaba pendiente— no se construyó aparte: se agregó `cobro_atrasado` como un tipo más del motor de seguimientos comercial que YA EXISTE (`lib/crm/seguimientos.ts`), que ya tenía resuelto exactamente lo que esto necesitaba: un borrador editable, el envío por WhatsApp con consentimiento y ventana de 24 horas ya verificados, la deduplicación para no insistir, y el cron diario que lo avisa. Una venta a crédito vencida (`lib/erp/cartera.ts::vencidos`, que ya alimenta la pantalla de Cartera) ahora también genera un seguimiento con el monto, los días de atraso y un mensaje listo. Nivel 2, igual que el resto: EOS redacta, el dueño edita y aprieta enviar — nunca sale solo. |
| 18 | Optimization Engine (presupuesto, inventario, precios, compromisos) | **Las cuatro combinaciones ya existen, 06/11.** Presupuesto: `lib/finanzas/presupuesto.ts` (se deduce, no se completa a mano). Inventario: la propuesta de reposición de más arriba (ítem 14). Compromisos: `lib/finanzas/planPago.ts` ya ordenaba deudas por consecuencia de no pagar y decidía dónde poner el excedente. Lo que faltaba era precios: `lib/erp/precio-sugerido.ts` compara el margen de cada producto contra la MEDIANA del propio catálogo (nunca un número inventado de afuera) y, si queda muy por debajo, sugiere el precio que lo volvería a alinear. Nivel 2 de autonomía: una tarjeta en "Cómo va el negocio", nunca escribe el precio solo. |
| 16 | Financial Digital Twin (simular el futuro económico) | **Personal, 06/11: comparar la curva de saldo actual contra una hipotética con un cambio adentro — compromiso nuevo, o único.** `lib/finanzas/gemelo.ts` (`compararTrayectorias`) reusa `trazarTrayectoria` dos veces —la misma función que ya dibuja "Los próximos 45 días"—, una con la lista de egresos/ingresos de siempre y otra con la hipotética, armada con `ocurrenciasMensuales` (una cuota, expandida mes a mes) o `ocurrenciaUnica` (una compra grande o un ingreso puntual, una sola fecha). Nunca inventa un ahorro: solo simula un monto y una fecha que la persona misma da. `POST /api/finanzas/riesgo` lo expone; la pantalla deja elegir "todos los meses" o "una sola vez" y dibuja la segunda curva punteada al lado de la real. Lo que falta del ítem: la versión para negocio — ahí la plata no es un saldo único con reserva, está repartida en cajas (efectivo, banco, cooperativa, financiera, billetera) de distinta moneda (`eos_empresa_cajas_v120`), así que antes de reusar `trazarTrayectoria` hace falta decidir qué caja (o qué agregación) es la que se simula; queda para una sesión propia de diseño, no es una extensión chica de lo de hoy. |
| 01, 03, 06, 07, 09, 11, 12, 21, 22, 24, 25, 26 | El resto | **No construido**, salvo multiagente. Multiagente (ítem 01): fases 1-3 construidas detrás de bandera apagada, y el 06/11 se midió contra el modelo real el paso 1 del "Próximo paso" de `docs/arquitectura-multiagente-2026-11-06.md` — encontró una regresión sin aislar todavía, así que la bandera sigue apagada en todo ambiente. El resto sigue sin construir: Knowledge Graph, Open Finance, pagos QR interoperables, Universal Commerce Connector, Autonomous Workflows de fondo (más allá de lo que el cron de seguimientos del ítem 14 ya cubre), Computer Use, voz en tiempo real, experiencia guaraní dedicada, offline-first, API pública, indicadores sectoriales agregados. |

## Tensión a resolver con el dueño antes de escribir código

El documento es, en sus propias palabras, una ambición de 24 meses que "habrá
que demostrar con un producto que funcione, clientes que paguen
recurrentemente y resultados financieros reales" — no una lista de pendientes
para esta semana. Con ~7 cuentas reales, construir Knowledge Graph,
multiagente, Digital Twin o indicadores sectoriales agregados (ítem 26, que el
propio documento llama "capacidad de largo plazo") sería trabajo que no se
puede validar: no hay datos ni usuarios suficientes para que esas piezas hagan
algo distinto de lo que ya hace el gateway actual.

Lo que sí es **accionable hoy, sin esperar más escala**, y que el documento
mismo ubica en los primeros 3-6 meses de su hoja de ruta ("fundación
confiable" e "inteligencia financiera avanzada"):

1. ~~EOS Proof Engine, versión mínima~~ — **ya existe, verificado el
   06/11.** No era un hueco: ya hay un motor de verdad distribuido en 4
   piezas, construido a lo largo de seis incidentes reales (09/09 al 29/09):
   `lib/gateway/resultados.ts` arma, para cada mensaje, un bloque `worker`
   con qué acciones se ejecutaron, cuáles se repitieron (idempotencia) y
   cuáles fallaron, igual desde el camino n8n que desde el camino TS propio;
   `lib/eos/verificacion.ts` traduce eso en un estado de verdad por acción —
   `ejecutada | repetida | fallida | pendiente_aprobacion | sin_evidencia` —
   que **nunca se infiere de la ausencia de otra cosa** (la causa exacta del
   bug original del 9/09); `lib/eos/acciones-chat.ts` compara ese estado
   contra lo que el TEXTO de la respuesta afirma y la corrige si miente, con
   cuatro guardas específicas (sin acción, acción fallida, solo quedó como
   nota de memoria, quedó pendiente de aprobación); y `eos_execute_internal_effect_v64`
   —la función que de verdad registra una venta o una compra— es una única
   transacción SQL: si devuelve éxito, el `effect_id` que devuelve es el id
   real de la fila que esa misma transacción creó, no un reporte propio sin
   verificar, y un trigger lo asienta en `eos_auditoria_v60` (bitácora
   inmutable con hash-chain) en cuanto la orden llega a un estado terminal.
   Construir esto de nuevo sería duplicar cuatro piezas que ya están en
   producción y probadas con casos reales.
2. ~~Anomaly Detection ligero sobre lo que ya hay~~ — **hecho, 06/11**
   ([PR #311](https://github.com/barretoa109-dot/transtech-eos/pull/311)).
   El negocio ya lo tenía desde la v128; se extendió el mismo detector
   genérico a las finanzas personales, con su propia tabla de dedup
   (`eos_finanzas_avisos`, v253).
3. ~~Cruzar Market Intelligence con los datos del cliente~~ — **ya
   existía, verificado el 06/11 con una llamada real** (no hacía falta
   construir nada): `evals/qa/busqueda-real.mts --tope 0.3` (US$ 0,157)
   mostró que la síntesis YA calcula el margen real del usuario contra lo
   que encuentra en la web, no una respuesta genérica.
4. **Integración SIFEN de lectura para negocios de usuarios** (ítem 08, más
   allá de KuDE por correo): sigue siendo el punto de mayor apalancamiento
   para diferenciarse en Paraguay específicamente, y ya viene señalado en el
   documento del 04/11. **Sigue sin construir — es el próximo paso real.**

## Decisión del dueño (06/11): implementar todo el documento

El dueño pidió explícitamente seguir con el documento completo, las 26
tecnologías, hasta terminar con todo lo propuesto en producción — no
limitarse a los 4 puntos de arriba. Se registra acá para no perder la
instrucción, con una salvedad honesta que hay que decirle de vuelta en el
chat (no renegociarla acá en silencio): varios ítems del documento no son
un problema de prioridad sino de **precondición técnica real**, no de
"esperar escala" como juicio de negocio:

- **Ítem 26 (indicadores sectoriales agregados)**: matemáticamente no hay
  nada que agregar con 7 cuentas — un "promedio del rubro" de una sola
  cuenta por rubro identifica a esa cuenta, que es exactamente lo que la
  anonimización del ítem existe para impedir. No es una decisión de
  negocio aplazable: es un cálculo que no tiene datos de los que salir
  todavía.
- **Ítem 03 (Knowledge Graph) y 02-con-pgvector (embeddings)**: construibles
  como infraestructura ahora, pero sin más usuarios ni más historial no hay
  con qué probar que agregan algo sobre lo que ya hace el Contexto Maestro
  estructurado.

El resto (multiagente, Open Finance Connector, pagos interoperables,
Universal Commerce Connector, Computer Use, Autonomous Business Operations,
Digital Twin, Predictive Cash Flow, Optimization Engine, voz en tiempo real,
experiencia guaraní dedicada, offline-first, Developer Platform) **sí son
construibles ahora** como infraestructura real, cada uno un proyecto propio
de varias sesiones. Quedan en cola, en el orden que el propio documento
sugiere (fundación → inteligencia → autonomía → especialización →
plataforma), empezando por SIFEN lectura (punto 4 de arriba).

## Próximo paso

Construir la integración SIFEN de lectura para negocios de usuarios (punto
4), y después seguir en orden con la cola de la sección anterior.
