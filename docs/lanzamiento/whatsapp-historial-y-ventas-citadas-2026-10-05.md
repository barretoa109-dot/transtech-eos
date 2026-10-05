# WhatsApp: historial perdido, ventas citadas y catálogo tocado sin pedido (05/10/2026)

Dos conversaciones reales de Sofía del 01/10/2026 (cuenta `e955c79f…`, conversación
de WhatsApp `9df8f1b0…`), 21:16 a 21:25 hora de Paraguay (02/10 00:16-00:25 UTC).

## Qué pasó

1. Citó con "Responder" el mensaje de EOS *"Costo final del zapato marrón mocha:
   ₲125.245,4…"* y escribió *"Registra la venta de esto"*. EOS: *"No tengo el
   mensaje al que respondés. ¿Qué producto vendiste y cuántas unidades?"*.
2. EOS preguntó *"Me falta el monto de venta del chaleco de encaje. ¿A cuánto lo
   cobraste?"*; ella contestó *"155.000gs"*. EOS ejecutó `ACTUALIZAR_PRODUCTO`
   sobre la **Gorra lacoste sobrepedido** (costo 155.000 + 41.241 = 196.241) y
   dijo *"La acción quedó completada"*.

## Causa raíz (comprobada)

**Capa: persistencia del webhook de WhatsApp** (`app/api/whatsapp/webhook/route.ts`).

Desde el PR #186 (29/09) el webhook guardaba el turno con un solo insert de dos
filas; solo la fila de la persona traía `metadata` (los ids de WhatsApp).
`supabase-js` arma el insert con la unión de columnas y, por defecto
(`defaultToNull: true`), pone `NULL` donde a una fila le falta una:
`mensajes.metadata` es `NOT NULL` → **error 23502, no se guarda ninguna de las
dos filas**. El error solo iba al log y la respuesta se mandaba igual.

Evidencia:

- `mensajes` con `origen = 'whatsapp'`: el último es del **29/09 18:39 UTC**, de
  cualquier cuenta. Después hubo decenas de turnos de WhatsApp (se ven en
  `eos_whatsapp_rafaga_v199` y en `eos_action_commands` con `origen whatsapp`) y
  ninguno quedó guardado.
- Reproducido contra la base con la cuenta demo: el insert con la forma del
  webhook da `23502 null value in column "metadata"`; con `metadata` en las dos
  filas, entra.
- Por eso:
  - el mensaje citado no se podía encontrar (ninguna respuesta de EOS tenía su
    id anotado) → *"no tengo el mensaje"*;
  - el modelo no veía la conversación. Lo último guardado era del 29/09 y
    terminaba en *"El envío de ₲41.241 corresponde a la Gorra lacoste; decime el
    costo base de la gorra"*. "155.000gs" se leyó como respuesta a ESA pregunta.

Lo que **no** fallaba: Meta sí manda `context.id` en las respuestas citadas, la
ráfaga lo anota (`contexto_wa_id`), la búsqueda por id filtra por cuenta, el
`request_id` es determinístico por mensaje de WhatsApp (los reintentos no
duplican) y las confirmaciones ("quedó registrada", "acción completada") salen del
resultado del ejecutor, no del modelo. La gorra **sí** se actualizó de verdad:
la frase era cierta; lo que faltaba era que alguien lo hubiera pedido.

## Qué cambia

| Capa | Archivo | Cambio |
|---|---|---|
| Persistencia | `lib/whatsapp/turno.ts`, webhook | Las dos filas del turno con las mismas columnas, `defaultToNull: false`, y si falla, fila por fila. También en el camino de aprobación por WhatsApp. |
| Contexto | `lib/eos/historial.ts`, `procesar-mensaje.ts`, webhook | Lo que no es de la sesión (más de 3 h) llega marcado `[de hace N días]`: una pregunta vieja no es la pendiente. |
| Cita no encontrada | `lib/whatsapp/cita.ts` | El aviso le pide al modelo usar la conversación antes de pedir que repita. |
| Ejecución | `lib/gateway/catalogo-pedido.ts`, `worker.ts` | `ACTUALIZAR_PRODUCTO` solo si el turno lo pide (lo que escribió la persona, sin la cita, o la última pregunta de EOS de esta sesión). Una corrección ("no es la gorra") no autoriza nada con el mensaje que corrige. Si no va, se dice: *"No cambié nada del catálogo…"*. Calibrado con los 20 `ACTUALIZAR_PRODUCTO` reales: los 19 pedidos pasan. |
| Base | `supabase/migrations/20260930113000_eos_venta_con_nota_v231.sql` | `REGISTRAR_VENTA` acepta `nota` ("sobrepedido") y va a `eos_erp_ventas.notas`. |
| Prompt (TS y n8n) | `n8n/parches/cambios-venta-citada.mjs` | `nota?` en la venta; cantidad 1 cuando el monto es el de una unidad; una respuesta corta contesta la última pregunta; una corrección manda y no arrastra datos del otro producto; vender no es cambiar el catálogo; margen bruto, no ganancia neta. |

El freno de catálogo vive en el gateway en TypeScript (`ejecutarJobs`), que es el
que atiende hoy (`eos_action_commands.origen = vercel-gateway-ts`). El camino de
n8n, de respaldo, recibe el prompt pero no el freno.

## Pruebas

- `npm test`: 2696+ pruebas, todas en verde. Nuevas: `lib/whatsapp/turno.test.ts`
  (incluye el insert viejo fallando con 23502), `lib/whatsapp/venta-citada.test.ts`
  (los dos casos de punta a punta hasta el prompt y los jobs, reintento de Meta),
  `lib/gateway/catalogo-pedido.test.ts` (el caso, la corrección y los 17 pedidos
  reales que no se pueden frenar).
- `supabase/pruebas/venta_citada_e2e.sql` contra la base, con la v231, en una
  transacción revertida: **16/16**.
- `guardarTurno` con el `supabase-js` real contra la base (cuenta demo): las dos
  filas guardadas, el id de WhatsApp anotado, la cita encontrada; filas borradas.
- Modelo (QA con tope, ruteo de producción, `--conjunto citas`): **7/7**, US$ 0,09
  (la primera corrida, 6/7, encontró la falla de la corrección que llevó a la
  regla de `CORRIGE` y al ajuste del prompt). Resultados en `evals/qa/resultados/`.

## Lo que queda

- **Ver el caso en el WhatsApp real** con una cuenta QA: citar un mensaje de EOS
  enviado DESPUÉS del deploy (los anteriores no tienen su id guardado y no se
  pueden recuperar: Meta no devuelve el texto de un mensaje por su id).
- **Datos de Sofía sin tocar** (son de una clienta real; los corrige el dueño):
  - Gorra lacoste sobrepedido: costo quedó en ₲196.241 por el error del 01/10
    (era ₲384.657; con el envío de ₲41.241 sería ₲425.898).
  - La venta de la gorra del 03/10 (`92bd2e90…`) se registró con ese costo.
  - Las ventas del zapato (`5980e2bc…`) y del chaleco (`494edf04…`) a Gladys
    Velilla existen, una sola vez cada una, sin la nota "sobrepedido".
- El historial de WhatsApp del 29/09 al deploy no se puede reconstruir: no quedó
  en ninguna tabla.
