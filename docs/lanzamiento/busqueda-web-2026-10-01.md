# Búsqueda web en EOS — 01/10/2026

Motivo: una usuaria contó que otra herramienta le respondió mejor porque pudo
investigar tendencias y precios del mercado. EOS ahora investiga desde su propia
conversación, con fuentes, y razona con lo que la persona ya le contó.

## Decisión técnica

| | |
|---|---|
| **Elegido** | Herramienta `web_search` de la Responses API de OpenAI (la API y la clave que EOS ya usa). |
| **Verificado** | Documentación oficial (developers.openai.com, 01/10/2026): herramienta `web_search`, citas `url_citation` con posición en el texto, `user_location` por país, `search_context_size`. Sonda real: `gpt-6-sol` la soporta (la documentación nombra `gpt-5.5`, no Sol: se comprobó llamándola). |
| **Precio oficial** | US$ 10 por 1.000 llamadas + el contenido de búsqueda como tokens de entrada del modelo. |
| **Costo medido** | Entre US$ 0,02 (sin resultados) y US$ 0,08 (precios con varias páginas) por búsqueda, más una síntesis de ~US$ 0,005–0,03. |
| **Por qué no otro** | Un proveedor de búsqueda aparte (Brave, Tavily, Serper) exige otra cuenta, otra clave y otra factura, y devuelve enlaces sueltos que igual hay que leer con un modelo. Un crawler propio no tiene sentido para este caso. |
| **Límite conocido** | La búsqueda corre dentro de OpenAI: las consultas que arma su modelo salen de lo que le mandamos, por eso a esa llamada solo le llega la consulta ya limpiada. |

## Cómo funciona

```
mensaje → el modelo de siempre entiende qué quiere y qué dato actual falta
        → pide BUSCAR_WEB { consulta general, país, profundidad?, período? }
        → servidor: limpia la consulta (nombres, montos, teléfonos, CI/RUC, correos, enlaces)
                    caché pública (6 h) → límite diario por persona (10) → búsqueda aislada
        → el MISMO modelo responde con la conversación + los hallazgos (marcados como no confiables)
        → servidor: encabezado con fecha y país, [n] válidos y renumerados, sin enlaces inventados, fuentes
        → seguimiento ("¿y cuál me conviene?") sin volver a buscar: las fuentes quedan en el historial
```

- Una búsqueda por mensaje. Lo que la síntesis quiera "hacer" se tira: una
  página no puede disparar pagos, mensajes ni registros. Las acciones que pidió
  la persona en el mismo mensaje siguen su camino normal.
- Nada de internet se guarda como memoria de la persona.
- Si no se pudo buscar (timeout, error, límite, consulta vacía), se dice y se
  ofrece seguir sin datos actuales. Nunca dice "busqué" sin haber buscado.
- Web: mientras busca, el chat muestra "Estoy buscando información actual…"
  (fase real del pedido, no una suposición). WhatsApp: manda ese aviso.
- n8n (respaldo, no busca): si el modelo pide BUSCAR_WEB, responde que por ese
  camino no pudo buscar.

## Archivos

| | |
|---|---|
| `lib/busqueda/consulta.ts` | limpiar la consulta y sacar los nombres privados del contexto |
| `lib/busqueda/investigar.ts` | la llamada aislada a `web_search`, lectura de citas, costo |
| `lib/busqueda/sintesis.ts` | bloque para la síntesis, control final de citas y fuentes |
| `lib/busqueda/servicio.ts` | límite diario, caché, métricas |
| `lib/gateway/con-busqueda.ts` | la orquestación dentro del gateway |
| `lib/gateway/conversar.ts`, `lib/gateway/respuesta.ts` | conexión; `ACCIONES_DEL_GATEWAY` |
| `lib/eos/procesar-mensaje.ts` | el buscador con la base, la fase, el costo al consumo del mes |
| `app/api/eos/resultado`, `app/eos/services/eosApi.ts`, `useChat.ts`, `ChatView.tsx`, `chat/page.tsx`, `eosApp.css` | el estado "buscando" en la web |
| `app/api/whatsapp/webhook/route.ts` | el aviso por WhatsApp |
| `supabase/migrations/20260930111000_eos_busqueda_web_v229.sql` | métricas (sin la consulta: solo su hash) y caché pública, solo `service_role` |
| `n8n/parches/cambios-busqueda-web.mjs` + `2026-10-01-busqueda-web.mjs` | prompt (TS y n8n, mismo texto) y nodo 05 |

## Límites y costos configurados

| Variable (opcional) | Por defecto | Qué hace |
|---|---|---|
| `EOS_BUSQUEDAS_POR_DIA` | 10 | búsquedas reales por persona en 24 h (las de caché no cuentan) |
| `EOS_BUSQUEDA_CACHE_HORAS` | 6 | vida de una consulta pública en caché |
| `EOS_BUSQUEDA_WEB` | (prendida) | `0` la apaga |
| — | 30 s | tiempo máximo de la búsqueda |
| — | 1 | búsquedas por mensaje |

Peor caso: ~US$ 0,80 por persona por día. Entra en el consumo del mes y en el
aviso interno de Gs. 70.000; a la persona nunca se la frena por plata. No hace
falta ninguna variable nueva: usa `OPENAI_API_KEY`.

## Pruebas

**Deterministas (sin red ni modelo)** — `lib/busqueda/busqueda.test.ts` 23/23,
`lib/gateway/prompt-busqueda.test.ts` 3/3, con un fixture que es una respuesta
REAL de la API:

| # | Caso | Resultado |
|---|---|---|
| 1 | Precio de un producto en Paraguay | OK: fecha, ámbito, cada cifra con [n], fuentes |
| 2-3 | Tendencias y competidores | OK: la síntesis recibe hallazgos, fuentes, fecha y reglas |
| 4 | Sin ubicación | OK: el ámbito (Paraguay) queda dicho |
| 5 | Contradictorias o viejas | OK: se conservan los dos valores y el "dato viejo" |
| 6 | Sin resultados | OK: sin citas = sin resultados, nada inventado |
| 7 | Timeout, error, límite del proveedor y de la persona | OK: lo dice y ofrece seguir sin datos; no se llama ni se cobra pasado el límite |
| 8 | Mensaje que no necesita buscar | OK: no se busca ni cambia nada |
| 9 | Datos personales o financieros | OK: la consulta sale sin nombres, montos, teléfonos, CI ni correos; al investigador solo le llega la consulta, el país y la fecha |
| 10 | Página con instrucciones maliciosas | OK: las acciones de la síntesis se tiran; lo pedido por la persona sigue |
| 11 | Cada cifra con una fuente real | OK: [n] inexistentes y enlaces inventados se van; se renumera |
| 12 | Buscar no registra nada | OK (10) y BUSCAR_WEB nunca llega al worker |

**Base (producción, transacción revertida)** — v229: 5/5 (escribe el servidor,
códigos válidos, anon y authenticated sin acceso, RLS activa).

**Con el modelo** (`evals/qa/busqueda.ts`, ruteo de producción): **10/10**. Busca
en precio, tendencias, competidores, sin ubicación, contradicción y venta+búsqueda;
no busca en "¿cuánto vendí?", en un consejo, ni en "¿y cuál me conviene?" después
de una búsqueda. La consulta con datos privados salió como "precio bolsa
balanceado Paraguay".

**Aceptación con búsqueda real** (`evals/qa/busqueda-real.mts`, base en memoria,
contexto sintético de ferretería):

> 🔎 Busqué en la web el 01/10/2026 (Paraguay).
>
> No hay evidencia de que la bolsa de 50 kg esté a ₲40.000 «en todos lados» ni de que tu precio sea caro.
>
> Vos me dijiste que el proveedor habló de ₲40.000. Tu precio de venta es ₲58.000. En Paraguay, las referencias publicadas muestran ₲64.000 para CECON [1] y ₲64.000 promocional para Yguazú [2] en Lambaré, y ₲59.000 como precio referencial para cemento PZ [3]. Las páginas no indican fecha de publicación; las dos bolsas de ₲64.000 figuran agotadas [1][2].
>
> Mi lectura: tus ₲58.000 están por debajo de esas referencias, pero no alcanzan para confirmar el precio actual de una bolsa disponible en una ferretería de San Lorenzo. […]
>
> Fuentes: [1] construshop.com.py/25400 · [2] construshop.com.py/23460 · [3] costeo.com.py/precios/materiales/

Seguimiento "¿y qué me conviene hacer con mi precio?": no volvió a buscar, usó
lo encontrado y el costo de la persona (₲49.000). Producto inexistente: "no
encontré fuentes que respondan… con datos confiables".

**Gasto con modelos de este trabajo: ≈ US$ 0,38** (sonda 0,03; decisión 0,08;
dos aceptaciones reales 0,26). Detalle en `evals/qa/resultados/20261001*`.

## Pendiente y riesgos

- **El estado "buscando" en la web no se miró en un navegador**: compila, tipa y
  pasa el build, pero verlo requiere iniciar sesión en la app. Responsable: dueño
  (preguntar "¿a cuánto está el cemento de 50 kg en Paraguay?" y ver el aviso).
- **Fechas de publicación**: la API no las entrega como campo; salen solo si la
  página las muestra, y si no, la respuesta lo dice.
- **Calidad de las fuentes**: depende de lo que indexa el buscador; para
  precios de Paraguay aparecen tiendas online y listados (Construshop, Costeo,
  CAPACO vía Scribd). Se ve en cada respuesta qué sitio dijo qué.
- **Costo**: una búsqueda de precios con muchas páginas llegó a US$ 0,08; si
  crece el uso, bajar `EOS_BUSQUEDAS_POR_DIA` o pasar contexto a "low" fijo.

## Rollback

- Código: `git revert` del PR. Sin la acción en el prompt, el modelo no pide buscar.
- Apagado rápido, sin tocar código: `EOS_BUSQUEDA_WEB=0` en Vercel (y redeploy).
  EOS deja de buscar y, si alguien pide datos actuales, dice que no puede buscar.
- n8n: PUT del respaldo que deja el parche en `n8n/respaldos/`.
- Base: `drop table eos_busquedas_web_v229, eos_busquedas_cache_v229`.
