# La Puerta de Admisión bloqueaba pedidos legítimos (2026-09-22)

## El síntoma

Sofía mandó una foto de un pedido de Amazon por WhatsApp. Después de tres
idas y vueltas porque EOS no leía bien los nombres de producto (texto azul,
chico — una limitación real de esa imagen puntual, no un bug), un cuarto
intento devolvió el mensaje genérico de error:

> "Recibí tu mensaje, pero EOS no pudo generar una respuesta clara en este
> momento. Probá nuevamente."

Ese texto sale de una sola rama en el código
([procesar-mensaje.ts:1018-1027](../lib/eos/procesar-mensaje.ts#L1018)):
n8n respondió HTTP 200 con el **cuerpo completamente vacío**.

## La investigación

Cruzando tres fuentes —la tabla `mensajes`, la API de ejecuciones de n8n
(`GET /api/v1/executions`) y la tabla `eos_message_usage_v40`— para el
`request_id` exacto de ese mensaje:

1. La reserva de cupo se creó a las **21:23:25.619** (dentro de
   `procesarMensajeEOS`, justo antes de intentar responder).
2. La ejecución de n8n para ESE mensaje no arrancó hasta las
   **21:24:27.668** — 62 segundos después. En el medio, la etapa 1 en
   TypeScript (`conversar()`, [conversar.ts](../lib/gateway/conversar.ts))
   intentó atender el mensaje llamando a OpenAI directo, y se colgó el
   timeout completo (`TIMEOUT_MS = 60_000`) antes de delegar a n8n. La
   imagen de WhatsApp viaja sin achicar (`lib/whatsapp/media.ts` no llama a
   ningún equivalente del achicado que sí existe para la web en
   `app/eos/services/uploads.ts`), lo que es la sospecha más probable de por
   qué esa llamada fue tan lenta — no se confirmó con certeza porque OpenAI
   no expone esa razón en el log.
3. En esos 62 segundos, Sofía **ya había mandado otro mensaje** ("Lo que
   esta en azul son los nombres"), que se procesó normal y consumió SU
   propia reserva a las 21:23:54.
4. Cuando la ejecución demorada por fin llegó a n8n, el nodo
   `01.5 GW Verificar Reserva API` (Supabase `getAll`, `typeVersion: 1`,
   `limit: 1`, tres condiciones: `usuario_id`, `request_id`, `status`)
   devolvió la reserva **del otro mensaje** — la más reciente del usuario,
   ya `consumed` — en vez de la propia. Confirmado leyendo el output real
   del nodo vía `includeData=true`: la fila que trajo tenía un `request_id`
   distinto al que pedía el filtro.
5. `01.6 GW Admission Gate` recibió esa fila, vio que no tenía
   `status = 'reserved'`, y bloqueó — correctamente, dado lo que le
   llegó. n8n devolvió `{}`-vacío (ningún nodo de respuesta llegó a
   ejecutarse), y de ahí el mensaje genérico.

## La causa raíz

El nodo Supabase `getAll` en `typeVersion: 1` solo aplica la **primera**
condición del filtro (`usuario_id`); `request_id` y `status` se ignoran en
el pedido real a la API. Con `limit: 1` y orden por `reserved_at.desc`, eso
equivale en la práctica a "la reserva más reciente de este usuario", no "la
reserva de este pedido". La mayoría de las veces esas dos cosas coinciden
—por eso nunca se había notado—, pero se rompen exactamente cuando un
pedido se demora Y el usuario manda otro mensaje mientras tanto.

## El arreglo

`01.6 GW Admission Gate` ya filtraba bien, en JavaScript, por las cinco
condiciones que importan (`usuario_id`, `request_id`, `status`, vencimiento,
`source`). El problema no era esa lógica: era que el nodo de arriba le
entregaba una sola fila, no necesariamente la correcta.

Se subió `limit` de `1` a `25` en `01.5 GW Verificar Reserva API`
(`n8n/parches/2026-09-22-admision-reserva-correcta.mjs`), sin tocar el
filtro roto ni la lógica de 01.6. Con eso, 01.6 tiene varias filas
candidatas entre las que elegir la correcta, sin depender de que el
constructor de filtros del nodo Supabase v1 funcione.

**Verificado en producción** (no contra un mock): se reservó cupo para dos
`request_id` del usuario de prueba, se consumió el más nuevo primero
(reproduciendo la carrera exacta), y se llamó al webhook del gateway con el
más viejo. Antes del arreglo ese caso hubiera devuelto cuerpo vacío; con el
arreglo, el gateway respondió normal:

```
HTTP 200 en 5073 ms · 710 bytes
{"request_id":"...","respuesta":"OK",...}
```

## Lo que queda abierto

**No se tocó todavía** el porqué de los 62 segundos de demora. Es la etapa 1
del camino TypeScript (`EOS_GATEWAY_TS=1`) colgándose contra OpenAI en un
mensaje con imagen. Dos sospechas, ninguna confirmada:

- La imagen de WhatsApp viaja a resolución completa — el achicado del lado
  del cliente (`app/eos/services/uploads.ts`, `lib/eos/adjuntos.ts`) nunca
  corre para WhatsApp, porque `lib/whatsapp/media.ts` baja el archivo de la
  Graph API de Meta y lo pasa tal cual.
- El camino TypeScript en sí podría no estar manejando adjuntos de imagen
  tan bien como el camino de n8n, y tardar de más incluso con un archivo
  chico.

Mientras esto no se resuelva, cualquier mensaje con imagen puede volver a
pisar la misma demora de ~60s antes de caer a n8n — el arreglo de este
documento evita que ESA demora además bloquee el pedido, pero no evita la
demora en sí.

Relacionado: [salida-de-n8n.md](salida-de-n8n.md). Cómo se toca un workflow de
n8n sin romper producción está en la memoria `eos-n8n-gateway`.
