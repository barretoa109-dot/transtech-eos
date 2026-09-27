# Plan de diferenciación: que EOS no se pueda comparar

**Fecha:** 2026-09-27
**Pedido del dueño:** "No quiero que un posible cliente nos compare con otra empresa. Quiero que diga que EOS es único y que no puede vivir sin él."
**Para qué sirve:** es el documento de trabajo que usan las sesiones de Code para construir y medir **lo que hace único a EOS**. Cada fila trae un criterio de "terminado" que se puede medir.
**Cómo se relaciona con lo que ya existe:** el orden de trabajo lo sigue marcando `plan-maestro-2026-09-26.md`. Este documento **no abre un frente nuevo**: toma las filas de activación, circuito y canal del plan maestro y les da una dirección. Cada una tiene que servir para volver a EOS imposible de reemplazar, no solo "mejor". Donde este plan pide algo que el plan maestro no tiene, lo marca y dice en cuál de los tres frentes permitidos entra.

> **Regla de lectura para Code.** Igual que el plan maestro: este documento no sabe qué está prendido en Vercel ni en producción (ver `CLAUDE.md`, "Decisiones del dueño"). Donde dice "confirmar", preguntale al dueño o pedile la salida de `npm run go`. Los nombres de competidores y sus funciones son de una búsqueda pública del 27/09/2026 y envejecen rápido. Antes de citarlos en material comercial, volvé a verificarlos.

---

## 0. Resumen en una página

**La verdad incómoda primero.** "Único" no se declara: lo dice el cliente cuando no encuentra con qué compararnos. Y cualquier **función** se copia en pocos meses: GestionPy ya anuncia "chatbot con IA por WhatsApp" y Meta regala un asistente de IA dentro de WhatsApp Business. Si EOS pelea función contra función, entra en la tabla comparativa y pierde por precio, por marca o por antigüedad.

**La estrategia.** No competir en la categoría "sistema de gestión" ni en la de "chatbot de WhatsApp". **Crear una categoría nueva, en la que EOS sea el único que existe:**

> **EOS es el encargado de tu negocio que vive en tu WhatsApp.** Anota lo que le decís, sabe cómo va tu negocio y te avisa antes de que te des cuenta.

No es un software que se usa. Es alguien que trabaja para el dueño. Un sistema se compara con otros sistemas; a un encargado de confianza no se lo compara, se lo extraña cuando no está.

**Las tres inversiones que nadie más hace a la vez:**

| Todos los demás | EOS |
|---|---|
| Le hablan **al cliente** del negocio (bots que venden y atienden) | Le habla **al dueño** |
| Esperan que **cargues** datos en formularios | **Anota lo que decís**, escrito o en audio |
| **Muestran** reportes cuando los abrís | **Te avisa primero**, aunque no abras nada |

**Lo que hace que no se pueda dejar (los fosos):** la memoria acumulada del negocio, el hábito del lunes, el contador conectado, la confianza de que nunca miente y lo paraguayo en serio. Están en la sección 3. Son lo único que un competidor no puede copiar en tres meses, porque se construyen con **tiempo de uso**, no con código.

**Cómo se prueba.** Con ocho "momentos imprescindibles" (sección 4): situaciones concretas en las que EOS le resuelve algo al dueño que ningún otro producto le resuelve **sin que abra una pantalla**. La meta es que una cuenta nueva viva al menos 4 de los 8 en sus primeros 30 días.

**Cómo se mide "no puede vivir sin él".** La pregunta de la ausencia: *"¿Cómo te sentirías si mañana ya no pudieras usar EOS?"*. La meta es que **40 % o más** responda "muy mal" (sección 7). Es el umbral clásico que separa un producto que la gente tolera de uno que necesita.

---

## 1. El mapa real de la competencia (27/09/2026)

El cliente compara cuando puede poner dos cosas en la misma fila. Hoy hay cinco grupos contra los que nos pueden poner:

| Grupo | Ejemplos | Qué hace | Por qué un cliente nos pondría al lado | Por qué **no** debería poder |
|---|---|---|---|---|
| ERP pyme con SIFEN | [GeStock360](https://saastech.com.py/), [Novasoft](https://novasoft.com.py/), [GestionPy](https://gestionpy.com/) | Stock, ventas, compras, caja, factura electrónica, todo con formularios. Algunos suman un chatbot con IA **para atender a los clientes** del negocio. | "Los dos llevan el stock y facturan." | Ellos necesitan que el dueño se siente a cargar. EOS anota lo que el dueño ya dice. El dueño que no carga nada en un ERP es justo nuestro cliente. |
| Facturadores | Goekua, SmartDoc, EDYDSI (ver [comparador](https://www.comparasoftware.com.py/facturacion-en-linea)) | Emitir el documento electrónico. | "Necesito facturar electrónico." | Facturar es un trámite. A EOS le decís "facturale 2 bolsas a Juan" y además te queda la venta, el stock y lo que te debe. |
| Bots de WhatsApp que venden | [Business AI de Meta](https://www.lanacion.com.ar/tecnologia/whatsapp-business-como-funciona-el-agente-de-ia-que-ahora-te-respondera-siempre-y-que-promete-nid24022026/), [Chatsell](https://chatsell.net/automatizar-cobros-recordatorios-pago-whatsapp-ia-pymes/), [SyncManager](https://www.sync-manager.com/chatbot-whatsapp.php) | Contestan a los clientes del negocio, recomiendan productos, persiguen ventas. | "Los dos son IA en WhatsApp." | Ellos trabajan **hacia afuera**, con el cliente. EOS trabaja **hacia adentro**, con el dueño. No se excluyen: un negocio puede tener los dos. Eso hay que decirlo así, sin pelearlos. |
| Cuaderno + ChatGPT | La libreta, el Excel, preguntarle a ChatGPT | ChatGPT razona pero no recuerda el negocio ni registra nada. El cuaderno recuerda pero no avisa. | "Para eso uso ChatGPT." | ChatGPT no sabe cuánto te debe Juan ni cuántas bolsas te quedan. EOS sí, porque lo anotó el martes. |
| Bots de registro por WhatsApp | [El caso de vendedores ambulantes en México](https://www.xataka.com.mx/robotica-e-ia/creo-ia-para-whatsapp-que-ayuda-a-vendedores-ambulantes-ahora-openai-quiere-uno-sus-programas-exclusivos) | Registran ventas y gastos por chat. | Es **el competidor conceptual más cercano**, aunque no esté en Paraguay. | Hoy registrar es la base, no la diferencia. Lo que tiene que distinguir a EOS es lo que viene después: avisar, cobrar, facturar, conectar al contador y entender el jopara. |

**Lectura.** Nadie ocupa la combinación de **dueño + anota hablando + avisa primero + paraguayo de verdad**. Ese es el lugar. La amenaza real no es un ERP local: es que Meta o un bot de registro cierren el hueco desde WhatsApp. Por eso los fosos de la sección 3 importan más que cualquier función.

---

## 2. La categoría y las palabras

### 2.1 Cómo se nombra lo que somos

Propuestas, para que elija el dueño (sección 9):

1. **"Tu encargado por WhatsApp"**: la más clara para el ICP, porque todo dueño de pyme sabe qué es un encargado de confianza.
2. **"El socio que anota"**: más cálida, pero "socio" puede sonar a que EOS se queda con algo.
3. **"El gerente de bolsillo"**: suena más aspiracional y es menos concreta.

Recomendación: **1**. Donde hoy se dice "sistema" o "plataforma", se dice "encargado". Donde se dice "funciones", se dice "lo que EOS hace por vos".

### 2.2 El mensaje en tres niveles

- **Una línea:** *"Tu negocio anotado, cuidado y al día. Solo le escribís a EOS por WhatsApp."*
- **Tres frases de prueba** (cada una con una captura real, con permiso):
  1. *"Mandé un audio: 'vendí tres bolsas a 180'. Quedó anotado y me bajó el stock."*
  2. *"El lunes me llegó cuánto vendí, quién me debe y qué se me está acabando."*
  3. *"Me avisó que estaba vendiendo por debajo de lo que me cuesta."*
- **La frase de cierre:** *"Los sistemas te piden trabajo. EOS te lo saca."*

### 2.3 Lo que no se dice nunca

- **"Ilimitado", "sin tope", "sin límite"**: decisión del dueño, en ningún plan.
- **"Inteligencia artificial" como argumento principal.** Al ICP no le importa cómo funciona. Le importa que anote y que avise. La IA se menciona, si hace falta, en la letra chica.
- **Tablas comparativas de funciones contra otros productos.** Una tabla nos mete en la categoría de la que queremos salir.
- **"Más barato que…"** Competir por precio es aceptar la comparación.
- **Promesas sobre lo que todavía no funciona en producción**, como la factura electrónica mientras falte el certificado.

---

## 3. Los cinco fosos: lo que un competidor no puede copiar en tres meses

Una función se copia. Estas cinco cosas no, porque dependen del tiempo que el cliente pasó con EOS.

| # | Foso | Por qué no se copia | Qué hay hoy | Qué falta |
|---|---|---|---|---|
| F1 | **La memoria del negocio** | Después de tres meses, EOS sabe los productos, los costos, quién paga tarde, qué días se vende más y qué proveedor sube precios. Irse significa empezar de cero con otro. | Catálogo, costos (v133), compras y gastos (v134), clientes, `lib/eos/contexto-negocio.ts`. | Que el dueño **vea** cuánto sabe EOS de su negocio: pregunta "¿qué sabés de mi negocio?" (fila D5). Si el valor acumulado no se ve, no retiene. |
| F2 | **El hábito del lunes** | Un mensaje que llega todas las semanas con información que el dueño no tenía crea un ritual. Los rituales no se cambian por un 10 % de descuento. | El Briefing existe por correo (`lib/briefing/`). | Llevarlo a WhatsApp (plan maestro, fila 10; depende de las plantillas de Meta) y darle el formato de 4.5. |
| F3 | **El contador conectado** | Si el contador del cliente ya recibe todo desde EOS, el cliente no se va, porque el contador no lo deja. Y el contador trae a sus otros clientes. Es un efecto de red. | Empresas con miembros. | Rol contador de solo lectura y código de referido (plan maestro, filas 15 y 16). |
| F4 | **La confianza verificable** | "EOS nunca me dijo que hizo algo que no hizo." Se gana en meses y se pierde en un día. Los bots genéricos inventan. | Worker Gate con auditoría encadenada, corrección de "solo memoria", el arreglo del "ya cobré" falso. | Medir la tasa de error del circuito (plan maestro, C2) y bajarla por debajo del 5 %. Si una acción falla, decirlo en la misma respuesta. |
| F5 | **Lo paraguayo en serio** | Jopara, "fiado", "a cuenta", "150 lucas", rubros locales, guaraníes sin decimales, SIFEN y Bancard. Un producto regional lo "traduce"; EOS lo **entiende**. | Formato en guaraníes y rubros del piloto. | La batería de frases (plan maestro, C1) tiene que incluir jopara y audios reales (fila D1). |

**Regla:** toda fila de trabajo tiene que fortalecer por lo menos un foso. Si no fortalece ninguno, no es diferenciación. Puede ser necesaria, pero va por el plan maestro.

---

## 4. Los ocho momentos imprescindibles

Un **momento imprescindible** es una situación en la que EOS le resuelve algo real al dueño **sin que abra una pantalla** y que ningún producto del mapa (sección 1) le resuelve así. Son la unidad de diferenciación. Cada uno se puede mostrar en una captura de WhatsApp de tres líneas.

| # | Momento | Lo que vive el dueño | Qué existe | Qué falta (fila) | Foso |
|---|---|---|---|---|---|
| M0 | **Los primeros 5 minutos** | Saca una foto a su lista de precios y en dos minutos tiene el catálogo cargado. | Lectura de imágenes, verbo de crear producto (v131). | Importar la lista completa de una vez desde una foto o un Excel (plan maestro, fila 8) y las frases de ejemplo por rubro (fila 7). → **D3** | F1 |
| M1 | **"Anotado"** | Manda un audio mientras atiende: "vendí tres bolsas a 180 al contado". EOS contesta en una línea qué anotó y cuánto stock queda. | Dictado (`lib/eos/dictado.ts`), verbos de venta y stock. | Respuesta en menos de 8 s (plan maestro, C4) y confirmación en **una línea**, sin relleno. → **D2** | F4, F5 |
| M2 | **"Estás vendiendo a pérdida"** | Registra una venta por debajo del costo y EOS se lo dice en la misma respuesta: "Ojo: esto te cuesta 160 mil y lo vendiste a 150". | Costos por producto (v133). | La guardia de margen en la respuesta de venta. → **D4** | F1, F4 |
| M3 | **"Se te acaba"** | "Al ritmo de esta semana te quedan 4 días de balanceado." Llega antes de que se termine, no después. | `lib/pronostico/`, cobertura en `lib/autonomia/riesgo.ts`. | Que el aviso salga en la respuesta de venta cuando quedan menos de 7 días, y en el resumen del lunes. → **D6** | F1 |
| M4 | **"¿Quién me debe?"** | Pregunta y recibe la lista con nombres, montos y días. EOS le ofrece el texto para cobrar y el dueño lo reenvía con un toque. | Posición y cuentas por cobrar (`lib/contabilidad/posicion.ts`), seguimientos del CRM. | El borrador del mensaje de cobro, listo para reenviar. **EOS no le escribe al deudor en nombre del dueño**: le prepara el texto. → **D7** | F1, F4 |
| M5 | **El lunes** | A las 8 de la mañana llega: cuánto vendió la semana, quién le debe, qué se le acaba y **una sola cosa** para hacer. | Briefing por correo. | Formato de cuatro renglones y envío por WhatsApp (plan maestro, fila 10). → **D8** | F2 |
| M6 | **"¿Cuánto gané este mes?"** | El día 1 recibe el resultado del mes en una frase: vendiste tanto, gastaste tanto, te quedó tanto, y cómo se compara con el mes anterior. | `lib/contabilidad/resultado.ts`. | Envío automático del cierre del mes (correo ahora, WhatsApp cuando Meta lo habilite). → **D9** | F1, F2 |
| M7 | **El contador ya lo tiene** | A fin de mes el contador no le pide papeles, porque ya ve todo. | Empresas con miembros. | Rol contador (plan maestro, filas 15 y 16). → **D11** | F3 |
| M8 | **Facturar hablando** | "Facturale 2 bolsas a Juan Pérez." Sale la factura electrónica y además queda la venta, el stock y lo que Juan debe. | La facturación está al ~60 %. | Certificado y envío a SIFEN (plan maestro, filas 19 y 20). **No se promete hasta que funcione.** → **D12** | F5 |

**Meta:** una cuenta nueva vive **4 de los 8 momentos en sus primeros 30 días**, y M1 en sus primeras 24 horas.

---

## 5. La prueba de unicidad: el filtro para cualquier trabajo nuevo

Antes de construir algo "para diferenciarnos", la sesión de Code responde estas cuatro preguntas en su primer mensaje. Si no pasa por lo menos tres, no es diferenciación.

1. **¿Funciona sin que el dueño abra una pantalla?** Si hay que entrar a la web para aprovecharlo, cualquier ERP lo tiene.
2. **¿Un ERP con formularios podría decir lo mismo en su página?** Si sí, no nos distingue.
3. **¿Deja algo que el dueño perdería si se va?** Memoria, historia, un hábito, un contador conectado.
4. **¿Cabe en una captura de WhatsApp de tres líneas?** Si no se puede mostrar así, no se puede vender así.

Y una quinta, que no se negocia: **¿respeta el congelamiento del plan maestro (2.4)?** Solo entran las filas de activación, confiabilidad del circuito o cobro. Si no entra en ninguna de las tres, se pide la excepción al dueño con el número de la estrella polar que se espera mover.

---

## 6. Cómo se cuenta sin que nos comparen

| Pieza | Qué es | Por qué no invita a comparar |
|---|---|---|
| **Demo de 30 segundos** | Un video vertical: audio al WhatsApp, la respuesta "anotado", el stock que baja y el aviso "te quedan 4 días". | No muestra pantallas ni menús. No hay nada que poner en una tabla. |
| **"Antes y después del lunes"** | Dos imágenes: el cuaderno desordenado y el resumen del lunes en WhatsApp. | Compara contra la vida del dueño, no contra otro producto. |
| **Tres testimonios con captura** | Las tres frases de 2.2, con permiso de la cuenta real. | La prueba es la conversación, no una lista de funciones. |
| **Página por rubro** | "EOS para almacenes", "para ferreterías", "para criadores de cerdos": con las frases de ese rubro. | El cliente se ve a sí mismo, no ve un catálogo. |
| **La prueba de la semana** | Propuesta para el dueño: *"Si en 7 días EOS no te dijo algo de tu negocio que no sabías, no pagás."* | Pone el foco en el resultado. Decisión del dueño (sección 9). |
| **El contador como vocero** | El estudio contable recomienda a EOS a sus clientes. | Un contador no compara software: dice "usá esto". |

---

## 7. Cómo se mide "no puede vivir sin él"

Estos números se suman a `npm run piloto`, solo con cuentas `tipo='real'`. Se leen junto con la estrella polar del plan maestro (acciones de negocio por cuenta activa por semana).

| Indicador | Definición | Meta a 90 días |
|---|---|---|
| **Pregunta de la ausencia** | "¿Cómo te sentirías si mañana ya no pudieras usar EOS?" (muy mal / algo mal / igual). A cuentas con 4 semanas o más de uso. | ≥ 40 % "muy mal" |
| **Momentos vividos** | Cuántos de los 8 momentos tuvo cada cuenta en sus primeros 30 días (se deriva de las acciones y los envíos). | ≥ 4 de 8 |
| **Racha semanal** | Semanas seguidas con al menos una acción de negocio registrada. | Mediana ≥ 6 semanas |
| **Avisos que movieron algo** | Avisos proactivos (M2, M3, M4 y M5) después de los cuales el dueño hizo algo en las siguientes 48 horas. | ≥ 30 % |
| **Tiempo al primer "anotado"** | Desde el alta hasta la primera acción de negocio correcta. | Mediana < 24 h |
| **Churn** | Módulos pagos no renovados sobre los que vencían en el mes. | ≤ 5 % mensual |

Con 5 cuentas reales, estos números no son estadística: son señales. Lo que más vale en el primer mes es lo cualitativo. El dueño habla con cada cuenta y anota **con qué nos compararon** (si lo hicieron) y **qué extrañarían**.

---

## 8. Plan de trabajo con Code

**Quién:** D = dueño, C = Code. La columna **PM** dice a qué fila del plan maestro corresponde. "Nueva" significa que no está en el plan maestro, y la columna **Frente** dice en cuál de los tres frentes permitidos entra.

### Fase 1 (semanas 1 a 4): que lo básico sea imbatible

| # | Tarea | Quién | PM | Frente | Terminado cuando |
|---|---|---|---|---|---|
| D1 | Sumar a la batería de 50 frases **15 frases en jopara y 10 transcripciones de audios reales**, anonimizadas ("vendí 3 bolsa'i a 150 lucas", "fiado a la señora Ña Rosa"). | C | 2 (C1) | Circuito | La batería da ≥ 95 % de verbo correcto **también** en el subconjunto de jopara. |
| D2 | Confirmación en una línea: la respuesta a una acción dice qué quedó anotado y el dato que importa (stock que queda, saldo del cliente), sin repetir el pedido ni adornar. | C | Nueva | Circuito | Diez sondas de venta, compra y cobro devuelven respuestas de una o dos líneas; la latencia p50 queda medida (C4). |
| D3 | Los primeros 5 minutos: el rubro en el alta, frases de ejemplo por rubro e importación del catálogo desde una foto o un Excel. | C | 7 y 8 | Activación | Una cuenta nueva por rubro carga 30 productos en menos de 2 minutos y hace su primera venta en menos de 5. |
| D4 | **Guardia de margen:** si una venta queda por debajo del costo cargado del producto, la respuesta lo dice en la misma línea, sin frenar la venta. | C | Nueva | Circuito | Test unitario y una sonda con un producto con costo: la venta queda registrada y el aviso aparece. Sin costo cargado, no dice nada. |
| D5 | **"¿Qué sabés de mi negocio?"** EOS contesta con lo que tiene: cuántos productos, clientes y proveedores, los días que más se vende y los últimos avisos. Es una respuesta del chat, **no una pantalla nueva**. | C | Nueva | Activación | Con una cuenta de prueba cargada, la respuesta sale con datos reales y en guaraníes; con una cuenta vacía, dice qué le falta aprender y cómo enseñárselo. |
| D6 | Aviso de "se te acaba": en la respuesta de una venta, cuando al ritmo de los últimos 7 días quedan menos de 7 días de stock. | C | Nueva | Circuito | Sonda con historial de ventas: aparece el aviso; con stock holgado, no aparece. Nunca más de un aviso por producto por día. |
| D13 | Sumar a `npm run piloto` los indicadores de la sección 7 que salen de la base: momentos vividos, racha, tiempo al primer "anotado". | C | 18 | Activación | El informe los muestra por cuenta real. |

### Fase 2 (semanas 3 a 8): que EOS hable primero

| # | Tarea | Quién | PM | Frente | Terminado cuando |
|---|---|---|---|---|---|
| D7 | **"¿Quién me debe?"** con borrador de cobro: la lista con nombre, monto y días, y para cada uno un mensaje amable listo para reenviar. EOS **no** le escribe al deudor. | C | Nueva | Cobro* | Sonda con 3 deudores: la lista sale ordenada por antigüedad y cada borrador tiene el monto correcto. |
| D8 | Resumen del lunes con formato fijo de cuatro renglones: vendido, te deben, se te acaba y **una cosa para hacer hoy**. Por correo ahora, por WhatsApp cuando Meta lo permita. | C (D gestiona Meta) | 10 | Activación | Primer envío real recibido por una cuenta real, con baja firmada como los correos motivacionales. |
| D9 | Cierre del mes el día 1: resultado en una frase y la comparación con el mes anterior. | C | Nueva | Activación | Sale solo el día 1, una vez por cuenta, con los números de `lib/contabilidad/resultado.ts` verificados contra la pantalla de Negocio. |
| D10 | Registrar qué avisos proactivos (D4, D6, D7, D8) fueron seguidos de una acción del dueño en 48 horas. | C | Nueva | Activación | El indicador "avisos que movieron algo" aparece en `npm run piloto`. |

\* D7 entra en **cobro** en sentido amplio: ayuda al dueño a cobrar lo que le deben, que es plata que entra al negocio del cliente. Si el dueño considera que no encaja en el congelamiento, pasa a después del día 60.

### Fase 3 (semanas 6 a 13): los fosos de red

| # | Tarea | Quién | PM | Frente | Terminado cuando |
|---|---|---|---|---|---|
| D11 | Rol contador de solo lectura y código de referido. | C | 15 y 16 | Cobro/canal | Un contador ve 2 cuentas de prueba y nada más (candado de aislamiento), y un alta con código queda atribuida. |
| D12 | Facturar hablando, solo con el certificado y SIFEN listos. | D y C | 19 y 20 | Cobro | "Facturale 2 bolsas a Juan Pérez" emite en test y deja la venta, el stock y el saldo. |
| D14 | La pregunta de la ausencia: Code prepara el texto y la lista de cuentas con 4 semanas o más; el dueño la manda en persona. | C y D | Nueva | Activación | Respuestas anotadas en la Bitácora, con "con qué nos compararon" y "qué extrañarían". |
| D15 | Material: demo de 30 segundos y tres capturas reales con permiso. | D (C prepara guion y guía de capturas) | Nueva | Activación | Las tres piezas existen y no usan ninguna palabra prohibida (2.3). |
| D16 | Páginas por rubro con el mensaje de la categoría y metadata propia. | C | 21 | Activación | Tres páginas indexadas, con títulos distintos, revisadas en modo día, noche y en teléfono. |

**Meta del día 90**, sumada a la del plan maestro: 40 % "muy mal" en la pregunta de la ausencia, 4 de 8 momentos vividos en 30 días, mediana de primer "anotado" menor a 24 horas y al menos un cliente que diga **con sus palabras** que no conoce nada parecido. Esa frase va a la Bitácora textual.

---

## 9. Reglas para trabajar este plan con Code

1. **Cada sesión empieza leyendo** este documento, `plan-maestro-2026-09-26.md`, `CLAUDE.md` y `docs/coordinacion-sesiones.md`, y corre `npm run quien-toca`.
2. **Cada sesión elige una fila** (D1 a D16) y la dice en su primer mensaje, con su respuesta a la prueba de unicidad (sección 5).
3. **Ninguna respuesta de EOS promete lo que no hizo.** Si una acción falla, la respuesta lo dice. El foso F4 vale más que cualquier función nueva.
4. **Los avisos proactivos informan, no frenan.** EOS avisa que una venta queda a pérdida o que se acaba el stock, pero nunca bloquea la acción del dueño. Es el mismo criterio del aviso interno de consumo.
5. **EOS no le escribe a terceros en nombre del dueño** (deudores, proveedores, clientes) sin que el dueño lo decida en ese momento. Prepara el texto y el dueño lo manda.
6. **Nada se afirma sobre producción desde un documento.** Se pide `npm run go` o se pregunta al dueño.
7. **Migraciones:** versión con `npm run siguiente-migracion`, nunca concatenadas a una prueba con commit y aplicadas después de mergear.
8. **Todo texto visible para el cliente** se revisa contra las palabras prohibidas (2.3), en modo día y noche y en el teléfono.
9. **Al terminar una fila**, se agrega una línea a la Bitácora con la fecha, la fila y el resultado medido.

---

## 10. Decisiones que solo toma el dueño

1. **El nombre de la categoría** (2.1). La recomendación es "tu encargado por WhatsApp".
2. **Aprobar las filas nuevas** (D2, D4, D5, D6, D7, D9, D10, D14 y D15) dentro del congelamiento, o moverlas a después del día 60.
3. **La prueba de la semana** ("si en 7 días EOS no te dijo algo que no sabías, no pagás"): si se ofrece y con qué condiciones.
4. **Dejar de usar tablas comparativas** en todo el material existente, incluida la página de planes si tiene alguna.
5. **Hablar con las cuentas reales** (plan maestro, fila 5) y sumar dos preguntas: *"¿Con qué otra cosa compararías EOS?"* y *"¿Qué extrañarías si desaparece?"*. Es el insumo más valioso de todo este plan y solo lo puede conseguir el dueño.
6. **Permisos de las cuentas reales** para usar sus capturas en el material.

---

## 11. Lo que este plan no puede prometer

- **No convierte a EOS en único por decreto.** Lo vuelve único si los ocho momentos pasan de verdad, todas las semanas, sin errores. Un "anotado" que después no aparece en Negocio destruye más diferenciación de la que construyen diez funciones.
- **Con 5 cuentas reales, todo esto es hipótesis.** Las conversaciones con esas cuentas pueden mostrar que el momento que más importa es otro. Si pasa, se reescribe la sección 4, no se defiende.
- **La amenaza más seria es de plataforma**, no de un ERP local: que Meta sume registro de ventas a su asistente de WhatsApp Business. La defensa son los fosos F1, F3 y F5, que Meta no va a construir para Paraguay. Por eso las filas de contador y de jopara no son opcionales.

---

## Bitácora

| Fecha | Fila | Resultado medido |
|---|---|---|
| 2026-09-27 | — | Documento creado. Línea de base: la del plan maestro del 26/09 (5 cuentas reales, 1 activa, activación 40 %). Competencia relevada por búsqueda pública: ERP con SIFEN (GeStock360, Novasoft, GestionPy), facturadores, bots de WhatsApp que venden (Meta Business AI, Chatsell) y un bot de registro por WhatsApp en México. Ninguno ocupa "dueño + anota hablando + avisa primero + paraguayo". |
