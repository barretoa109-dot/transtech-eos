# n8n → EOS Worker Gate: cutover seguro

Estado: el backend RC ya dispone de autorización, command binding y ejecución idempotente para efectos internos. El workflow live de n8n/Railway todavía no fue modificado desde esta sesión.

## Hallazgos del workflow recuperado

El Conversational Gateway exportado llama a `/webhook/eos-worker`, pero `01 GW Preparar Entrada` no conserva `request_id` y `08 GW Lanzar Worker` tampoco lo envía. El Background Worker exportado tampoco exige `request_id`, vuelve a clasificar acciones y las rutas legacy de tarea, objetivo y memoria escriben directamente sin `action_command_id`.

Por eso el backend puede estar preparado y probado sin afirmar todavía que el n8n live esté gobernado de extremo a extremo.

## Backend RC disponible

- `POST /api/internal/worker-authorize/v1`: orquestador recomendado para n8n. Ejecuta Gate inicial, crea/recupera el command canónico cuando corresponde y ejecuta Gate final con el mismo payload.
- `POST /api/internal/action-effects/v1`: ejecuta únicamente efectos internos autorizados y command-bound (`CREAR_TAREA`, `GUARDAR_MEMORIA`, `CREAR_OBJETIVO`) mediante `eos_execute_internal_effect_v64(...)`.
- `POST /api/internal/worker-gate/v1`: contrato de política de bajo nivel.
- `POST /api/internal/action-commands/v1`: broker de bajo nivel sobre `eos_get_or_create_action_command_v61(...)`.

Todos los endpoints internos usan `Authorization: Bearer <EOS_WORKER_GATE_SECRET>`. La service key de Supabase permanece exclusivamente del lado servidor; n8n no debe recibirla.

## Requisitos previos al cambio live

1. Configurar el mismo `EOS_WORKER_GATE_SECRET` en Vercel y n8n/Railway.
2. No registrar el secreto en logs, historial, Supabase ni payloads persistidos.
3. Conservar `request_id` desde `/api/eos` → Gateway → Worker sin regenerarlo.
4. Construir el `payload` canónico de cada acción una sola vez y reutilizar exactamente ese JSON en todos los retries.
5. Mantener fail-closed: timeout, 4xx/5xx, JSON inválido, secreto faltante, payload distinto o command incompatible => cero efecto.
6. Desactivar el camino legacy antes de activar el camino gobernado. Nunca ejecutar ambos en paralelo.

## Secuencia recomendada para efectos internos

Para `CREAR_TAREA`, `GUARDAR_MEMORIA` y `CREAR_OBJETIVO`:

1. Worker recibe `usuario_id`, `request_id`, `accion`, `datos`, `conversacion_id`/`mensaje_id` si existen.
2. Worker construye una sola vez el `payload` canónico.
3. Worker llama `POST /api/internal/worker-authorize/v1` con el mismo secreto y payload.
4. Si HTTP no es 2xx o `execute !== true`, detener. No ejecutar ningún nodo legacy de efecto.
5. Si `execute === true`, exigir un `command_id` UUID en la respuesta.
6. Worker llama `POST /api/internal/action-effects/v1` con únicamente ese `command_id`.
7. `HTTP 2xx + ok=true` significa efecto confirmado. Un retry puede devolver `idempotent:true`; eso es éxito, no motivo para repetir por otra ruta.
8. Nunca insertar además directamente en `eos_tasks`, `eos_memory`, `eos_goals` o `eos_goal_commands` desde el camino legacy.

Esta secuencia centraliza `Gate inicial → command v61 → Gate final → efecto v64` y evita que n8n tenga que coordinar manualmente las carreras entre autorización y command binding.

## Request de autorización recomendado

```json
{
  "usuario_id": "uuid",
  "request_id": "uuid-estable",
  "accion": "CREAR_TAREA",
  "payload": {
    "mensaje": "opcional",
    "datos": {}
  },
  "conversacion_id": "uuid-opcional",
  "mensaje_id": "uuid-opcional",
  "origen": "eos-worker"
}
```

No modificar `payload` entre el primer intento y un retry. Para la misma clave `(usuario_id, request_id, accion)`, un payload/contexto incompatible debe quedar bloqueado.

## Respuesta autorizada esperada

La única señal que habilita un efecto es:

```json
{
  "ok": true,
  "decision": "allow",
  "execute": true,
  "command_id": "uuid",
  "command_idempotent": false,
  "payload_fingerprint": "sha256"
}
```

`approval`, `approval_ready` sin consumo final, `recommend`, `prepare`, `block`, error HTTP o respuesta inválida significan **cero efecto**.

## Ejecutor de efectos internos

Request:

```json
{
  "command_id": "uuid"
}
```

Respuesta típica:

```json
{
  "ok": true,
  "command_id": "uuid",
  "accion": "CREAR_TAREA",
  "effect_type": "task",
  "effect_id": "uuid",
  "idempotent": false,
  "estado": "completada"
}
```

En producción se verificó transaccionalmente que tarea, memoria y objetivo crean un solo efecto por `action_command_id`; el segundo intento devuelve el mismo efecto con `idempotent:true`. Una orden sin evento de autorización válido falla cerrada.

## Binding durable

- `eos_tasks.action_command_id`: único para efectos command-bound.
- `eos_memory.action_command_id`: índice único parcial.
- `eos_goal_commands.action_command_id`: índice único parcial; el trigger canónico materializa el objetivo.
- `eos_action_commands`: unicidad por `(usuario_id, request_id, accion)`.

Estos vínculos son la barrera durable contra doble ejecución por retry.

## Cambios exactos en Conversational Gateway

### `01 GW Preparar Entrada`

- exigir `body.request_id` UUID válido;
- devolverlo sin modificar;
- no generar un request nuevo si ya llegó desde `/api/eos`.

### `05 GW Preparar Respuesta`

- conservar `request_id` junto con el objeto base;
- conservar `acciones` estructuradas.

### `08 GW Lanzar Worker`

Enviar `request_id` al Worker y reutilizarlo en cualquier retry. No reemplazarlo por execution ID, job ID ni timestamp.

## Cambios exactos en Background Worker

### Entrada

- exigir `request_id` UUID;
- conservar la acción estructurada recibida del Gateway;
- no volver a clasificar una acción válida;
- si hay múltiples acciones, comparten el request principal pero mantienen `accion` distinta, por lo que la clave canónica sigue siendo `(usuario_id, request_id, accion)`.

### Rutas internas con efecto

Reemplazar los nodos directos de tarea/memoria/objetivo por:

`HTTP worker-authorize → comprobar execute=true → HTTP action-effects`.

No dejar conectados los nodos Supabase legacy como segunda salida.

### Generación de archivos

`GENERAR_EXCEL`, `GENERAR_PDF` y `GENERAR_WORD` también deben pasar por autorización y command binding antes del efecto real. Sin embargo, `action-effects/v1` v64 **no ejecuta archivos**. Para estas acciones el cutover live debe conservar el generador existente detrás de una barrera de idempotencia externa/durable ligada al mismo `command_id`; no deben considerarse PASS hasta demostrar que dos requests idénticos producen un solo archivo/efecto.

## Pruebas de corte obligatorias

- secreto incorrecto => `401`, cero efecto;
- secreto faltante/no configurado => cero efecto;
- `request_id` ausente/inválido => cero efecto;
- payload A autorizado y payload B reintentado => bloqueado;
- command de otro usuario/request/acción => bloqueado;
- acción válida auto-autorizada => un solo efecto;
- misma acción enviada dos veces => mismo command y un solo efecto;
- aprobación pendiente => cero efecto;
- aprobación aceptada => consumo atómico y un solo efecto;
- segundo consumo => no duplica;
- contexto stale cuando la regla exige frescura => bloqueado;
- timeout de Gate/orquestador => cero efecto;
- Worker/n8n caído => retry con mismo request/payload, sin duplicado;
- `action_command_id` queda ligado al efecto durable;
- archivos: dos requests iguales => un solo artefacto real.

## Rollback

Antes del cutover guardar export de Gateway y Worker activos. Si falla cualquier smoke:

1. desactivar el workflow nuevo o restaurar el export anterior;
2. no reactivar simultáneamente el nuevo y el legacy;
3. conservar las migraciones de hardening: agregan guards y no obligan a n8n a ejecutar el nuevo camino;
4. revisar `eos_action_commands`, approvals y eventos antes de reintentar una acción pendiente;
5. no borrar efectos ni commands para “limpiar” un retry sin auditar primero el estado real.

## Activación

El corte live se hace sustituyendo el camino legacy completo. Primero Gateway conserva `request_id`; luego Worker usa exclusivamente el orquestador y el ejecutor command-bound. Solo después de los smokes de autorización, retry, timeout, caída de Worker y doble envío puede marcarse Worker Gate como PASS.
