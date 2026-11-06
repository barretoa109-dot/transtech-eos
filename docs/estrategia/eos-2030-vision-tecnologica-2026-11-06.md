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
| 20 | Market Intelligence Engine (investigación con fuentes y fechas) | **Hecho** (01/10, PR #224): acción `BUSCAR_WEB` vía `web_search` de OpenAI, con fuentes citadas y vista previa. Ver [[eos-busqueda-web]]. Falta la parte específica de "conectar la investigación con los datos financieros reales del cliente" — hoy es investigación genérica, no cruzada con el panorama del usuario. |
| 10 | Document AI (tickets, facturas, extractos → datos estructurados) | **Hecho en lo esencial**: `lib/eos/comprobante.ts` (comprobantes de pago), `lib/facturacion/leerKude.ts` (facturas de proveedor, recién esta semana), OCR de capturas de WhatsApp. Todo gated por confianza y requiere confirmación humana — nunca registra solo. |
| 23 | EOS Vision (cámara, mostrar interpretación antes de confirmar) | **Ya existe**, verificado el 05/11: `lib/gateway/prompt.ts` manda fotos adjuntas directo al modelo como `input_image` en el mismo turno, con `REGISTRAR_COMPRA` disponible. |
| 04 | Razonamiento híbrido (IA + reglas deterministas) | **Ya es la arquitectura actual**, no una tecnología por sumar: `lib/erp/impuestos.ts` calcula IVA de forma determinista, `lib/finanzas/*` no le pide montos al modelo, el modelo propone y el backend valida. Es exactamente la doctrina del proyecto desde el principio. |
| 13 | Proactive Intelligence | **Parcial**: hay "avisos antes de que pase" (migración `20260811011023`) y briefing diario, pero por reglas/umbrales, no por un motor de detección de anomalías como propone el Área IV (ítem 19). |
| 15 | EOS Proof Engine (nada es "terminado" sin confirmación del destino) | **Hecho**, verificado el 06/11 leyendo el código (no es auditoría pasiva): `verificacion.ts` + `acciones-chat.ts` + `resultados.ts` + la transacción atómica de `eos_execute_internal_effect_v64` + el trigger de `eos_auditoria_v60`. Ver detalle abajo. |
| 02 | Memoria persistente (hechos/transacciones/preferencias/objetivos/relaciones/decisiones) | **Parcial**: existe Contexto Maestro y memoria de conversación, pero no hay evidencia de búsqueda semántica con pgvector — es contexto estructurado, no embeddings. |
| 08 | Integración SIFEN | **En curso para la propia facturación de EOS** ([[eos_facturacion_sifen]]), pendiente de certificado y habilitación SET. La integración del documento (leer/emitir SIFEN de los *negocios de los usuarios*) sigue sin construir más allá de la lectura de KuDE por correo (recién esta semana). |
| 01, 03, 06, 07, 09, 11, 12, 14, 16, 17, 18, 19, 21, 22, 24, 25, 26 | El resto | **No construido.** Multiagente, Knowledge Graph, Open Finance, pagos QR interoperables, Universal Commerce Connector, Autonomous Workflows de fondo, Computer Use, Autonomous Business Operations, Digital Twin, Predictive Cash Flow, Optimization Engine, Anomaly Detection, voz en tiempo real, experiencia guaraní dedicada, offline-first, API pública, indicadores sectoriales agregados. |

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
2. **Anomaly Detection ligero sobre lo que ya hay**: no un Isolation Forest,
   pero sí reglas estadísticas simples (desvío contra el promedio del rubro,
   cargos duplicados) alimentando las alertas que ya existen — ítem 19 cruzado
   con el 13, con datos que EOS ya tiene de cada cuenta.
3. **Cruzar Market Intelligence con los datos del cliente**: la búsqueda web
   ya existe (ítem 20); lo que falta es que, cuando investigue precios o
   competencia, lo haga en el contexto del negocio real del usuario en vez de
   responder como una IA genérica. Es extender código que ya está en
   producción, no construirlo de cero.
4. **Integración SIFEN de lectura para negocios de usuarios** (ítem 08, más
   allá de KuDE por correo): sigue siendo el punto de mayor apalancamiento
   para diferenciarse en Paraguay específicamente, y ya viene señalado en el
   documento del 04/11.

Todo lo demás (multiagente, Knowledge Graph, Open Finance Connector, pagos
interoperables, Digital Twin, voz en tiempo real, Developer Platform,
indicadores agregados) queda registrado como la visión de 12-24 meses que el
propio documento describe, condicionada a la escala que el plan maestro ya
identificó como la prioridad actual.

## Próximo paso

Pedir al dueño cuál de los 4 puntos accionables (o algo fuera de esta lista)
prioriza para empezar ahora.
