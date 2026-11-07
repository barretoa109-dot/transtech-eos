# Offline-first — diseño antes de tocar código (07/11/2026)

Punto 24 del documento EOS 2030 ("Offline-First Finance"), elegido por el
dueño para dedicarle una sesión a diseñarlo, mismo criterio que ya se usó
para multiagente y Developer Platform.

## 1. De dónde parte EOS hoy, medido

- **Ya es una PWA instalable** (`public/manifest.webmanifest`,
  `public/sw.js`, v3 del 27/09). El service worker cachea SOLO lo que nunca
  cambia de contenido con el mismo nombre (`/_next/static/*`, que lleva un
  hash) y, si una navegación falla por falta de red, devuelve el shell (`/`)
  cacheado en vez de un error del navegador.
- **Todo `/api/*` va directo a la red, a propósito** (línea del propio
  `sw.js`: `url.pathname.startsWith("/api/")` se excluye de cualquier
  caché). Hoy, sin conexión: el chat no contesta, el panel no carga ningún
  número, y no hay ninguna cola ni reintento — un mensaje que no sale,
  simplemente no sale.
- **No existe ninguna forma de guardar nada en el dispositivo** más allá de
  una preferencia de interfaz (`localStorage` solo para qué "espacio" —
  Personal o Negocio— se vio último). Cero `indexedDB`, cero cola de
  mensajes, cero copia local de ningún dato financiero.

## 2. Por qué "offline-first" significa algo distinto acá que en una app común

El documento usa "Offline-First Finance" como si fuera una técnica genérica
de sincronización. No lo es, para EOS en particular:

- **El corazón de EOS es una conversación con un modelo de lenguaje.** No
  existe una versión "local" de GPT que razone sobre la plata de alguien sin
  conexión — a diferencia de una lista de tareas o una nota, que sí se puede
  editar sin red y sincronizar después. Prometer que "el chat funciona
  offline" sería prometer algo que no se puede construir con esta
  arquitectura, no una cuestión de esfuerzo.
- **Escribir en el libro financiero sin que el servidor lo confirme es
  exactamente el riesgo que el Proof Engine (ítem 15, ya construido) existe
  para evitar.** Una venta que se "guarda" en el teléfono mientras no hay
  señal y se sincroniza sola más tarde puede duplicarse, perderse, o chocar
  con otra acción que pasó mientras tanto (alguien más vendió el último
  producto del stock desde otro dispositivo). El camino de escritura de EOS
  es hoy una transacción atómica contra la base real
  (`eos_execute_internal_effect_v64`) — no tiene, ni debería tener, una
  versión que escriba "a ciegas" sin esa transacción.

## 3. Lo que sí es real y vale la pena — dos piezas, no una

Separar "ver" de "escribir", la misma distinción que ya organiza toda la
autonomía de EOS por niveles:

### (a) Ver los últimos números conocidos, sin conexión (Nivel 1, bajo riesgo)

Cuando EOS ya mostró el panel una vez con conexión, guardar esos números
—saldo, próximos vencimientos, lo que ya se vio en "Los próximos 45 días"—
en el dispositivo (`indexedDB`, no `localStorage`: son datos estructurados,
no una preferencia), y mostrarlos si no hay red, **marcados sin ambigüedad
como "sin conexión, datos de hace [cuándo]"**. Nunca como si fueran el
estado actual: un número viejo mostrado como si fuera de ahora es
exactamente el tipo de mentira silenciosa que la doctrina del proyecto
("EOS trabaja, el usuario observa") no permite en ningún otro lado.

### (b) Mandar un mensaje sin conexión, y que salga solo cuando vuelva (Nivel 1, riesgo medio)

Si la persona le escribe a EOS sin señal (muy real para una PyME del
interior), el mensaje queda visible como "pendiente de enviar" —nunca
como enviado, nunca con una respuesta inventada— y se manda solo cuando
vuelve la conexión. Dos reglas no negociables, por lo que ya aprendió este
proyecto con las ráfagas y el Worker:

- **Uno por vez, en orden, esperando la respuesta del anterior.** Mandar
  tres mensajes en cola "a la vez" apenas vuelve la señal es la misma clase
  de problema de concurrencia que `lib/gateway/worker.ts` ya resuelve
  mandando los jobs de a uno — permitir que la cola los dispare todos juntos
  lo reintroduciría del lado del cliente.
- **Nunca una acción financiera queda "medio mandada".** Si el mensaje
  decía "vendí 3 remeras" y se perdió la cola a mitad de camino, la persona
  tiene que poder ver que NO se mandó, nunca asumir que sí. El Service
  Worker puede ayudar a reintentar el envío (`Background Sync API`, con
  degradación a un reintento simple si el navegador no la soporta — Safari
  en iOS no la tiene todavía), pero la pantalla del chat es la que manda la
  verdad de qué se mandó y qué no, no el Service Worker por su cuenta.

## 4. Lo que esto explícitamente NO hace

- No hace que el chat "razone" sin conexión. Sin red, EOS no responde —se
  lo dice a la persona con claridad, en vez de fingir que está pensando.
- No escribe ninguna acción financiera en la base sin la transacción atómica
  de siempre. La cola de mensajes guarda TEXTO sin mandar, nunca un
  `REGISTRAR_VENTA` que se ejecuta localmente y se sincroniza después.
- No cachea datos financieros de forma indefinida ni sin marca de tiempo:
  cada número viejo mostrado dice desde cuándo es viejo.
- No resuelve conflictos de sincronización entre dispositivos —ese problema
  no existe en este diseño porque no hay escritura offline, solo lectura
  cacheada y mensajes en cola de salida.

## 5. Riesgo nuevo que esto introduce, y que hay que decidir cómo tratar

Guardar aunque sea el saldo y los vencimientos en el dispositivo significa
que esos datos quedan en el teléfono, legibles sin conexión —y en una PyME
chica, el teléfono del negocio a veces lo usa más de una persona. Hoy nada
de EOS persiste datos financieros fuera de la sesión del navegador; esto
sería la primera vez. Mitigación mínima: que la cola y la caché se limpien
al cerrar sesión, y considerar si amerita un PIN local aparte (ítem fuera de
alcance de esta pieza, pero que hay que nombrar).

## Próximo paso

Antes de escribir código, decisión del dueño:

1. **¿Las dos piezas (a y b), o solo una primera?** (b) es más valiosa pero
   de más riesgo (sincronización, orden, reintento); (a) es más chica y
   segura. Recomendación: empezar por (a) solamente — ver los últimos
   números sin conexión— y evaluar (b) con datos reales de cuántos usuarios
   realmente se quedan sin señal seguido.
2. **¿Vale medir primero cuánta gente realmente pierde conexión?** Si el
   panel ya registra algo de analítica de uso, podría dar una señal real
   antes de construir para un problema que quizás no es tan común como
   parece desde afuera.
