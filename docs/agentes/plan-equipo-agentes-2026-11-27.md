# Equipo de agentes de EOS — plan para aprobar (27/11/2026)

Nada de esto está implementado. Es el plan que pediste, armado después de leer
`origin/main` (hasta el PR #382). Primero los choques entre el pedido y lo que
hay, porque cambian el diseño; después la arquitectura, las tablas, cada agente
y lo que necesito que decidas.

---

## 1. Lo que el repo dice y el pedido no sabía

| # | El pedido supone | Lo que hay en `main` | Cómo lo resuelvo |
|---|---|---|---|
| 1 | Expo + Supabase Edge Functions | La app es **Next.js 16 en Vercel + Capacitor 8** (WebView remoto). No hay Edge Functions; lo programado corre con **pg_cron → ruta de Vercel** (v262), porque el `schedule` de GitHub no disparaba y n8n se está sacando del camino crítico (`docs/salida-de-n8n.md`). | Los agentes son rutas `/api/agentes/<agente>` en Vercel, disparadas por pg_cron o por eventos de la base. n8n no hace falta; si lo querés igual para Reportes, es un nodo HTTP a la misma ruta. |
| 2 | Lemon Squeezy + Apple, con `payment_failed` / `recovered` | **No existe ninguno de los dos.** Lemon Squeezy no acepta altas nuevas y cierra el 31/03/2027. La app de iPhone no cobra (Apple 3.1.1). Se cobra por **transferencia** con comprobante (agente de pagos, PR #371) y Bancard está pausado. No hay evento de "cobro fallido": hay **un plan que vence sin pago nuevo**. | Cobranza se dispara con `vencimiento_sin_pago` (y `cobro_rechazado` si Bancard vuelve) y se corta con `pago_acreditado`. El enlace del día 3 es `/pago` de EOS, no un portal externo. |
| 3 | "Planes y precios ya definidos" | Sí: los cuatro planes cerrados de la v263 (Gratis, Finanzas Personales 50.000, Emprendedor 100.000, Full 130.000, + Emprendedor Inicial 70.000) y el mes de prueba del Full (v264). | Ningún agente los toca; lo verifica un test de permisos. |
| 4 | Día 10: "el acceso queda en pausa" | La pausa la tiene que hacer el sistema, no el agente (regla 1). Hoy, al vencer, la prueba cae a Gratis; **falta confirmar que un plan pago vencido hace lo mismo sin borrar nada.** | Lo reviso al construir Cobranza. Si no pasa solo, es un cambio del sistema de cobro (con tu aprobación), no del agente. El agente solo avisa. |
| 5 | Activación: "conectar la primera fuente / guía de su banco" | **No hay conexión con bancos** (`eos_finanzas_integraciones`: pendiente). El primer valor hoy es la primera anotación o la primera foto de un comprobante. | La "primera fuente" pasa a ser "primer registro" (mensaje, foto o WhatsApp). La guía de las 24 h explica cómo mandar el primer comprobante por WhatsApp. |
| 6 | Reportes es nuevo | Ya existe el **tablero de los viernes** (`eos_tablero_semanal_v213`, `lib/metricas/tablero-semanal.ts`, `npm run tablero`). | Lo extiendo: pasa al lunes y suma MRR, churn, vencidos sin pago, escalamientos abiertos y costo de agentes. |
| 7 | Activación y Retención son nuevas | Ya salen solos: correos de la primera semana (`primeros-dias.ts`, días 1/3/7), **motivacional cada 3 días (opt-out)**, push 3 veces por día, **push de rachas** y "racha en riesgo" (`lib/push/seguimiento.ts`), resumen del lunes, avisos de riesgo, aviso de renovación. | Ver §2: esto choca con dos reglas tuyas. |
| 8 | El modelo es Claude | El chat de EOS usa OpenAI (GPT 6 Sol / 5.5). | Los agentes nuevos usan la API de Claude como pediste; el chat no se toca. |

## 2. Dos choques con tus reglas que no puedo resolver solo

**a) Rachas (regla 4).** `lib/push/seguimiento.ts` manda "llevás 7 días" y
"tu racha está en riesgo" a la noche. La regla 4 prohíbe rachas
explícitamente. Propongo **apagar las rachas y el "racha en riesgo"** y dejar
solo los avisos con un dato real de la cuenta.

**b) El tope semanal (regla 3 + criterio "ningún mensaje supera el tope").**
Hoy una cuenta puede recibir push 3 veces por día + un correo cada 3 días +
avisos de riesgo. Eso ya supera cualquier tope razonable antes de que exista
un solo agente. Propongo que **todo lo automático que sale a un usuario pase
por el mismo registro y el mismo tope**: los agentes nuevos y lo que ya existe.
Si no, el tope es decorativo.

---

## 3. Arquitectura

```
 eventos de la base (triggers)        pg_cron (programado)
   alta, pago acreditado,               lunes 08:00 Reportes
   plan vencido, pedido de baja,        diario Cobranza/Activación
   mensaje a soporte                    semanal Contenido
            │                                   │
            ▼                                   ▼
   agentes.eventos (cola) ───────►  /api/agentes/<agente>  (Vercel, CRON_SECRET)
                                           │
                       1. agentes.empezar_run()  ← si está apagado, termina acá
                       2. lee SOLO sus funciones de lectura (rol propio)
                       3. decide con código; Claude solo donde hace falta
                       4. agentes.autorizar_envio()  ← interruptor + tope + registro
                       5. manda (Resend / WhatsApp / push) y anota la entrega
                       6. agentes.terminar_run()  (costo, duración, error)
                                           │
                    escalar ──► agentes.escalations ──► urgente: al momento
                                                        normal: resumen diario
```

**La pieza que hace cumplir los criterios es `agentes.autorizar_envio()`**: es
la única forma de mandar algo. En una sola transacción mira si el agente está
activo, si el usuario tiene cupo en la semana, si la plantilla/prompt es la
versión aprobada, y deja la fila en `agent_messages` con estado `autorizado`.
Si devuelve `false`, el código no manda. Así "apagado no envía nada" y "nadie
supera el tope" no dependen de que cada agente se acuerde de chequear.

### Tablas (schema `agentes`, no expuesto por la API REST; `anon` y `authenticated` revocados)

| Tabla | Columnas principales |
|---|---|
| `agent_config` | `agente` (pk), `activo`, `limites` jsonb (por corrida, por día, gasto USD/mes), `version_reglas`, `version_prompt`, `version_aprobada`, `aprobado_por`, `aprobado_en`, `actualizado_en` |
| `agent_runs` | `id`, `agente`, `disparador` (cron / evento / manual), `evento_id`, `usuario_id` (null si es global), `entrada_resumen` jsonb, `salida` jsonb, `modelo`, `tokens_in/out/cache`, `costo_usd`, `duracion_ms`, `error`, `creado_en` |
| `agent_messages` | `id`, `run_id`, `agente`, `usuario_id`, `canal` (email / whatsapp / push / app), `plantilla` o `prompt_version`, `estado` (autorizado / enviado / entregado / fallado / bloqueado_tope / bloqueado_apagado), `proveedor_id`, `creado_en` |
| `escalations` | `id`, `agente`, `usuario_id`, `motivo`, `prioridad` (urgente / normal), `contexto` jsonb (resumido), `estado` (abierto / resuelto), `respuesta`, `resuelto_por`, `resuelto_en` |
| `eventos` | cola: `id`, `tipo`, `usuario_id`, `datos` jsonb, `procesado_en`, `intentos` (idempotente por `tipo + usuario + clave`) |
| `secuencias` | estado de Cobranza/Activación por usuario: `agente`, `usuario_id`, `paso`, `proximo_en`, `cortada_por` |
| `kb_propuestas` | respuestas tuyas a escalamientos de Soporte, propuestas como entrada nueva; `estado` (propuesta / aprobada / descartada) |
| `contenido_borradores` | `tema`, `formato` (post / guion / artículo), `texto`, `estado` (borrador / aprobado / descartado) |

Vista `agentes.mensajes_semana`: mensajes `enviado`/`entregado` por usuario en
los últimos 7 días, la que usa el tope.

### Permisos (regla 6 y "ningún service role")

- Un **rol de Postgres por agente** (`agente_reportes`, `agente_cobranza`, …)
  con su propia contraseña, que entra por el pooler de Supabase. Vercel guarda
  una cadena de conexión por agente; ninguno tiene la service role.
- Cada rol tiene `EXECUTE` **solo** sobre sus funciones de lectura
  (`agentes.cobranza_pendientes()`, `agentes.activacion_estado(uuid)`, …) y
  sobre las cuatro de registro (`empezar_run`, `autorizar_envio`,
  `marcar_entrega`, `escalar`, `terminar_run`). Ningún `SELECT` directo sobre
  tablas de usuarios.
- Las funciones de lectura devuelven lo mínimo: Cobranza recibe nombre de pila,
  canal, días de atraso y monto del plan; nunca movimientos. Retención recibe
  contadores ya calculados.
- **Test de permisos** (en `supabase/tests`, con el patrón de transacción que
  termina en `raise exception`): con cada rol, intentar `INSERT/UPDATE/DELETE`
  en `eos_usuario_modulos`, `eos_planes_armados`, `eos_paquetes`,
  `solicitudes_pago`, movimientos y `usuarios`, y llamar a las funciones de
  cobro (`eos_process_manual_payment_v42`, `eos_guardar_paquete_v263`, …):
  todo tiene que fallar con `permission denied`. Corre en CI con `npm run grants`.

### Prompts, plantillas y tu aprobación (regla 7)

```
agentes/
  <agente>/
    reglas.md            lo que puede y no puede hacer
    prompt.v1.md         solo los agentes que usan Claude
    plantillas/*.md      textos fijos (Cobranza, Activación)
    evals/casos.jsonl    entrada → salida esperada / "debe escalar"
  kb/                    base de conocimiento de Soporte, un .md por tema
  temas.md               banco de temas de Contenido
```

- Cada archivo lleva su versión. Al arrancar, el agente compara la versión del
  código con `agent_config.version_aprobada`: **si no coinciden, no manda nada
  y escala** "hay un prompt sin aprobar".
- Aprobar = mergear el PR (main está protegida y exige evals) + correr
  `npm run agentes:aprobar <agente>`, que escribe la versión aprobada. Ningún
  agente escribe `agent_config`.
- Evals: `npm run evals:agentes`. Las de reglas (tope, interruptor, secuencia)
  son tests comunes sin modelo. Las de Soporte y Contenido llaman al modelo con
  casos fijos y un tope de gasto; entran al workflow `evals` del PR.

### Interruptor sin deploy

`update agentes.agent_config set activo = false where agente = 'cobranza'`,
envuelto en `npm run agentes:apagar cobranza` y en un botón en `/admin/agentes`
(solo `ADMIN_EMAILS`). Se respeta en dos lugares: al empezar la corrida y en
`autorizar_envio()`, así una corrida que ya estaba andando tampoco manda.

---

## 4. Modelos de Claude (precios vigentes por millón de tokens)

| Agente | ¿Usa modelo? | Modelo | Por qué | Costo estimado |
|---|---|---|---|---|
| Reportes | No | — | Son números; el "esto cambió mucho" es una regla (±25 % y al menos 5 casos). | 0 |
| Cobranza | No | — | Cuatro textos fijos aprobados por vos. Un modelo solo agrega riesgo de decir algo de plata que no dijiste. | 0 |
| Activación | No (por ahora) | — | Plantillas con el rubro, como los correos actuales. | 0 |
| Soporte | Sí | **Claude Sonnet 5.5** (`claude-sonnet-5-5`, USD 2 / 10; caché USD 0,10) | Tiene que entender la pregunta y decidir si la base la cubre; es donde más importa no inventar. Salida estructurada: `{responde, respuesta, fuentes[], escalar, motivo}`. Antes del modelo, un filtro por reglas escala sin llamarlo todo lo de seguridad, claves, plata, reclamos y datos personales. | ~USD 0,007 por consulta con la base en caché |
| Retención | Sí, poco | **Claude Haiku 5.5** (`claude-haiku-5-5`, USD 0,10 / 0,50) | Redactar una frase a partir de contadores ya calculados (nunca movimientos). | < USD 0,001 por mensaje |
| Contenido | Sí | **Claude Opus 5.5** (`claude-opus-5-5`, USD 4 / 20), por **Batches** (mitad de precio) | Es redacción de calidad, poco volumen y sin apuro. | ~USD 0,40 por semana (10 borradores) |

Todos con `fallbacks` del lado del servidor por si el modelo rechaza, y el
costo de cada llamada queda en `agent_runs.costo_usd`. A Claude no viaja ni el
nombre completo ni el correo ni el teléfono: Soporte manda la pregunta (con
números de cédula, teléfonos y correos tapados antes de salir) y la base de
conocimiento.

---

## 5. Los seis agentes

### 1. Reportes — lunes 08:00 PY, por correo a vos
Extiende `eos_tablero_semanal_v213` → `eos_tablero_semanal_v2xx` con: altas,
pruebas iniciadas, activación (% que llegó a su primer registro útil),
**MRR** (suma de planes pagos vigentes, mensualizada), **churn** (pagos que
vencieron sin renovar), vencidos sin pago, escalamientos abiertos, mensajes
enviados por agente y costo de agentes. Cada número contra la semana anterior;
marca los que cambian fuerte. No escala.

### 2. Cobranza — diario + eventos
Día 0 aviso amable · día 3 recordatorio con el enlace a `/pago` · día 7 aviso
de pausa · día 10 "tu acceso quedó en pausa; tus datos están a salvo". Cada
paso revisa antes de mandar si ya pagó; `pago_acreditado` corta la secuencia.
No reintenta cobros ni cambia el plan. Escala: disputas, contracargos, pedidos
de reembolso (detectados en respuestas a sus correos y en Soporte), y el
comprobante que el agente de pagos marcó como dudoso. Reemplaza a
`avisoRenovacion` para no mandar dos veces lo mismo. En el iPhone no se manda
push de cobro (Apple 3.1.1): solo correo/WhatsApp.

### 3. Activación — eventos de alta y de uso
Bienvenida con un paso · a las 24 h sin registro, guía corta (mandar el primer
comprobante por WhatsApp) · destaca su primera alerta útil · resumen de la
primera semana · aviso de fin de prueba del Full (informativo: qué tiene en
Gratis y qué deja de tener, sin cuenta regresiva). Absorbe los correos de
`primeros-dias.ts`. Escala: sin ningún registro en 72 h.

### 4. Soporte — correo y botón de ayuda de la app
Entra por `/api/soporte` (ya existe) y por correo a soporte@ (necesita
recepción de correos: ver §6). Filtro de reglas → Sonnet con la base de
`agentes/kb/` → si `escalar` o la base no cubre, va a `escalations` y al
usuario se le dice que una persona le responde. Nunca contesta fuera de la
base. Cuando respondés un escalamiento desde `/admin/agentes`, se crea una
`kb_propuesta` que aprobás o descartás; aprobada, se abre un PR con el `.md`.

### 5. Retención — construido y **apagado**
Resumen mensual de valor (alertas, vencimientos cubiertos, gastos detectados,
de contadores ya calculados) · uso en baja 2 semanas → un hallazgo concreto de
su cuenta, o nada si no hay hallazgo · pedido de baja → ofrece pausa de 1 a 3
meses y pregunta el motivo (la pausa la aplica el sistema cuando la persona la
acepta, no el agente) · invitación a referir a los 60 días activo. Escala:
planes altos (Full) que piden baja y motivos que se repiten 3+ veces en el mes.

### 6. Contenido — construido y **apagado**
Semanal, toma temas de `agentes/temas.md`, redacta en lote (post, guion corto,
artículo) con el mensaje de EOS (crecimiento y salud financiera de personas y
negocios, no "anotar"). Todo queda en `contenido_borradores` y te llega un
correo con el lote. Nada se publica.

---

## 6. Lo que necesito que decidas

Las respuestas que ya da el repo, para que no te las pregunte:
- **Proveedor de correo:** Resend con `transtech.com.py`, ya en uso. Sigo con eso salvo que digas otra cosa.
- **WhatsApp Business API:** ya está (Cloud API de Meta, es por donde entra el chat). Para mensajes que inician los agentes fuera de la ventana de 24 h, Meta exige **plantillas aprobadas**; propongo arrancar los agentes solo con correo (y push donde no sea cobro) y sumar WhatsApp cuando aprobés las plantillas.

Lo que sí es tuyo:
1. **Canal de escalamientos.** Propuesta: urgentes por **push a tu iPhone** (APNs ya entrega) + correo; normales en un **correo diario** a las 18:00. Alternativa: urgentes por WhatsApp a tu número (necesita plantilla).
2. **Tope semanal por usuario.** Propuesta: **4 mensajes por semana entre todos**, con prioridad Cobranza > Activación > Retención, y las respuestas de Soporte a una pregunta que hizo la persona **fuera del tope** (las pidió). Si querés que cuenten igual, Soporte nunca podría contestar a alguien que ya recibió 4 cosas.
3. **Lo que ya existe (§2):** ¿apago las rachas y meto los push y el motivacional cada 3 días bajo el mismo tope?
4. **Día 10 de Cobranza:** confirmar que un plan pago vencido baja a Gratis sin borrar datos (lo verifico yo; si hay que cambiarlo, te lo traigo).
5. **Primeras entradas de la base de conocimiento y el banco de temas:** te los pido cuando llegue a Soporte y a Contenido; puedo arrancar con un borrador sacado de `/planes`, Términos, Privacidad y las preguntas de `/api/soporte`, para que corrijas.

## 7. Orden de trabajo (una rama y un PR por paso, desde `main`)

1. Este plan.
2. Infraestructura: schema `agentes`, roles, funciones de registro, `autorizar_envio`, `/admin/agentes`, `npm run agentes:apagar|prender|aprobar`, tests de permisos, tope e interruptor.
3. Reportes.
4. Cobranza (con la prueba "un vencimiento de prueba recorre los 4 pasos y se corta con un pago").
5. Activación (reemplaza `primeros-dias`).
6. Soporte + base de conocimiento inicial + evals con casos que deben escalar.
7. Retención (apagado).
8. Contenido (apagado).
9. `docs/agentes/operar.md`: apagar un agente, revisar escalamientos, editar la base, aprobar cambios.

Cada migración se aplica desde `main` después del merge (`eos-db-push`), como
dice CLAUDE.md.
