# Agentic Computer Use — diseño antes de tocar código (07/11/2026)

Punto 12 del documento EOS 2030 ("Agentic Computer Use"), elegido por el
dueño para dedicarle una sesión a diseñarlo, mismo criterio que multiagente,
Developer Platform y offline-first.

## 1. De dónde parte EOS hoy, medido

- **No existe ninguna infraestructura de automatización de pantalla o
  navegador** en este repo (sin Puppeteer, sin Playwright, sin nada que
  simule clicks o tipeo en un sitio de terceros).
- El documento EOS 2030, al archivarse en este repo, resume el ítem en una
  sola frase ("Agentic Computer Use") sin más detalle que el título del
  área ("EOS trabaja por el usuario"). No hay una definición propia de
  TransTech de qué tarea concreta resolvería — es el ítem más vago de los
  26, y eso mismo es una señal: diseñar en el vacío un "EOS que usa
  cualquier sitio" es exactamente lo que el propio documento, en su regla
  de prioridad, pide no hacer ("no merece prioridad solamente porque sea
  novedosa").

## 2. Qué significa esto, en concreto, para interpretarlo honestamente

"Computer Use" (el término es de Anthropic, y EOS corre sobre modelos de
Anthropic y OpenAI) significa que un agente controla una pantalla como lo
haría una persona: mira capturas, mueve el mouse, hace click, escribe —
para completar una tarea en un sitio o programa que NO tiene una API. Para
una PyME paraguaya, los candidatos reales serían sitios sin API que una
PyME usa de verdad: el portal de la SET (Marangatú) para trámites
impositivos, el homebanking de un banco o cooperativa sin open banking, un
sistema de un proveedor que solo tiene interfaz web.

## 3. Por qué esto es categóricamente más riesgoso que todo lo demás que EOS hace hoy

No es una cuestión de esfuerzo de ingeniería — es un tipo de riesgo distinto
al de cualquier otra pieza construida hasta ahora en este documento:

- **Necesita las credenciales de la persona en un sitio AJENO a EOS.** Todo
  lo que EOS hace hoy pasa por su propia base de datos y su propio camino de
  escritura auditado (`eos_execute_internal_effect_v64`). Operar un
  homebanking significa que EOS tendría que guardar o recibir, en algún
  momento, la clave del banco de alguien — exactamente la categoría de dato
  que este mismo entorno de trabajo tiene prohibido manejar en texto plano,
  y por una buena razón: un error ahí no es un dato mal leído, es una cuenta
  bancaria comprometida.
- **No hay nada que verificar del lado de EOS.** El Proof Engine (ítem 15)
  funciona porque la transacción que EOS ejecuta y la fila que queda en la
  base son la MISMA operación, atómica. Un click en un sitio de un tercero
  no tiene esa garantía: el sitio puede cambiar su interfaz sin avisar, la
  "confirmación" que EOS lee de la pantalla puede ser un error disfrazado de
  éxito, y no hay ningún trigger de auditoría propio que lo contraste.
- **Expone a TransTech a un riesgo legal que no existe en ningún otro
  lado.** Automatizar un sitio de terceros (un banco, la SET) puede violar
  sus términos de servicio, incluso si la persona autorizó a EOS a hacerlo
  en su nombre — es una decisión que corresponde evaluarse con asesoría
  legal, no una decisión técnica.
- **Es frágil por diseño.** Un sitio que cambia su HTML rompe la
  automatización sin aviso, y a diferencia de un error de API (que devuelve
  un código claro), un "Computer Use" roto puede hacer un click en el lugar
  equivocado antes de notar que algo cambió.

## 4. Lo que ya resuelve una parte de lo que "Computer Use" prometería, sin nada de este riesgo

Antes de construir algo nuevo y de alto riesgo, vale nombrar lo que el
propio documento EOS 2030 ya cubre por otro camino, más seguro:

- **Document AI (ítem 10, ya hecho):** leer un comprobante o una factura con
  visión es la forma segura de "entender lo que hay en una pantalla o un
  papel", sin necesitar controlarla.
- **Integración SIFEN de lectura (ítem 08, en curso):** consultar
  directamente una fuente de datos oficial es mejor que automatizar el
  portal que la muestra.
- Muchas tareas que "Computer Use" resolvería a fuerza bruta (clickear un
  sitio sin API) en realidad tienen una API real si alguien la busca —
  automatizar la pantalla es el último recurso, no el primero.

## 5. Recomendación de esta sesión: no construir una capacidad genérica

A diferencia de multiagente, Developer Platform y offline-first, donde la
recomendación fue "una primera pieza chica y segura", acá la recomendación
es distinta: **no hay una primera pieza segura de "Computer Use genérico"**.
El riesgo no se reduce achicando el alcance de una plataforma — se reduce
preguntando, tarea por tarea, si existe una alternativa con API, y
considerando la automatización de pantalla solo como último recurso, para
UNA tarea específica, con aprobación explícita del dueño y asesoría legal
si involucra un banco o un organismo del Estado. Construir "la
infraestructura general" antes de tener esa tarea sería exactamente el
error que el documento de multiagente ya identificó para otro ítem:
construir superficie porque se puede, no porque haga falta — pero acá,
además, esa superficie es peligrosa por sí misma, no solo innecesaria.

## Próximo paso

No hay una línea de código que seguir de acá. Lo que sí puede decidir el
dueño:

1. **¿Existe una tarea REAL y concreta hoy** (un trámite, un portal
   específico) que un cliente o el propio dueño necesite resolver y que no
   tenga API? Sin esa tarea, este ítem queda archivado como "no aplica con
   la información de hoy" — no como pendiente.
2. Si existe, la primera pregunta no es de diseño técnico sino legal: ¿los
   términos de servicio de ese sitio permiten la automatización, y bajo qué
   responsabilidad?
