# Plan de fortalecimiento comercial — TransTech EOS

**Fecha:** 2026-09-22
**Autor:** sesión de Claude Code, como CEO/COO/CMO/CFO ad-hoc, a pedido del usuario
**Propósito:** documento de trabajo para ejecutar con Code. No es un anuncio ni una decisión tomada — es una propuesta que el usuario aprueba, corrige o descarta punto por punto.

**Nota de método:** cada afirmación sobre el estado del producto está apoyada en evidencia de sesiones anteriores (memoria, migraciones aplicadas, mediciones reales) — no en el código en sí, que no releí entero para este documento. Antes de ejecutar cualquier punto, la sesión de Code que lo tome debe verificar contra el código y la base actuales, no contra este documento. Donde la evidencia es débil (muestra chica, una sola cuenta), lo digo explícitamente.

---

## 0. Resumen ejecutivo

EOS ya no es un prototipo. Tiene motor de KPIs, ERP/CRM por chat, WhatsApp Business, pagos con tarjeta tokenizados y funcionando en staging, facturación electrónica a medio camino, un modelo de precios modular, auditoría de seguridad reciente (grants, RLS, huérfanos), 9 candados bloqueantes en CI, y **evidencia real de uso** (no hipotética) de 6-7 cuentas: el dueño de una pyme que carga ventas, compras y stock hablándole a EOS por chat o WhatsApp.

Esa última frase es el hallazgo más importante de todo lo que leí para armar este documento, y debería ser el eje de las cuatro estrategias de abajo: **el producto que la gente usa de verdad hoy es un ERP conversacional para dueños de pyme**, no el asistente financiero personal que es la doctrina fundacional (`EOS trabaja, el usuario observa`). Las dos visiones no son incompatibles, pero **no tienen la misma urgencia comercial**, y tratarlas como si la tuvieran diluye el foco.

**Los cinco puntos débiles que más pesan, en orden de impacto sobre "estable y comercializable":**

1. **Latencia real de chat (~19s de mediana) con la solución ya construida y apagada.** El gateway en TypeScript que elimina el salto a n8n existe, tiene 181 tests y 16 evals, y está detrás de tres banderas que nadie prendió. Es la mejora de mayor impacto por menor esfuerzo de todo el documento.
2. **Infraestructura de producción sigue en planes gratuitos** (Supabase sin PITR ni protección de contraseñas filtradas, Vercel Hobby con cola de un build a la vez y promoción manual a producción). Cobrarle a clientes reales sobre esta base es el riesgo operativo más alto que tiene la empresa hoy.
3. **Bancard en producción sigue pendiente de la certificación de Bancard**, no de código — es el único interruptor que falta para cobrar de verdad con tarjeta, y depende de un tercero.
4. **Revisión legal pendiente** de privacidad/términos (Ley 6534/2020) y de la cláusula de "uso razonable" para los planes sin tope de mensajes — bloquea vender con tranquilidad, no bloquea el código.
5. **Coordinación entre sesiones de IA trabajando el mismo repo** produjo choques de migraciones reales (versiones duplicadas, PRs rotos) más de una vez. Sin un protocolo, esto escala mal a medida que el equipo de "empleados IA" crece.

Ninguno de los cinco es un problema de arquitectura. Los cinco son decisiones o interruptores pendientes. Esa es la buena noticia de este diagnóstico.

---

## 1. Estado real del producto (línea de base para las cuatro estrategias)

Verificado en sesiones anteriores, no en esta:

- **Núcleo técnico:** Gateway conversacional (n8n) → OpenAI → Worker Gate con aprobaciones, idempotencia, fencing y auditoría inmutable encadenada por hash. RLS y aislamiento entre cuentas probado con usuarios reales concurrentes (cero fugas). 9 candados bloqueantes en CI (`test`, `evals`, `tsc`, `lint:tope`, `migraciones`, `tema`, `rutas`, `ambito`, `grants`), cada uno probado en rojo antes de aceptarse.
- **Negocio (Business OS):** motor de KPIs (24 indicadores), series históricas, dashboard, Business Twin, cuenta corriente, kardex valorizado, empresas con miembros y módulos, pronóstico de caja, ERP/CRM separados en pantalla, WhatsApp Business por empresa, stock inteligente por ritmo de ventas, facturación electrónica al 60% (falta firma con certificado y envío a SIFEN, ambos trámites del usuario, no código).
- **Personal (Finanzas):** detección de recurrencia, ingesta automática por correo (verificada con un banco real), fijos declarados, capa de honestidad/conciliación, panel financiero gratis para toda cuenta desde v165. **Evidencia real de uso: 0%** entre las cuentas retenidas — nadie usa todavía la mitad personal, pese a ser gratis.
- **Pagos:** Bancard tokenizado + pago ocasional + 3DS, probado de punta a punta en staging con las tarjetas de prueba de Bancard. Producción pendiente de que Bancard apruebe la certificación (gestión externa).
- **Seguridad:** auditoría de grants (PUBLIC + default privileges) cerrada, 56 usuarios huérfanos limpiados, `main` protegida con PR + CI obligatorio desde 2026-09-18, contraseñas mínimo 8 caracteres.
- **Costos medidos:** ~USD 0,02–0,07 por mensaje de chat según cuenta y caché de OpenAI. El plan "EOS Conversacional" (Gs. 60.000/mes, sin tope visible) tiene punto de equilibrio en ~400 mensajes/mes; el uso real hoy es de 27 a 68 mensajes/mes por cuenta. Margen sano en el uso actual, sin techo de costo garantizado en los planes ilimitados.
- **Lo que el usuario NO puede ver todavía porque nadie lo prueba:** Business Twin es de solo escritura (nadie lo lee), Decisiones nunca tiene resultado evaluado, Aprendizaje longitudinal aprende del propio sistema, no del negocio del usuario, porque no hay decisiones evaluadas de las que aprender.
- **Piloto comercial:** decidido pero no ejecutado — el propio checklist de lanzamiento (`docs/lanzamiento/lista-maestra.md`) tiene el piloto como punto 50, dependiente enteramente del usuario.

---

## 2. CEO — Hacia dónde apunta la empresa

### 2.1 Redefinir la promesa central alrededor de lo que ya funciona

La doctrina fundacional de Finanzas Personales (`EOS trabaja, el usuario observa`) sigue siendo válida como visión de largo plazo, pero **no es la razón por la que las cuentas reales de hoy usan EOS**. Usan EOS para cargar ventas, compras y stock hablando en vez de tipeando formularios. Propongo declarar esto explícitamente como la posición de producto para los próximos 90 días:

> **EOS es el ERP que se opera hablando — por chat o WhatsApp — para el dueño de una pyme paraguaya que hoy lleva su negocio en la cabeza o en una planilla.**

Esto no descarta Finanzas Personales: la sigo ofreciendo gratis porque es una apuesta de hábito y adquisición de bajo costo (ver CFO 5.4), pero dejo de dedicarle esfuerzo de construcción hasta que el ERP conversacional tenga tracción medible. Es una llamada de foco, no de alcance: construir menos cosas a la vez, mejor probadas.

### 2.2 Cerrar la brecha entre "lo que EOS entiende" y "lo que EOS registra"

El patrón más caro encontrado usando el producto de verdad (no leyendo el código) fue: EOS entendía perfectamente lo que el dueño de un negocio de porcicultura le dictaba, pero no existía el verbo para registrarlo, así que lo guardaba como una memoria de texto que sonaba a que había quedado hecho. Ya se corrigió para productos, compras y gastos fijos. **Pero el patrón en sí — un verbo de negocio que falta se disfraza de éxito porque `GUARDAR_MEMORIA` siempre funciona** — es estructural y va a volver a aparecer con el próximo verbo que falte. Recomiendo como política de producto permanente: toda vez que el modelo elija `GUARDAR_MEMORIA` sobre una afirmación que suena a una acción operativa (vendí, compré, gasté, debo, me deben), el sistema debe poder distinguir "no hay verbo para esto todavía" de "el usuario realmente solo quería anotar algo" — y decírselo al usuario, no fingir que quedó hecho. Ya hay un candado (`corregirAfirmacionSoloMemoria`) — la tarea de CEO es mantenerlo como principio no negociable cada vez que se agregue un verbo nuevo.

### 2.3 Gobernanza de un equipo de sesiones de IA trabajando el mismo repo

Este proyecto ya no lo construye una sola sesión. Varias sesiones de Claude (y Codex) tocan el mismo repo en paralelo, y ya causó choques reales: migraciones con la misma versión, PRs rotos en CI, una migración aplicada por una rama que otra sesión no sabía que existía. Esto es, en efecto, un problema de **gestión de equipo**, no de código. Propongo:

- Una convención simple y obligatoria antes de elegir un número de migración: mirar `git ls-tree origin/main supabase/migrations`, las ramas remotas sin mergear, y `max(version)` en producción — **ya existe documentada**, falta que sea la primera línea de cualquier sesión nueva.
- Un "canal de estado" liviano (podría ser un archivo `docs/estado-compartido.md` que cada sesión actualiza con qué rama/versión está tocando) para que dos sesiones no elijan la misma versión al mismo tiempo sin necesidad de coordinarse por chat.
- Aceptar que esto es el costo de escalar con IA como fuerza de trabajo, y que vale la pena pagarlo con un poco de proceso en vez de con incidentes de producción.

### 2.4 Decisiones que solo el CEO (el usuario) puede tomar

No las voy a repetir en cada sección — están consolidadas en la sección 7.

---

## 3. COO — Que el producto no se caiga cuando importa

### 3.1 Prioridad #1: prender el gateway en TypeScript

Esto es, con diferencia, la mejora de mayor impacto por menor esfuerzo de todo este documento. La latencia medida del chat (~19s de mediana, con una investigación seria que descartó reasoning effort y aisló el cuello de botella real: 8,7s **antes del primer nodo** de n8n, entre el gateway y el worker) tiene su solución ya construida, con 181 tests y 16 evals, apagada detrás de tres banderas de entorno que nadie prendió. No es una propuesta de diseño — es un interruptor:

- Etapa 1 (`OPENAI_API_KEY`, `EOS_GATEWAY_TS=1`): no deja rastro si algo sale mal, es la más segura para probar primero.
- Etapa 2 y 3: ejecutan acciones reales; prender con semanas de por medio entre una y otra, como estaba planeado.

Recomiendo a Code: la primera tarea de la próxima sesión que toque este tema debería ser medir el "antes" una vez más (puede haber cambiado desde el 7 de septiembre) y después prender la etapa 1 en un entorno de prueba antes que en producción directamente.

### 3.2 Subir de plan la infraestructura antes de cobrar en serio

Cobrarle a clientes reales sobre Supabase free tier (sin PITR, sin protección de contraseñas filtradas) y Vercel Hobby (un build a la vez, cola que se tranca, "Promote to Production" manual) es el riesgo operativo más alto identificado en todo este diagnóstico, y lleva **más de cinco semanas pendiente** sin que nadie le ponga fecha ni número. No es una decisión técnica — el código ya está listo para cualquiera de los dos planes — es una decisión de gasto que el CFO tiene que convertir en una cifra concreta (ver 5.5) y el CEO tiene que aprobar antes del piloto, no después de un incidente.

### 3.3 Cerrar el círculo de "fallos silenciosos"

Aparecieron y se corrigieron varios bugs con la misma forma: una consulta a una columna que no existe (`error_mensaje` vs `error_message`, `estado='pendiente'` vs `status='pending'`) no lanza excepción en `supabase-js` — devuelve `{data:null, error}`, y si el código hace `?? []` sobre eso, "no hay nada" es indistinguible de "algo se rompió". Ya existe un candado (`npm run columnas`, 1680 nombres verificados) que corre fuera de CI porque necesita un token — recomiendo evaluar si puede correr en CI con un token de solo lectura, para que este tipo de bug no vuelva a esconderse durante días antes de que alguien lo note usando el producto de verdad.

### 3.4 Monitoreo real, no solo un endpoint de salud

Existe `/api/internal/salud` con un monitor de n8n cada 5 minutos — bueno como primera línea, y con el mérito de haber sido diseñado específicamente porque Sentry no habría detectado los fallos reales de esta semana (eran respuestas manejadas, no excepciones). Pero sigue sin haber ningún registro de errores de excepción real (JS sin capturar, timeouts no anticipados) en producción. Antes del piloto comercial recomiendo sumar una herramienta de error tracking (Sentry u otra) como complemento del chequeo de salud, no como reemplazo.

### 3.5 Costo de IA en cuentas que no son clientes

Se encontró que los workflows programados de n8n (briefing diario, aprendizaje) gastaban OpenAI en cuentas de QA/certificación, no solo en clientes reales — ya se corrigió con una vista filtrada. Vale la pena dejarlo como regla operativa permanente: **toda medición de costo, salud o uso debe filtrar por `tipo='real'` antes de sacar una conclusión**, porque ya pasó más de una vez que una alarma o una métrica se leyó mal por mezclar cuentas de prueba con cuentas reales.

---

## 4. CMO — A quién le vendemos y cómo se lo decimos

### 4.1 El ICP ya está validado, aunque la muestra es chica

Con apenas 6-7 cuentas reales, el patrón es consistente: las cuentas retenidas (2, con 14 y 16 días de actividad) son dueños de pyme que usan EOS como ERP por chat — ventas, productos, compras, movimientos de negocio, una con 40 mensajes por WhatsApp — y **cero uso de finanzas personales pese a ser gratis**. Es una muestra demasiado chica para ser estadística, pero es la única evidencia real que existe, y coincide exactamente con el ICP que ya se había definido en la auditoría de seguridad de septiembre: "pyme con dueño que carga ventas/compras/stock por chat + WhatsApp". Recomiendo que todo el mensaje de marketing de los próximos 90 días hable a esa persona específica, no al público general de "controlá tus finanzas".

### 4.2 Simplificar el precio de cara al cliente, sin tocar el motor

El modelo de "armado" (módulos con precio individual, techo de Gs. 500.000 si se prenden todos) es flexible y correcto técnicamente, pero le pide al comprador que arme su propio plan antes de entender qué compra. Para un dueño de pyme que ya está evitando mirar sus números, eso es carga cognitiva que compite directamente con la promesa central del producto ("no tenés que ocuparte"). Propongo, sin tocar el motor de módulos: presentar 2-3 combinaciones armadas de antemano en la vitrina pública ("Empezar" / "Negocio" / "Negocio completo"), con la opción de personalizar como algo secundario para quien lo pida. El precio sigue siendo la suma de módulos por debajo; lo que cambia es la primera pantalla que ve un comprador.

### 4.3 WhatsApp como canal de adquisición, no solo de uso

El hallazgo de que una de las dos cuentas retenidas usa EOS principalmente por WhatsApp (40 mensajes) sugiere que el canal de entrada natural para el ICP validado no es necesariamente la web. El canal de WhatsApp Business por empresa ya está construido (CRM > Conversaciones), pero el envío real está bloqueado por un token de Meta y plantillas aprobadas que dependen del usuario. Recomiendo priorizar esa gestión — es la pieza de menor esfuerzo técnico y mayor apalancamiento de adquisición de todo este plan de marketing.

### 4.4 El piloto es la campaña, no un paso previo a la campaña

El plan ya decidido (3-10 clientes reales, monitoreados ~1 semana) es correcto, pero debería tratarse explícitamente como el primer activo de marketing, no como un trámite técnico antes de "el lanzamiento de verdad". De un piloto de ese tamaño con el ICP correcto salen: el guion de onboarding que funciona (hoy solo 1 de 5 altas desde agosto llegó a una acción el primer día), los primeros testimonios reales, y los primeros casos de uso concretos para el sitio ("así carga sus ventas un criador de cerdos"). Recomiendo diseñar el piloto con esa doble función desde el día uno: instrumentar tiempo-al-primer-valor, pedir permiso para citar al cliente, y guardar capturas de pantalla reales de conversaciones que funcionaron.

### 4.5 No vender "sin tope" sin la letra chica lista

El plan Conversacional promete mensajes sin tope. Es una promesa fuerte y correcta para la propuesta de valor ("nunca te quedás sin poder operar"), pero legalmente necesita la cláusula de uso razonable que hoy no existe en los términos (ver CFO 5.3 y sección legal). No es bloqueante para el piloto (cuentas controladas, uso medido), pero sí antes de una campaña de adquisición abierta.

---

## 5. CFO — Que la plata cierre antes de escalar

### 5.1 La economía unitaria de hoy es sana, pero está midiéndose sobre una muestra mínima

Con datos reales de septiembre: costo por mensaje ~USD 0,02–0,07 según caché de OpenAI (verificado contra la tarifa real de gpt-5.5: USD 5/M entrada, USD 0,50/M entrada cacheada, USD 30/M salida). El plan Conversacional (Gs. 60.000 ≈ USD 7,5 sin IVA ni comisión) tiene equilibrio en ~400 mensajes/mes; el uso real de las cuentas activas es de 27 a 68 mensajes/mes — **el costo de IA hoy es 2-7% del precio del plan**. Es una economía unitaria saludable, pero está calculada sobre 6-7 cuentas. No hay que tomar decisiones de pricing definitivas todavía — hay que seguir midiendo con el piloto.

### 5.2 El riesgo real está en los planes sin techo de costo

`Business` (sin tope de mensajes) y `Enterprise` (sin tope) no tienen ningún techo de costo del lado nuestro. El punto de equilibrio calculado de Business ronda los ~2.600 mensajes/mes — muy por encima del uso real actual, pero un solo cliente de uso intensivo (o un caso de abuso) podría hacer que ese plan diera pérdida mes a mes sin que nadie se entere hasta cerrar el mes. Ya existe una alarma interna a los 400 mensajes (correo + chequeo de salud) — es un buen primer paso, pero es informativo, no un freno. Dos opciones, no excluyentes, para que el CEO decida:

- **Cláusula de uso razonable** en los términos (bloqueada hoy por la revisión legal pendiente) que permita, en el peor caso, contactar a la cuenta antes de perder plata indefinidamente.
- **Enrutamiento de modelo**: los mensajes conversacionales simples (la mayoría, medido) podrían ir a un modelo más barato, reservando el modelo actual para lo que necesita razonamiento real. Esto ya estaba identificado como palanca abierta y no se hizo — es la opción de menor riesgo comercial porque no le cambia nada al cliente, solo baja el costo interno.

### 5.3 El costo guardado hoy sobreestima ~2,3 veces — hay que corregirlo antes de usarlo para decisiones de precio

`uso_mensual.costo_estimado_usd` cobra toda la entrada a tarifa completa, sin aplicar el descuento real de caché de OpenAI (hasta 90% en tokens cacheados). Es una cota superior segura para alarmas, pero **no debería usarse tal cual para decidir si un plan da pérdida** — antes de cualquier decisión de pricing basada en este número, hay que pasar `cached_tokens` por la cadena (ya identificado qué archivos tocar, no hecho para no chocar con otras sesiones trabajando el gateway).

### 5.4 El panel financiero gratis es una inversión de adquisición, no una gentileza — hay que medirla como tal

La decisión de dar el panel financiero gratis a toda cuenta (v165) fue correcta para la doctrina de producto (generar el hábito), pero hoy es un costo sin ningún KPI que mida el retorno: cero conversión medida de "usa el panel personal gratis" → "contrata un módulo de negocio pago". Recomiendo definir esa métrica antes del piloto — aunque sea rudimentaria — para poder defender o replantear el regalo con datos, no con intuición, dentro de dos o tres meses.

### 5.5 El upgrade de infraestructura es una línea de gasto pendiente de aprobar, no una tarea técnica

Esto es lo mismo que el punto 3.2 de COO, visto desde la billetera: Supabase Pro y Vercel Pro tienen un costo mensual conocido y público. Recomiendo que la próxima sesión de Code junte las cifras exactas de ambos (según el uso proyectado del piloto, no el actual) y se las presente al usuario como una sola decisión de gasto con número, no como "hay que subir de plan en algún momento" — así deja de quedar pendiente indefinidamente por default.

### 5.6 Bancard producción es el mayor desbloqueo de ingresos pendiente, y no depende de nosotros

Todo el trabajo de integración (tokenización, renovación automática, 3DS, webhook, cron de reintentos) está construido y verificado en staging. Lo único que falta es que Bancard apruebe la certificación que ya se envió — es una dependencia externa pura. Recomiendo que el CEO le dé seguimiento activo a ese trámite (no técnico) con la misma prioridad que a cualquier otro bloqueante, porque hoy es, literalmente, el interruptor entre "el código cobra" y "el código factura cero".

---

## 6. Plan de acción integrado — secuencia única para trabajar con Code

Fusiono las cuatro miradas en un solo orden de ejecución. No reemplaza `docs/lanzamiento/lista-maestra.md` (que sigue siendo la lista de evidencia punto por punto) — es la capa de arriba, la que explica **por qué este orden y no otro**.

| # | Frente | Rol que lo pide | Depende de | Esfuerzo estimado |
|---|---|---|---|---|
| 1 | Prender gateway TS etapa 1, medir, decidir etapa 2/3 | COO | Nadie — es un interruptor | Bajo |
| 2 | Cifra exacta de Supabase Pro + Vercel Pro, presentada como decisión de gasto | CFO/COO | El usuario aprueba el gasto | Bajo (juntar cifras) |
| 3 | Seguimiento activo a la certificación de Bancard producción | CEO/CFO | Bancard (externo) | Ninguno de nuestro lado |
| 4 | Revisión legal de privacidad/términos + cláusula de uso razonable | CEO/CMO/CFO | Abogado paraguayo | Externo |
| 5 | Token de Meta + plantillas de WhatsApp Business aprobadas | CMO | El usuario gestiona con Meta | Medio |
| 6 | Diseñar y correr el piloto (3-10 cuentas del ICP validado) con instrumentación de marketing desde el día uno | CEO/CMO | El usuario elige a quién invitar | Medio-alto |
| 7 | Protocolo simple de coordinación de migraciones entre sesiones de IA | CEO/COO | Nadie | Bajo |
| 8 | Corregir el costo guardado (aplicar descuento real de caché) antes de usarlo para pricing | CFO | Nadie | Medio |
| 9 | Simplificar la vitrina de precios a 2-3 combinaciones armadas | CMO | Nadie | Bajo-medio |
| 10 | Enrutamiento de modelo para mensajes simples (control de costo en planes sin tope) | CFO/COO | Nadie | Medio |
| 11 | Error tracking real (Sentry o similar) antes de cobrar en serio | COO | El usuario crea la cuenta/DSN | Bajo |
| 12 | Definir y medir conversión "panel personal gratis → módulo pago" | CFO | Nadie | Bajo (instrumentación) |

Los primeros cuatro puntos son, deliberadamente, los que menos código nuevo piden y más impacto tienen — son interruptores y gestiones, no construcción. Esa es la recomendación central de este documento: **el producto ya tiene la profundidad técnica que necesita para venderse; lo que falta es prender lo que ya está construido y cerrar los trámites que dependen del usuario o de terceros.**

---

## 7. Decisiones que solo puede tomar el usuario (consolidado)

Ninguna sesión de Code puede resolver esto sola — quedan acá para que no se pierdan entre las cuatro secciones de arriba:

1. **Aprobar el gasto** de Supabase Pro y Vercel Pro (cifra a confirmar por Code antes de decidir).
2. **Firmar/aprobar el alcance** de producto, legal y técnico para el lanzamiento (punto 1 de la lista maestra).
3. **Dar seguimiento a Bancard** para la habilitación de producción (trámite externo, no técnico).
4. **Contratar revisión legal** de privacidad/términos bajo Ley 6534/2020 y de la cláusula de uso razonable.
5. **Gestionar el token de Meta y las plantillas de WhatsApp Business** para que el canal pueda enviar, no solo recibir.
6. **Elegir a quién invitar al piloto** (3-10 cuentas reales del ICP validado) y la fecha.
7. **Decidir si vale la pena mantener el regalo del panel financiero personal sin condición**, o atarlo a una métrica de conversión, una vez exista el dato del punto 5.4.
8. **Aprobar (o no) el acta de decisión de lanzamiento** final una vez cerrados los puntos anteriores.

---

*Este documento está pensado para vivir junto a `docs/lanzamiento/lista-maestra.md`: la lista maestra dice qué está probado con evidencia; este documento dice en qué orden y por qué, desde una mirada de negocio. Actualizar ambos cuando cambie el estado real, no solo uno.*

## Addenda 2026-09-22: documentos de ejecución de cada punto

Cada uno de los 12 puntos de la sección 6 que se podía dejar listo sin
necesitar plata, credenciales o una firma del usuario ya tiene su documento
de ejecución en esta misma carpeta:

- Punto 1 (gateway TS) → `gateway-ts-listo-para-prender.md` — **confirmado
  con 291 tests en verde el 2026-09-22**, solo falta la variable de entorno.
- Punto 2 (infraestructura) → `costo-upgrade-infraestructura.md` — cifras
  reales: Vercel Pro $20/mes, Supabase Pro $25/mes, PITR +$100/mes.
- Punto 3 (Bancard) → `bancard-produccion-seguimiento.md` — mensaje de
  seguimiento listo para enviar, más el runbook de las 3 variables atómicas
  para el pase a producción.
- Punto 4 (legal) → `revision-legal-brief.md` — seis preguntas concretas
  listas para un abogado paraguayo.
- Punto 5 (WhatsApp/Meta) → `whatsapp-business-checklist.md`.
- Punto 6 (piloto) → `piloto-comercial-plan.md` — criterio de selección,
  instrumentación y guion de onboarding.
- Punto 7 (coordinación entre sesiones) → `../coordinacion-sesiones.md` +
  `scripts/siguiente-migracion.mjs`, ya funcionando.
- Punto 9 (precios) → `simplificacion-precios-diseno.md` — diseño aditivo,
  no toca el armador existente.
- Punto 10 (enrutamiento de modelo) → `enrutamiento-modelo-diseno.md` —
  deliberadamente solo diseño, no implementación (ver por qué adentro).

Los puntos 8, 11 y 12 (corregir el costo de caché, error tracking, medir la
conversión del panel gratis) son código, no documentos — su estado real está
en las ramas correspondientes, no acá.

## Addenda 2026-09-23: estado de cierre — todo lo que se podía hacer con código

| # | Estado | Dónde |
|---|---|---|
| 1 | Listo. Falta prender la variable en Vercel | `gateway-ts-listo-para-prender.md` |
| 2 | Cifras listas. Falta aprobar el gasto | `costo-upgrade-infraestructura.md` |
| 3 | Mensaje listo. Falta enviarlo a Bancard | `bancard-produccion-seguimiento.md` |
| 4 | Preguntas listas. Falta contratar al abogado | `revision-legal-brief.md` |
| 5 | Pasos listos. Falta gestionarlo con Meta | `whatsapp-business-checklist.md` |
| 6 | Plan listo. Falta elegir las cuentas | `piloto-comercial-plan.md` |
| 7 | **Hecho**, y arreglado: `siguiente-migracion` no revisaba ninguna rama remota. Se agregó `npm run quien-toca` (que reemplaza el archivo de estado del 2.3) | `../coordinacion-sesiones.md` |
| 8 | **Hecho en código.** El costo usa el descuento real de caché. Falta la variable y aplicar el parche de n8n | `lib/eos/costo-mensaje.ts` |
| 9 | **Hecho, apagado.** Los combos pre-armados están detrás de una bandera; prenderla es tu decisión | `lib/modulos/presets.ts`, v193 |
| 10 | **Pasos 1 a 3 hechos**, en modo sombra: solo mide y no cambia el modelo. El paso 4 espera una semana de logs | `enrutamiento-modelo-diseno.md` |
| 11 | **Hecho sin Sentry.** Registro propio de excepciones con su chequeo de salud | `error-tracking-sentry.md`, v194 |
| 12 | Hecho: las vistas v192 | migración v192 |
| 3.3 | No se llevó al CI: el token que usa es de poder total y guardarlo en GitHub lo decidís vos | — |
| 4.4 | **Instrumentación del piloto hecha:** tiempo al primer valor en la salud y `solo_memoria` en el log. Elegir las cuentas sigue siendo tuyo | `piloto-comercial-plan.md` |

### Lo que queda de tu lado, en orden

1. **Subir la rama.** Arreglar el acceso de GitHub o aplicar el bundle desde la PC, y unir el PR.
2. **Aplicar las migraciones v192, v193 y v194** con `supabase db push`, desde una carpeta limpia y *después* de unir la rama.
3. **Cargar en Vercel:**
   - `EOS_USD_POR_MTOK_ENTRADA_CACHEADA=0.5` (la tarifa cacheada de gpt-5.5).
   - `OPENAI_API_KEY` y `EOS_GATEWAY_TS=1` (punto 1).
   - Opcional: `NEXT_PUBLIC_EOS_PRESETS_PLANES=1`, si aprobás los combos.
4. **Aplicar el parche de n8n:** `node n8n/parches/2026-09-23-tokens-cacheados.mjs`, primero con `SECO=1`, y después `node n8n/exportar.mjs gateway`.
5. **Después de una semana,** leer en los logs `enrutamiento` y `simple_con_accion`, siguiendo `enrutamiento-modelo-diseno.md`.
6. **Los trámites externos:** Bancard, abogado, Meta, gasto de infraestructura y piloto.
