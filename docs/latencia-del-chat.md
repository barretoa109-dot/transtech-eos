# Los 19 segundos del chat, medidos

Fecha de la medición: **7 de septiembre de 2026**, sobre ejecuciones reales de
producción (nueve del gateway, siete del worker), no sobre pruebas armadas.

Este documento existe porque la respuesta intuitiva —"es el modelo, que piensa
mucho"— **es falsa**, y porque yo mismo la di antes de medir bien.

---

## El número

| | |
|---|---|
| Mediana de un mensaje con acción | **19,0 s** |
| p90 | 26,6 s |
| Mínimo observado | 14,4 s |

---

## Dónde se van

Medianas por tramo. La suma da 18,4 s: el resto son décimas repartidas en los
nodos de código, que tardan entre 0 y 40 ms cada uno.

| Tramo | Mediana | Qué es |
|---|---|---|
| Arranque del gateway | **3,3 s** | Desde que n8n crea la ejecución hasta que corre el primer nodo |
| `01.5 GW Verificar Reserva API` | 1,2 s | Releer de Supabase la reserva de cupo que la app acaba de crear |
| `HTTP Request` (OpenAI) | **6,8 s** | La llamada al modelo |
| `07 GW Ejecutar Worker Gobernado` | **7,1 s** | Esperar al worker, que corre en otra ejecución de n8n |
| ↳ salto HTTP gateway → worker | ~3,0 s | La diferencia entre lo que espera el gateway y lo que tarda el worker |
| ↳ arranque del worker | ~2,4 s | El mismo costo de arranque, pagado por segunda vez |
| ↳ trabajo real del worker | ~1,7 s | Autorizar en la puerta y ejecutar el efecto |

### Lo que esto significa

**n8n cuesta ~8,7 s de los 19: el 46 %.** Son 3,3 + 3,0 + 2,4, y ninguno de los
tres hace nada útil — es arranque de ejecución y salto de red entre dos
workflows que viven en la misma máquina.

**OpenAI cuesta ~6,8 s: el 36 %.** Con dos observaciones (117 tokens de salida →
4,2 s; 711 tokens → 11,2 s) la recta es **~3,5 s fijos + ~12 ms por token de
salida**. O sea: la mitad del tiempo del modelo es la longitud de la respuesta.

**La puerta de admisión cuesta 1,2 s** y se deja a propósito: es lo que impide
que cualquiera le pegue al webhook y gaste una llamada al modelo.

---

## La corrección

En una medición anterior conté los huecos **entre** nodos y me dieron entre 1 y
4 ms, y de ahí concluí —y se lo dije al usuario— que n8n aportaba
milisegundos y que la latencia era toda del modelo.

Estaba mal. El hueco que importa es el que hay **antes del primer nodo**, que
esa medición no miraba: 3,3 s en el gateway y 2,4 s en el worker. Es la mitad
del problema, y por mirar el lugar equivocado quedó invisible.

Que el arranque sea caro en los dos workflows, con payloads de tamaños muy
distintos, apunta a la instancia y no al contenido. Consistente con eso:
`GET /healthz` en esa instancia tarda ~0,55 s de punta a punta con 0,15 s de
conexión, o sea **~0,4 s de servidor para un endpoint que no hace nada**.

---

## Qué lo arreglaría, en orden de tamaño

### 1. Sacar el loop de n8n (−8,7 s aprox.)

Es la etapa 1 de `docs/salida-de-n8n.md`, y ataca los tres tramos de arranque y
salto de una vez: la app llama al modelo, ejecuta el efecto con sus propias
rutas internas —que ya existen y están testeadas— y no hay ninguna ejecución de
n8n de por medio.

**Necesita `OPENAI_API_KEY` en Vercel**, que es lo que el usuario dejó para el
final. No hay atajo: es la misma llave la que habilita esto y la que habilita
la respuesta en streaming.

### 2. Respuestas más cortas (−2 a −4 s)

A 12 ms por token, una respuesta de 700 tokens cuesta 8,4 s de reloj y una de
250 cuesta 3. Las respuestas largas de EOS no son mejores: repiten la cuenta
en prosa y después otra vez adentro de la acción.

Es lo más barato que queda y no necesita nada de nadie. **No está hecho.**

### 3. La instancia de n8n (−2 a −5 s, sin tocar código)

Si el arranque de 3 s es CPU, un contenedor más grande en Railway lo baja sin
cambiar una línea. Vale la pena mirar también `EXECUTIONS_DATA_SAVE_ON_SUCCESS`:
hoy cada ejecución guarda todo su payload en Postgres, y eso incluye imágenes
en base64.

**Necesita acceso a Railway**, que no está en este repositorio.

### 4. Fusionar el worker en el gateway (−5,4 s)

Elimina el salto HTTP y el segundo arranque. Es real, pero implica portar la
lista blanca, la autorización y el armado de frases a otro nodo de JavaScript
no testeado — sobre el camino que acaba de estabilizarse. La opción 1 hace lo
mismo y además deja el código en TypeScript con pruebas, así que esto solo
tiene sentido si la 1 se descarta.

---

## Lo que se probó y no sirvió

**`prompt_cache_key`.** El prompt del sistema son ~1.500 tokens sin una sola
interpolación, idénticos para todos, y el caché de OpenAI arranca a los 1.024;
aun así `cached_tokens` venía 0 en las nueve ejecuciones. Se agregó la clave y
se volvió a medir con tres mensajes seguidos: 0, 0 y 0. La API acepta el campo,
así que está soportado y el caché igual no pega. Se deja puesto porque no
cuesta nada, pero **no cuenta como latencia ganada**. Ver
`n8n/parches/2026-09-07-cache-del-prompt.mjs`.
