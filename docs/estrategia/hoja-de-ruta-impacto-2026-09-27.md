# Hoja de ruta: el producto que más le cambia la vida a su cliente

**Fecha:** 2026-09-27
**Pedido del dueño:** "Que el cliente no dude en elegirnos. Suponé que sos un cliente, que sos una empresa y que a la vez sos el CEO de TransTech. Armá la hoja de ruta de hacia dónde vamos a ser rotundamente mejores en todo, que la gente nos elija por ser los que más impacto conseguimos en sus vidas."
**Cómo se lee:** primero hablan los clientes (secciones 1 y 2), después el CEO (3 en adelante). Lo que piden los clientes se convierte en promesas, dimensiones y filas de trabajo.
**Relación con los otros documentos:**
- `plan-maestro-2026-09-26.md` sigue marcando **el orden de los próximos 60 días**: congelamiento, estrella polar y trámites.
- `plan-diferenciacion-2026-09-27.md` define **la categoría** ("tu encargado por WhatsApp"), los cinco fosos y los ocho momentos imprescindibles.
- **Este documento** es la capa de arriba: hacia dónde vamos en 18 meses y por qué ese camino hace que nadie nos pueda alcanzar. El Horizonte 1 respeta el congelamiento. Los Horizontes 2 y 3 se abren solo cuando se cumplen sus condiciones de entrada.

> **Regla de lectura para Code.** Este documento no sabe qué está prendido en producción (ver `CLAUDE.md`). Los clientes de las secciones 1 y 2 son **personajes armados** con lo que dijeron las cuentas reales y el ICP del plan maestro, no personas reales. Donde un personaje "dice" algo, es una hipótesis que el dueño valida hablando con clientes de verdad.

---

## 0. Resumen en una página

**"Mejores en todo" es una trampa si se toma literal.** Ningún producto le gana en todo a todos: GestionPy tiene más pantallas, Meta tiene más usuarios y ChatGPT sabe más de todo. Pero **el cliente no elige por todo**. Elige por diez cosas concretas que le importan (sección 4), y en esas diez sí podemos ser los mejores de Paraguay. En tres de ellas podemos ser los mejores de cualquier lado.

**La idea que nos separa de todos: EOS rinde cuentas de su impacto.** Todos los productos dicen que te ahorran tiempo y plata; ninguno te lo demuestra con tus números. EOS le va a mandar a cada cliente, todos los meses, un **Informe de impacto**:

> *"En septiembre anoté 214 cosas por vos (unas 7 horas que no pasaste con el cuaderno). Te ayudé a cobrar Gs. 2.350.000 que estaban atrasados. Te avisé 3 veces que se te acababa algo antes de que pase. Vendiste 2 veces por debajo del costo; desde que te avisé, ninguna más."*

Eso cambia la conversación de venta. El cliente deja de preguntarse "¿cuánto cuesta?" y empieza a preguntarse "¿cuánto me deja?". Y cuando el informe dice que EOS le dejó diez veces lo que cuesta, **ya no compara con nadie**.

**El camino en tres horizontes:**

| Horizonte | Plazo | EOS pasa a… | Condición para abrirlo |
|---|---|---|---|
| **H1: El encargado que no falla** | Días 0 a 60 | anotar sin errores, avisar a tiempo y demostrar su impacto | Ya abierto (dentro del congelamiento) |
| **H2: El encargado que hace** | Días 60 a 180 | cobrar, facturar, pedir al proveedor y decirle al dueño cuánto puede sacar para su casa | 20 cuentas pagas y ≥ 40 % "muy mal" en la pregunta de la ausencia |
| **H3: El que cuida la vida entera** | Meses 6 a 18 | cuidar la plata del negocio **y** la de la familia, con la Constitución Financiera y el autopiloto | 100 cuentas pagas, churn ≤ 5 % y facturación funcionando |

**El puente que nadie más tiene:** el dueño de una pyme paraguaya **no separa** la plata del negocio de la de su casa. Los ERP solo ven el negocio y las apps de finanzas solo ven la casa. EOS ya tiene los dos lados (Negocio y Personal, separados por `ambito` desde la v136). La pregunta que solo EOS puede contestar es: **"¿Cuánto me puedo llevar a casa este mes sin poner en riesgo el negocio?"** Ese es el corazón del H2 y la puerta al H3.

---

## 1. Soy el cliente empresa

*Personaje: Carmen, 41 años, almacén y reventa de productos de limpieza en Luque. Dos empleados. Vende en el local y por WhatsApp. Factura con talonario y tiene que pasar a factura electrónica. Su contador la ve una vez por mes.*

### Mi día hoy
Abro a las 7. Anoto las ventas grandes en el cuaderno, las chicas no. Los pedidos me llegan por WhatsApp entre el mostrador y la caja. Los viernes me siento a sacar cuentas y nunca me dan. Fío a los clientes de siempre y no sé bien cuánto me deben. Me entero de que se acabó un producto cuando me lo piden y no lo tengo.

### Lo que me duele (en este orden)
1. **No sé si gano plata.** Vendo mucho, pero a fin de mes no me queda.
2. **Me deben y me da vergüenza cobrar.** No sé cómo pedirlo sin quedar mal.
3. **Me quedo sin stock** de lo que más se vende.
4. **La factura electrónica me asusta.** Todos me dicen que es obligatoria y nadie me explica fácil.
5. **El contador me reta** porque le llevo los papeles tarde y desordenados.

### Lo que probé y por qué lo dejé
- **Un sistema de gestión:** tenía que cargar todo en formularios. Lo usé dos semanas. No tengo tiempo de sentarme en la computadora.
- **Excel:** lo armó mi sobrino y nadie más lo entiende.
- **ChatGPT:** me ayudó a sacar un precio, pero al día siguiente no se acordaba de nada.
- **El bot de WhatsApp Business:** les contesta a mis clientes, pero a mí no me ayuda con nada.

### Lo que me haría elegir sin dudar
- Que **empiece a servirme el primer día**, sin cargar 200 productos a mano.
- Que **le hable como le hablo a mi empleada**, con audios y en jopara.
- Que **me diga la verdad**: si gano o pierdo, sin tener que interpretar gráficos.
- Que **me ayude a cobrar** sin que yo quede como la mala.
- Que **la factura salga sola** cuando vendo.
- Que **mi contador lo acepte** y me deje de retar.
- Que **si no me sirve, me pueda ir con mis datos** sin quedar atrapada.

### Lo que me haría irme
- **Una sola vez** que diga "anotado" y después no esté.
- Que tarde más de lo que tardo en anotar en el cuaderno.
- Que me mande mensajes de más.
- Que un mes me cobre algo que no entiendo.

---

## 2. Soy el cliente persona

*Personaje: Diego, 34 años, empleado en relación de dependencia en Asunción, con un emprendimiento chico de fin de semana (vende tortas por Instagram). Tiene tarjeta de crédito, un préstamo de la cooperativa y quiere juntar para la entrada de un departamento.*

### Mi día hoy
Cobro el 28 y el 15 ya no sé dónde quedó la plata. La tarjeta la pago en mínimo "este mes nomás". Las tortas me dejan plata pero la mezclo con el sueldo. Bajé dos apps de finanzas y las borré: me pedían anotar cada café.

### Lo que me duele
1. **Ansiedad a fin de mes.** No sé si llego.
2. **La tarjeta y el préstamo** me comen y no sé cuál pagar primero.
3. **No junto nada** aunque gano bien.
4. **No sé si las tortas me dejan plata** o solo me hacen trabajar el fin de semana.

### Lo que me haría elegir sin dudar
- **No tener que anotar nada.** Reenvío un comprobante y listo.
- Que me responda **una sola pregunta: "¿estoy bien?"**.
- Que **me cuide de mí mismo** y me avise antes de que me pase, no después.
- Que me diga si el emprendimiento **vale la pena**, con números.
- Sentir que **alguien está vigilando esto por mí**.

### Lo que me haría irme
- Sentirme culpable cada vez que la abro.
- Que me pida datos de mi banco sin explicarme qué hace con ellos.
- Que el número que me da no sea confiable.

> **Nota del CEO:** Diego es el cliente del Horizonte 3. Hoy el plan maestro estaciona Personal, y está bien. Pero Diego y Carmen **son la misma persona en distintos momentos**: Carmen también tiene una casa, y Diego también tiene un negocio. Por eso el puente de la sección 0 no es una función más: es la razón por la que EOS puede llegar a ser único en el mundo, no solo en Paraguay.

---

## 3. Soy el CEO de TransTech: lo que escucho

Juntando a los dos clientes, **la gente no quiere un software. Quiere dejar de preocuparse.** Todo lo que piden entra en cuatro promesas:

1. **Me saca trabajo** (no me lo agrega).
2. **Me dice la verdad** (y nunca me miente).
3. **Me avisa antes** (no después).
4. **Me deja más plata o más tranquilidad** que lo que me cuesta, **y me lo demuestra**.

Los competidores cumplen, como mucho, una de las cuatro. **EOS tiene que cumplir las cuatro, todas las semanas y con cada cliente.** Ese es el "rotundamente mejor". No es tener más funciones: es cumplir las cuatro sin fallar.

### Las promesas públicas de EOS (el contrato con el cliente)

Las propone el CEO; las aprueba el dueño (sección 10). Cada una tiene que ser **verdad antes de publicarse**.

| # | Promesa | Qué la sostiene | Estado |
|---|---|---|---|
| P1 | **"Nunca te digo que hice algo que no hice."** | Worker Gate con auditoría, detector de "solo memoria", corrección del "ya cobré" falso | Casi: error del circuito 9 % (26/09). Se publica cuando baje de 2 %. |
| P2 | **"Si me equivoco, lo arreglás con una palabra."** ("anulá la última", "no, eran 5") | Verbos de anulación existentes (`lib/autonomia/riesgo.ts`) | Falta probarlo en vivo con las frases reales (fila R4). |
| P3 | **"Tus datos son tuyos. Te los llevás cuando quieras."** | `app/api/cuenta/exportar` | Existe. Falta que la exportación sirva al contador (Excel legible) y decirlo en la venta. |
| P4 | **"Cada mes te muestro lo que hice por vos."** | Informe de impacto (fila R1) | No existe. **Es la prioridad número uno.** |
| P5 | **"Una persona te contesta."** | Soporte por WhatsApp distinto del de EOS, 4 horas hábiles | Falta el número y el compromiso (plan maestro, 3.3). |
| P6 | **"No te lleno de mensajes."** | Niveles de aviso: silencio, ajuste y decisión (doctrina de `eos_finanzas_principios`) | Falta un tope diario de avisos por cuenta (fila R5). |

**Ningún competidor del mapa puede firmar P1, P2 y P4 juntas.** Ese es el diferencial que se ve en una línea.

---

## 4. Las diez cosas por las que el cliente elige, y dónde vamos a ser los mejores

El cliente no compara listas de funciones: compara cómo **se siente** usar cada cosa. Estas son las diez dimensiones, sacadas de las secciones 1 y 2, con la vara que hay que superar.

| # | Dimensión | La vara hoy (el mejor que el cliente conoce) | Dónde está EOS (27/09) | Meta de EOS | Horizonte |
|---|---|---|---|---|---|
| 1 | **Empezar** | El cuaderno: cero minutos | Hay que cargar productos uno por uno; 3 de 5 cuentas nunca recibieron valor | Primer valor en < 5 min; catálogo desde una foto | H1 |
| 2 | **Anotar** | Decírselo a un empleado de confianza | Funciona por WhatsApp, error 9 %, p50 ~19 s medido en septiembre | Audio o texto en jopara, < 8 s, error < 2 % | H1 |
| 3 | **Saber cómo voy** | El contador, una vez por mes y tarde | Pantallas de Negocio, Briefing por correo | Resumen del lunes + cierre del día 1 + "¿cuánto gané?" en una frase | H1 |
| 4 | **Enterarme antes** | Nadie: hoy se entera tarde | Pronóstico y pulso existen, pero casi no se usan en las respuestas | Avisos de margen, stock y deudores en el momento justo, con tope diario | H1 |
| 5 | **Confiar** | El cuaderno no miente | Auditoría encadenada; falta publicarlo como promesa | Promesas P1 a P3 publicadas y medidas | H1 |
| 6 | **Ver el impacto** | Nadie lo hace | No existe | Informe de impacto mensual con guaraníes y horas | H1 |
| 7 | **Cobrar y facturar** | Facturadores dedicados y transferencias | Facturación al ~60 %, sin links de pago | "Facturale a Juan" emite; link de pago en el mismo mensaje | H2 |
| 8 | **Que el contador lo acepte** | Llevar los papeles | No existe el rol | El contador ve todo, con permiso, sin pedir nada | H2 |
| 9 | **Negocio y casa juntos** | Nadie lo hace | Separación por `ambito` hecha; nadie la usa del lado personal | "¿Cuánto me puedo llevar a casa?" | H2 → H3 |
| 10 | **Precio y valor** | "Gratis" (Meta) o licencias de ERP | Módulos con precio y armador | Precio claro y el informe que demuestra que vale diez veces más | H1 → H2 |

**Dónde podemos ser los mejores del mundo, no solo de Paraguay:** 6 (rendir cuentas del impacto), 9 (negocio y casa juntos) y 2 en jopara (nadie más lo va a entrenar).

---

## 5. Horizonte 1 (días 0 a 60): el encargado que no falla

**Objetivo:** que las cuatro promesas de la sección 3 se cumplan todas las semanas con cada cuenta, y que el cliente **lo vea escrito**.

Este horizonte **está dentro del congelamiento** del plan maestro: todo es activación, circuito central o cobro. Toma las filas D1 a D10 de `plan-diferenciacion-2026-09-27.md` y les suma cinco:

| # | Tarea | Frente | Terminado cuando |
|---|---|---|---|
| R1 | **Informe de impacto mensual.** El día 1, junto con el cierre del mes (D9): cosas anotadas, horas estimadas ahorradas (con el supuesto a la vista), plata cobrada después de un aviso de deudor, quiebres de stock avisados a tiempo y ventas a pérdida evitadas. | Activación | Sale para una cuenta de prueba con datos sembrados y cada número se puede rastrear hasta sus filas en la base. **Sin números inflados:** si no hay dato, la línea no aparece. |
| R2 | **Supuesto de "horas ahorradas" explícito y conservador.** Por ejemplo, 2 minutos por registro, documentado y visible en el propio informe ("calculamos 2 minutos por cosa anotada"). | Activación | El supuesto vive en un solo lugar del código y en el texto del informe. El dueño lo aprueba. |
| R3 | **Error del circuito < 2 %** (P1). Toma la batería C1 y el indicador C2 del plan maestro y ataca las fallas por frecuencia. | Circuito | Dos semanas seguidas bajo el 2 % en cuentas reales, según `npm run piloto`. |
| R4 | **Corregir con una palabra** (P2): "anulá la última", "no, eran 5", "esa venta era a Juan". Sumar estas frases a la batería. | Circuito | Diez frases de corrección dan ≥ 95 % de acierto y la corrección se ve en Negocio. |
| R5 | **Tope de avisos proactivos** (P6): como máximo dos avisos no pedidos por día y por cuenta, priorizados por plata en riesgo. El resumen del lunes no cuenta. | Circuito | Test: con cinco avisos candidatos en un día, salen los dos de más plata en juego y el resto va al resumen del lunes. |

**Salida del H1 (condición para abrir el H2):** 20 cuentas pagas activas, ≥ 40 % "muy mal" en la pregunta de la ausencia, error del circuito < 2 % y el primer Informe de impacto real enviado.

---

## 6. Horizonte 2 (días 60 a 180): el encargado que hace

**Objetivo:** que EOS no solo anote y avise, sino que **haga** lo que el dueño odia hacer: cobrar, facturar, pedir al proveedor y separar la plata de la casa.

| # | Tarea | Por qué cambia la vida | Terminado cuando |
|---|---|---|---|
| R6 | **Facturar hablando** (plan maestro, filas 19 y 20). | Saca el miedo número 4 de Carmen. | "Facturale 2 bolsas a Juan Pérez" emite en SIFEN producción y deja la venta, el stock y el saldo. |
| R7 | **Link de pago en el cobro.** El borrador de cobro (D7) trae un link de Bancard para que el cliente de Carmen pague con tarjeta o QR. | Cobrar deja de dar vergüenza: EOS manda el link y ella solo reenvía. | Un link generado desde el chat se paga en producción y el saldo del deudor baja solo. **Depende de Bancard producción.** |
| R8 | **Rol contador y referidos** (plan maestro, filas 15 y 16). | Carmen deja de pelear con su contador y el contador trae a sus otros clientes. | 3 estudios contables usando el rol con clientes reales. |
| R9 | **"¿Cuánto me puedo llevar a casa este mes?"** Con el resultado del mes, lo que se debe pagar en los próximos 30 días y un colchón mínimo que fija el dueño, EOS calcula el retiro que no pone en riesgo el negocio. | Es el puente entre negocio y casa. Nadie más lo puede contestar. | Con una cuenta de prueba, la respuesta muestra el cálculo paso a paso en guaraníes. Si faltan datos, lo dice y no inventa un número. |
| R10 | **Registrar el retiro del dueño** como movimiento de ámbito negocio que sale y, si la persona usa Personal, entra en ámbito personal. | La plata deja de "desaparecer" entre el local y la casa. | El retiro aparece en los dos lados sin duplicarse en el resultado del negocio. **Requiere revisar el candado de `ambito` antes de tocar nada** (ver memoria `eos_finanzas_ambito`). |
| R11 | **Pedido sugerido al proveedor.** Cuando el stock de varios productos del mismo proveedor baja del umbral, EOS arma el pedido y el dueño lo reenvía. | El quiebre de stock pasa de avisado a resuelto. | Sonda con 3 productos de un proveedor: sale un solo pedido con cantidades según el ritmo de venta. EOS no se lo manda al proveedor. |
| R12 | **Alta y primer valor dentro de WhatsApp** (plan maestro, fila 12 y canal 2). | Carmen no tiene que abrir la computadora nunca. | Una cuenta nueva se crea y registra su primera venta sin abrir la web. |

**Salida del H2 (condición para abrir el H3):** 100 cuentas pagas, churn ≤ 5 % mensual, facturación en producción y al menos 30 % de las cuentas usando "¿cuánto me puedo llevar a casa?" una vez por mes.

---

## 7. Horizonte 3 (meses 6 a 18): el que cuida la vida entera

**Objetivo:** cumplir la doctrina original de EOS: *"En finanzas, EOS trabaja y el usuario observa"* (`eos_finanzas_principios`, recorrido de 30 días de Marta en `eos_finanzas_vision`). Primero para los dueños que ya confían en EOS por su negocio, después para personas como Diego.

| # | Tarea | Qué se toma de lo que ya existe | Terminado cuando |
|---|---|---|---|
| R13 | **Constitución Financiera** para el dueño que ya retira con R9: colchón, ahorro, deudas a priorizar, objetivos y el monto a partir del cual EOS pregunta. | Objetivos, Worker Gate, aprobaciones | Cinco preguntas, una sola vez, editables después; queda como política de la cuenta. |
| R14 | **El día de pago:** EOS aplica la Constitución cuando llega el retiro o el sueldo (reenviando un comprobante), y dice "no necesitás hacer nada". | Lectura de imágenes y PDF, pulso financiero | El recorrido del día de pago de `eos_finanzas_vision` funciona de punta a punta con una cuenta de prueba. |
| R15 | **"¿Estoy bien?"** como primera respuesta de Personal: seguro, atención o decisión, con los tres niveles de aviso. | `lib/finanzas/pulso.ts` | La pantalla y el chat contestan primero eso; el detalle es opcional. |
| R16 | **Salud financiera del negocio y de la familia en un solo número**, explicado en palabras. | Resultado, posición y pulso | Aparece en el Informe de impacto con su tendencia de tres meses. |
| R17 | **Integraciones con bancos, cooperativas y billeteras** cuando existan en Paraguay (`origen='integracion'` ya reservado). | Memoria `eos_finanzas_integraciones` | Una fuente real conectada con permiso explícito y revocable. |
| R18 | **Salir de Paraguay con la capa conversacional** (jopara aparte, que queda como ventaja local). | La conversación es portable; SIFEN y Bancard no | Decisión del dueño con datos del H2. |

**Límite que no se cruza:** EOS no da recomendaciones de inversión ni mueve plata por su cuenta. Calcula, avisa y propone dentro de la política del dueño. Los movimientos los hace la persona.

---

## 8. Cómo se gana el momento de la elección

El cliente duda cuando siente riesgo. Para que **no dude**, hay que sacarle cada riesgo antes de que lo piense:

| El cliente piensa… | EOS responde con… | Fila |
|---|---|---|
| "¿Y si no me sirve?" | Prueba con resultado: 14 días del combo Negocio y el primer Informe de impacto al final de la prueba | Decisión del dueño (plan maestro 5.5) + R1 |
| "¿Y si pierdo mis datos o quedo atrapado?" | P3: te los llevás cuando quieras, en Excel | R1 / P3 |
| "¿Y si se equivoca?" | P1 y P2: nunca miente y se corrige con una palabra | R3, R4 |
| "Es difícil de usar." | Demo de 30 segundos: un audio y listo | D15 |
| "Mi contador no lo va a aceptar." | Es tu contador el que te lo recomienda | R8 |
| "Es caro." | El informe muestra cuánto te dejó; el precio se compara contra eso | R1 |
| "¿Es seguro darle mis números?" | Página de privacidad en lenguaje simple: qué guardamos, quién lo ve y cómo borrarlo | Revisión legal (plan maestro, fila 22) |

---

## 9. El tablero de impacto (lo que mide el CEO cada viernes)

Además de la estrella polar del plan maestro, estos números dicen si **le estamos cambiando la vida a la gente**. Salen de `npm run piloto`, solo con cuentas reales.

| Indicador | Qué dice | Meta H1 | Meta H2 |
|---|---|---|---|
| **Horas devueltas por cuenta por mes** | Tiempo que el dueño no pasó anotando (supuesto de R2) | ≥ 4 h | ≥ 8 h |
| **Plata recuperada por cuenta por mes** | Cobros hechos después de un aviso de deudor + ventas a pérdida evitadas | Medirlo | ≥ 5 veces el precio pagado |
| **Sorpresas evitadas** | Avisos de stock o margen seguidos de una acción en 48 h | ≥ 30 % de los avisos | ≥ 50 % |
| **Pregunta de la ausencia** | "¿Cómo te sentirías si mañana no pudieras usar EOS?" → "muy mal" | ≥ 40 % | ≥ 50 % |
| **Error del circuito** | Acciones fallidas / totales | < 2 % | < 1 % |
| **Recomendación espontánea** | Altas que llegan por referido de cliente o de contador | Medirlo | ≥ 30 % de las altas |

**Regla:** el Informe de impacto que le llega al cliente y este tablero salen **de las mismas consultas**. Si un número no se puede mostrar al cliente con orgullo, tampoco se festeja internamente.

---

## 10. Decisiones que solo toma el dueño

1. **Aprobar las promesas públicas P1 a P6** y el orden en que se publican. Cada una se publica solo cuando es verdad (sección 3).
2. **El Informe de impacto como prioridad número uno del H1** y el supuesto de minutos por registro (R2).
3. **Las condiciones de entrada al H2 y al H3.** Son la protección contra construir el futuro antes de tener el presente.
4. **La prueba de 14 días del combo Negocio con el Informe de impacto al final**, en lugar del gratuito actual (se relaciona con plan maestro 5.5).
5. **R9 y R10** ("¿cuánto me puedo llevar a casa?"): confirmar que es la apuesta del H2. Es lo que conecta Negocio con Personal sin descongelar Personal antes de tiempo.
6. **Validar los personajes con clientes reales.** Las secciones 1 y 2 son hipótesis armadas; tres conversaciones reales valen más que este documento entero.

---

## 11. Reglas para trabajar esta hoja de ruta con Code

1. **Cada sesión empieza leyendo** este documento, `plan-diferenciacion-2026-09-27.md`, `plan-maestro-2026-09-26.md`, `CLAUDE.md` y `docs/coordinacion-sesiones.md`, y corre `npm run quien-toca`.
2. **Solo se trabajan filas del horizonte abierto.** Hoy es el H1 (R1 a R5, más D1 a D16). Una fila del H2 o del H3 necesita que el dueño declare abierto ese horizonte, y queda anotado en la Bitácora.
3. **Ningún número de impacto se inventa ni se redondea para arriba.** Si el dato no existe, la línea no aparece en el informe. Un informe inflado rompe P1.
4. **EOS no manda nada a terceros por su cuenta** (deudores, proveedores, contador): prepara el texto y el dueño decide.
5. **Nada se afirma sobre producción desde un documento.** Se pide `npm run go` o se pregunta al dueño.
6. **Todo texto visible para el cliente** se revisa contra las palabras prohibidas ("ilimitado", "sin tope", "sin límite"), en modo día y noche y en el teléfono.
7. **Al terminar una fila**, se agrega una línea a la Bitácora con la fecha, la fila y el resultado medido.

---

## Bitácora

| Fecha | Fila | Resultado medido |
|---|---|---|
| 2026-09-27 | — | Documento creado. Horizonte abierto: H1. Verificado en el código: existen la anulación de acciones (`lib/autonomia/riesgo.ts`) y la exportación de la cuenta (`app/api/cuenta/exportar`); no existen el Informe de impacto, el cálculo de retiro del dueño ni los links de pago. |
| 2026-09-27 | R1 + R2 | Código listo en la rama `feat/informe-impacto` (sin mergear, migración v206 sin aplicar). Sale el día 1 de cada mes, con reintento hasta el 5, sobre el mes anterior; con baja propia; guarda los números enviados en `eos_informes_impacto_v206`. Supuesto de R2: **2 minutos por cosa anotada** (`MINUTOS_POR_REGISTRO`), dicho en el propio correo; falta que el dueño lo apruebe. No cuentan `RESPONDER` ni `GUARDAR_MEMORIA`. **Mínimo para mandar: 10 cosas anotadas o un cobro.** Medido contra producción en solo lectura: con agosto, 3 cuentas activas y ninguna llegaba a un informe que valiera la pena. Con setiembre (parcial), 2 de 6 lo recibirían: 70 cosas, 7 ventas y ₲ 66.000 cobrados en una; 40 cosas, 25 ventas por ₲ 7.187.500 y ₲ 1.500.000 por cobrar en la otra. Queda afuera por ahora "quiebres de stock avisados": `eos_negocio_avisos` borra el aviso cuando se resuelve y no deja historia. |
