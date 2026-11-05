# EOS — Tecnología e Innovación para Crecimiento Exponencial

Fuente: documento de Augusto Barreto, 4 nov 2026 (archivado tal cual para referencia;
el análisis de viabilidad va en la sección final).

## Resumen del documento original

**Visión:** EOS como única app en Paraguay con tecnología real para cambiar de verdad
las finanzas personales y de negocio. Cuatro pilares:

- **Pilar 1 — Inteligencia que mejora con cada usuario**: modelo de riesgo propio
  (datos agregados de todos los usuarios PY), federated learning, agentes silenciosos
  especializados (caja, fraude, ahorro), modelos propios pequeños para categorización/
  anomalías + Claude solo para casos ambiguos.
- **Pilar 2 — De app a infraestructura financiera**: scoring crediticio alternativo
  (6–12 meses de datos), marketplace de productos financieros (comisión por match),
  API/B2B2C (licenciar el motor a cooperativas/fintechs, modelo Stripe/Plaid/Belvo).
- **Pilar 3 — Tecnología para negocios paraguayos**: integración facturación
  electrónica SET, visión por computadora para tickets en papel, integración POS,
  OCR + fallback multi-agregador bancario.
- **Pilar 4 — Loops de crecimiento**: B2B2C vía contadores/gestores, red de detección
  de fraude compartida, switching cost por historial acumulado.

**Roadmap por fases** (Fase 0 Onboarding → Fase 5 Moat multi-tenant), con la secuencia
explícita del propio documento: **primero datos y confianza (Fases 0–3), después
autorización/seguridad (Fases 4–5), recién con eso el salto exponencial (scoring,
marketplace, B2B2C)**. El documento mismo dice que scoring/marketplace necesitan
6–12 meses de datos reales y que B2B2C necesita "algo real para ofrecer a terceros".

## Dónde está EOS hoy frente a este roadmap

Base real (evaluación de accionista del 25/09): ~7 cuentas pagas reales, ~USD 390 de
ingresos históricos. El cuello identificado en `plan-maestro-2026-09-26.md` es
**activación/distribución**, no falta de tecnología.

| Fase/Pilar del doc | Estado real en el repo |
|---|---|
| Fase 0 Onboarding (Prometeo, OCR capturas, vault, KYC-lite) | Prometeo integrado; OCR de capturas existe para comprobantes de WhatsApp. Fallback multi-agregador: no construido. |
| Fase 1 Ingestión silenciosa (NER propio, embeddings, self-healing parser) | **No existe un parser NER propio.** La ingestión de gastos pasa por el gateway conversacional (Claude/GPT vía n8n), no por un modelo de extracción entrenado aparte. |
| Fase 2 Dashboard pasivo (categorización ML, forecasting, resumen NL) | Categorización existe pero es **reglas + LLM** (`lib/eos/*`, `evals/bateria`), no un modelo ML propio. Forecasting de cashflow: no existe. Resumen en lenguaje natural: sí, vía el chat. |
| Fase 3 Alertas proactivas (Isolation Forest/autoencoders, motor de priorización) | Hay "seguimiento proactivo" (migración `20260811011023`) pero es lógica de reglas/recordatorios, no detección de anomalías estadística. |
| Fase 4 Resolución activa (biometría, Open Finance payment initiation) | No construido. Hoy la autorización es por WhatsApp (aprobación conversacional), no biometría ni iniciación de pagos regulada. |
| Fase 5 Moat multi-tenant (RLS, cifrado por campo, SIEM) | **RLS ya es el patrón de seguridad en todo el proyecto** (ver [[eos_seguridad_anon]], [[eos_miembro_sin_plata_personal]]) — esto está más avanzado que el resto del roadmap. SIEM liviano: no existe. |
| Pilar 1 (modelo de riesgo propio, federated learning, agentes especializados) | No aplica todavía: con 7 cuentas no hay masa de datos para entrenar nada propio. El "agente especializado" hoy es un único gateway conversacional, no agentes separados coordinados. |
| Pilar 2 (scoring, marketplace, B2B2C) | El propio documento dice que esto requiere 6–12 meses de datos reales — prematuro ahora. |
| Pilar 3 (SET, visión por computadora tickets, POS) | Facturación SIFEN está en curso para la propia EOS (ver [[eos_facturacion_sifen]]), pero no hay integración de **lectura** de facturas SET de los negocios de los usuarios, ni visión por computadora para tickets en papel, ni integración POS. |
| Pilar 4 (loop contadores, red de fraude compartida) | No construido. El documento mismo dice que esto se activa "después de tener el producto probado" — coherente con el estado actual. |

## Tensión a resolver con el dueño antes de escribir código

El documento es una visión de varios años (modelo de riesgo propio, federated
learning, B2B2C, red de fraude) montada sobre una base de ~7 cuentas y un cuello de
**activación**, no de tecnología, según el plan maestro ya aprobado
([[eos_plan_maestro_2026_09_26]]). Construir Pilar 1/2/4 ahora sería trabajo que no
puede validarse (no hay datos ni usuarios para entrenar o probar nada) y que compite
por tiempo con lo que el propio documento marca como base: Fases 0–3.

Lo único de este documento que es **accionable hoy sin necesitar más usuarios ni más
datos** es:

1. **Fase 1 real**: reemplazar/reforzar la ingestión conversacional con un parser de
   mensajes (SMS/email de bancos) más confiable, si esa ingestión por LLM está
   fallando en producción.
2. **Fase 3 ligera**: visión por computadora para tickets/facturas en papel (ya existe
   OCR de comprobantes — extenderlo a tickets de PyME es incremental, no una
   plataforma nueva).
3. **Fase 5 incremental**: el esquema de datos ya es RLS-first; falta cifrado por
   campo si hay un dato sensible puntual que lo justifique, no una reescritura.
4. Integración de **lectura** de facturación electrónica SET para negocios de
   usuarios (distinto del proyecto de SIFEN propio de EOS) — esto sí compone con el
   diferencial de "cancha propia" sin esperar escala.

Todo lo demás del documento (modelo de riesgo, federated learning, agentes
especializados, scoring, marketplace, API B2B2C, red de fraude compartida) queda
registrado como visión de largo plazo, condicionado a la masa de usuarios que el plan
maestro ya identificó como la prioridad actual.

## Próximo paso

Pedir al dueño cuál de los 4 puntos accionables (o algo fuera de esta lista) prioriza
para empezar a construir ahora, en vez de asumir uno.
