# Sacar el agente de n8n

> Fase 5 de la hoja de ruta: *"Migrar el loop del agente de n8n a TypeScript en
> Vercel (n8n queda para integraciones/ETL, no como runtime crítico)."*

Este documento existe porque la migración **no es una función más**: es el
camino crítico del producto. Todo lo que sigue está medido sobre los backups
del repo, no estimado.

## Qué hay que mover, exactamente

Dos workflows, no uno:

| Workflow | Nodos | Rol |
|---|---|---|
| `eos-4-0-conversational-gateway-worker-gate-rc1` | 13 | El loop del agente |
| `eos-4-0-background-worker-worker-gate-rc1` | — | Ejecuta las acciones aprobadas |

El gateway son **7 nodos de código con ~33 KB de JavaScript**, una llamada a
`https://api.openai.com/v1/responses` y una llamada al worker.

| Nodo | Tamaño | Qué hace |
|---|---|---|
| `01 GW Preparar Entrada` | 2,8 KB | Normaliza el mensaje y el historial |
| `01.5 / 01.6 Admission Gate` | 1,4 KB | Verifica la reserva de cuota |
| `03 GW Construir Prompt Rápido` | 1,8 KB | Arma el prompt del sistema |
| `HTTP Request` | 2,3 KB | La llamada a OpenAI |
| `05 GW Preparar Respuesta` | 6,0 KB | Normaliza lo que devuelve el modelo |
| `06 GW Preparar Jobs Worker` | **11,2 KB** | Decide las acciones. La pieza pesada |
| `06.5 / 06.6 Conversación pura` | 1,0 KB | Bifurca cuando no hay acciones |
| `08 GW Agregar Resultados` | 6,1 KB | Junta lo del worker con la respuesta |

## La buena noticia: la costura es una sola

`app/api/eos/route.ts` ya hace en TypeScript **todo lo que rodea a n8n** — auth,
reserva de cuota, armado del payload, normalización de la respuesta, finalize.
n8n entra por un único `fetch` ([route.ts:646](../app/api/eos/route.ts)).

Eso significa que la migración se puede hacer por adentro de esa línea, sin
tocar el cliente, sin cambiar contratos y con vuelta atrás inmediata.

## Plan por etapas

### Etapa 1 — La conversación pura, con red · **construida, apagada**

> **Estado (2026-09-03).** El código está escrito, con 74 tests, y **la bandera
> está apagada**. Vive en `lib/gateway/`:
>
> | Archivo | Qué porta |
> |---|---|
> | `sistema.ts` | El prompt del sistema, extraído del backup con un script y **verificado byte a byte** contra n8n |
> | `entrada.ts` | Nodo `01 GW Preparar Entrada` |
> | `prompt.ts` | Nodo `03 GW Construir Prompt Rápido` |
> | `respuesta.ts` | Nodo `05 GW Preparar Respuesta` |
> | `conversar.ts` | La orquestación, la llamada a OpenAI y la caída a n8n |
>
> La costura son 12 líneas en `app/api/eos/route.ts`, justo antes del `fetch` a
> n8n. `conversar` devuelve `null` ante cualquier problema y `delegar` cuando el
> modelo pide acciones —el nodo 06 sigue en n8n— y en los dos casos la ruta
> sigue de largo por el camino de siempre.
>
> **Para prenderlo hacen falta dos variables en Vercel**, y ninguna de las dos
> la puede cargar quien escribió esto:
>
> - `OPENAI_API_KEY` — la clave de OpenAI. Hoy solo la tiene n8n.
> - `EOS_GATEWAY_TS=1` — la bandera.
>
> Con la clave y sin la bandera, no cambia nada. Con las dos, la conversación
> pura pasa a atenderse en Vercel y `metadata.gateway` dice `"ts"` en cada
> respuesta que salió por ahí, que es como se comparan los dos caminos sobre
> tráfico real antes de sacar la bandera.
>
> **El costo que esto tiene:** cuando el modelo pide una acción, la llamada a
> OpenAI que hizo Vercel se tira y n8n vuelve a llamar. Ese mensaje sale el
> doble. Se acepta a sabiendas —es la minoría del tráfico— y desaparece cuando
> la etapa 2 mueva el nodo 06.


**Qué se porta:** `01 → 03 → OpenAI → 05 → 06.5 → 06.6`. Unos 11 KB de
JavaScript determinístico (strings y JSON), sin efectos durables.

**Por qué es segura:** el frente 1 (2026-08-20) demostró que la rama de
conversación pura **no tiene ningún efecto durable** — el job `RESPONDER` que
fabricaba el gateway solo pegaba un ping y devolvía `executed:false`. Si la
implementación en TypeScript falla, se cae a n8n y no se perdió nada.

**Cómo:** bandera `EOS_GATEWAY_TS=1`; si el modelo pide acciones o algo lanza,
se delega a n8n como hoy. Se compara la salida de los dos caminos sobre
mensajes reales antes de sacar la bandera.

**Qué destraba:** es la mayoría del tráfico, y a 2,4–4 s ya es el camino
rápido. El beneficio no es latencia sino dejar de depender de Railway para lo
que más se usa.

### Etapa 2 — La decisión de acciones

`06 GW Preparar Jobs Worker`, 11 KB. Es la pieza que traduce lo que pide el
modelo a jobs para el Worker Gate. Acá sí hay efectos durables, así que
necesita la suite de evals apuntando al gateway: consultas reales con la ACCIÓN
esperada (no la prosa), corridas contra los dos caminos hasta que coincidan.

### Etapa 3 — El Background Worker

El último y el más delicado: es el que ejecuta. Tiene fencing, leases e
idempotencia ya probados en producción ([eos_rc1_status]). No tocar hasta que
1 y 2 estén estables por semanas.

## Requisitos previos que NO son código

1. **`OPENAI_API_KEY` en Vercel.** Hoy la credencial vive en n8n. Sin esto la
   etapa 1 no arranca. **Verificar antes de empezar.**
2. **Una ventana con alguien mirando producción.** Es el camino crítico: la
   etapa 1 se saca en un momento en que se pueda revertir en minutos.
3. **`N8N_EOS_WEBHOOK_URL` en Vercel.** Hoy no está y la URL de producción está
   hardcodeada como fallback en `app/api/eos/route.ts:19-21`. Mientras siga
   así, volver atrás exige un deploy en vez de cambiar una variable — que es
   justo lo que no querés en una migración.

## Lo que este documento no recomienda

**Hacer las tres etapas de una.** El gateway atiende cada mensaje de cada
usuario. Un corte parcial se revierte con una bandera; un corte total se
revierte con un rollback y con usuarios afectados en el medio.

**Empezar por el Worker porque "es el más prolijo".** Es el que ejecuta
acciones aprobadas. Si algo se rompe ahí, se rompe después de que el usuario
autorizó — el peor momento posible para fallar.
