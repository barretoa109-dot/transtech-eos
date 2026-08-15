# n8n → EOS Worker Gate: cutover seguro

Estado: backend listo para implementación controlada; el workflow live todavía no fue modificado desde esta sesión.

## Hallazgos del workflow recuperado

El Conversational Gateway exportado llama a `/webhook/eos-worker`, pero `01 GW Preparar Entrada` no conserva `request_id`. `08 GW Lanzar Worker` tampoco lo envía. El Background Worker exportado recibe acciones, pero `01 WK Preparar Entrada` tampoco exige `request_id`; además vuelve a clasificar una acción y las rutas de tarea, objetivo y memoria escriben directamente en `eos_tasks`, `eos_goals` y `eos_memory`.

Por eso, aunque el contrato del Worker Gate está listo del lado plataforma, todavía no debe afirmarse que el n8n live esté gobernado de extremo a extremo.

## Backend disponible

- `POST /api/internal/worker-gate/v1`: evalúa política, payload, contexto fresco, aprobación y `command_id`.
- `POST /api/internal/action-commands/v1`: broker interno v62 que usa el RPC atómico `eos_get_or_create_action_command_v61(...)`.
- Ambos endpoints usan el mismo `EOS_WORKER_GATE_SECRET` mediante `Authorization: Bearer <secret>`.
- El broker devuelve el mismo `command_id` ante un replay idéntico y responde `409` ante payload/contexto incompatible.

El endpoint del broker no expone `service_role` a n8n. La service key permanece solo en el servidor Next.js.

## Requisitos previos al cambio live

1. Configurar el mismo `EOS_WORKER_GATE_SECRET` en Vercel y en n8n/Railway.
2. No registrar el secreto en logs, historial, Supabase ni respuestas del workflow.
3. Conservar `request_id` desde `/api/eos` → Gateway → Worker sin regenerarlo.
4. Construir el payload de cada acción una sola vez. El JSON exacto debe ser el mismo para Gate, command y efecto real.
5. Mantener fail-closed: timeout, 4xx/5xx, JSON inválido, secreto faltante o discrepancia => cero efecto.
6. No mantener el camino legacy y el camino gobernado activos en paralelo.

## Secuencia obligatoria por acción con efecto

1. Worker recibe `usuario_id`, `request_id`, `accion`, `datos` y contexto.
2. Worker construye `payload` canónico una sola vez.
3. `POST /api/internal/worker-gate/v1` sin `command_id`.
4. `recommend`, `prepare`, `approval` o `block` => detener; ningún efecto.
5. `allow + requires_command:true` => `POST /api/internal/action-commands/v1` con el mismo payload.
6. El broker devuelve `command_id`.
7. Volver a llamar al Gate con ese `command_id` y el mismo payload.
8. `approval_ready` => asegurar el command y llamar al Gate con `approval_id + command_id + consume_approval:true`.
9. Solo `HTTP 2xx + decision=allow + execute=true` habilita el nodo de efecto secundario.
10. El efecto durable debe guardar `action_command_id`.
11. Registrar evento terminal `completada`, `error`, `no_disponible` o `cancelada`.

## Contrato del broker v62

Request:

```json
{
  "usuario_id": "uuid",
  "request_id": "uuid",
  "accion": "CREAR_TAREA",
  "payload": {},
  "conversacion_id": "uuid-opcional",
  "mensaje_id": "uuid-opcional",
  "origen": "eos-worker"
}
```

Respuesta nueva:

```json
{
  "ok": true,
  "command_id": "uuid",
  "estado": "recibida",
  "idempotent": false,
  "resultado": {},
  "payload_fingerprint": "sha256"
}
```

Replay idéntico devuelve el mismo `command_id` con `idempotent:true`. Payload o contexto distinto para la misma clave canónica devuelve `409`.

## Binding durable v60

- `eos_memory.action_command_id` con índice único parcial.
- `eos_goal_commands.action_command_id` con índice único parcial.
- `eos_tasks.action_command_id` ya existe desde Fase 4.
- usuarios autenticados no pueden forjar `action_command_id` en memoria.

Estos vínculos son los que impiden duplicar el efecto durable ante retry cuando el Worker usa el command canónico.

## Cambios exactos en Conversational Gateway

### `01 GW Preparar Entrada`

- exigir `body.request_id` como UUID válido;
- devolver `request_id` sin modificarlo;
- no generar IDs nuevos.

### `05 GW Preparar Respuesta`

- conservar `request_id` por el spread del objeto base;
- conservar el arreglo `acciones` producido por Gateway.

### `08 GW Lanzar Worker`

Añadir al body:

```js
request_id: $('05 GW Preparar Respuesta').first().json.request_id,
```

No cambiarlo al reintentar el HTTP Request.

## Cambios exactos en Background Worker

### `01 WK Preparar Entrada`

- exigir `request_id` UUID;
- conservar las acciones recibidas del Gateway;
- no inventar un `job_id` que sustituya `request_id`;
- para múltiples acciones, cada una conserva el mismo request principal y su `accion` distinta; la restricción canónica es `(usuario_id, request_id, accion)`.

### Clasificación

El Gateway ya entregó la intención estructurada. El Worker no debe degradarla volviendo a inferir una acción incompatible a partir del texto. La clasificación legacy puede quedar disponible solo como fallback controlado para mensajes antiguos sin `acciones`, nunca para sobreescribir una acción válida del Gateway.

### Rutas con efecto

Antes de `GENERAR_EXCEL`, `GENERAR_PDF`, `GENERAR_WORD`, `CREAR_TAREA`, `CREAR_OBJETIVO` o `GUARDAR_MEMORIA`:

- Gate inicial;
- broker de command;
- Gate final;
- solo después efecto real.

Lecturas `RESPONDER`, `VER_DASHBOARD` y `VER_BRIEFING` no crean efecto durable.

### Persistencia

- tarea: insertar `action_command_id` en `eos_tasks`;
- memoria: insertar `action_command_id` en `eos_memory`;
- objetivo: usar `eos_goal_commands` con `action_command_id` y dejar que el contrato canónico materialice/actualice el objetivo; no insertar directamente un duplicado en `eos_goals` por retry.

## Pruebas de corte obligatorias

- secreto incorrecto => `401`, cero efecto;
- secreto ausente => `503`, cero efecto;
- `request_id` ausente/inválido => cero efecto;
- payload A evaluado y payload B ejecutado => bloqueado;
- command de otro request/acción/usuario => bloqueado;
- autoejecución válida => un solo efecto;
- misma acción enviada dos veces => mismo `command_id`, un solo efecto externo;
- aprobación pendiente => cero efecto;
- aprobación aceptada => un solo consumo y un solo efecto;
- segundo consumo => bloqueado;
- contexto stale cuando la regla exige frescura => bloqueado;
- timeout Gate/broker => cero efecto;
- Worker/n8n caído => retry seguro, sin duplicado;
- `action_command_id` queda ligado al efecto durable creado.

## Rollback

Antes del cutover guardar export de Gateway y Worker activos. Si falla cualquier smoke:

1. desactivar el workflow nuevo o restaurar el export anterior;
2. no reactivar en paralelo el camino nuevo y el legacy;
3. mantener las migraciones v50–v61: son compatibles con el rollback y añaden guards, no obligan a n8n a usarlos;
4. revisar `eos_action_commands`/eventos para decidir manualmente si una acción quedó pendiente antes de reintentar.

## Activación

No conectar nodos de efecto real al nuevo camino hasta que las pruebas anteriores estén verdes en una copia controlada del workflow. El cutover se hace reemplazando el camino legacy completo, no agregando otra ruta que pueda ejecutar el mismo efecto dos veces.
