# n8n → EOS Worker Gate: cutover seguro

Estado: el backend RC dispone de autorización, command binding, efectos internos idempotentes y un lifecycle con fencing token para efectos externos. El workflow live de n8n/Railway todavía no fue modificado desde esta sesión.

## Brecha del workflow recuperado

Los exports recuperados pierden `request_id` entre Gateway y Worker, vuelven a clasificar acciones y ejecutan rutas legacy directas de tarea, objetivo y memoria. Por eso no debe afirmarse todavía que el n8n live esté gobernado E2E.

## Endpoints internos canónicos

Todos requieren `Authorization: Bearer <EOS_WORKER_GATE_SECRET>`. La `SUPABASE_SERVICE_ROLE_KEY` permanece exclusivamente en Next.js.

- `POST /api/internal/worker-authorize/v1`: Gate inicial → command v61 → Gate final. Es la entrada recomendada para cada acción.
- `POST /api/internal/action-effects/v1`: ejecuta de forma atómica `CREAR_TAREA`, `GUARDAR_MEMORIA` y `CREAR_OBJETIVO`.
- `POST /api/internal/action-claims/v1`: reclama o renueva un efecto externo usando `lease_token + attempt_count`.
- `POST /api/internal/action-results/v1`: registra el resultado terminal mediante v70 y exige el mismo `lease_token + attempt_count`.
- `/api/internal/worker-gate/v1` y `/api/internal/action-commands/v1` son contratos de bajo nivel; n8n no debe necesitarlos en el camino normal.

## Requisitos del cutover live

1. Configurar el mismo `EOS_WORKER_GATE_SECRET` en Vercel y n8n/Railway.
2. No guardar ni imprimir el secreto ni los fencing tokens en logs de negocio.
3. Conservar el mismo `request_id` desde `/api/eos` → Gateway → Worker y en cada retry.
4. Construir el payload canónico una sola vez y reutilizar exactamente el mismo JSON.
5. Timeout, 4xx/5xx, secreto inválido, JSON inválido, payload/contexto distinto o estado inesperado significan **cero efecto**.
6. Desconectar el camino legacy antes de activar el gobernado. Nunca permitir dos rutas capaces de ejecutar el mismo efecto.

## Efectos internos: tarea, memoria y objetivo

Secuencia única:

`worker-authorize → execute=true + command_id → action-effects`

Si `worker-authorize` no devuelve `HTTP 2xx + execute=true + command_id UUID`, detener. Si `action-effects` devuelve `idempotent:true`, tratarlo como éxito ya materializado y no ejecutar otra ruta.

El backend se verificó transaccionalmente con `ROLLBACK`: tarea, memoria y objetivo conservan un solo efecto por `action_command_id`; un segundo envío devuelve el mismo efecto. Un command sin autorización persistida es rechazado sin crear el efecto.

## Efectos externos: lifecycle fenced

Para cualquier efecto que ocurra fuera de la transacción Postgres:

`worker-authorize → action-claims claim → efecto externo → action-results`

### 1. Claim

```json
{
  "operation": "claim",
  "command_id": "uuid",
  "lease_seconds": 300
}
```

Solo `HTTP 2xx + ok=true + claimed=true + lease_token UUID + attempt_count` entrega propiedad de ejecución. Guardar `lease_token` y `attempt_count` únicamente durante ese intento.

`EOS_COMMAND_IN_PROGRESS` significa que otro Worker posee el lease. `EOS_COMMAND_ALREADY_COMPLETED` significa que el command ya terminó. En ambos casos **no ejecutar otro efecto**.

### 2. Renew

Si el trabajo puede superar el lease:

```json
{
  "operation": "renew",
  "command_id": "uuid",
  "lease_token": "uuid-del-claim",
  "attempt_count": 1,
  "lease_seconds": 300
}
```

Un token distinto, un intento stale o un lease vencido se rechaza. Un Worker que perdió el lease no puede resucitar su intento.

### 3. Resultado terminal

```json
{
  "command_id": "uuid",
  "lease_token": "uuid-del-claim",
  "attempt_count": 1,
  "estado": "completada",
  "resultado": {
    "artifact_key": "command-id.xlsx"
  }
}
```

`action-results/v1` usa `eos_finalize_action_command_v70(...)`. Verifica autorización, fencing token, intento, claim durable y lease vigente. Un replay terminal idéntico es idempotente; un resultado distinto o un Worker stale obtiene conflicto.

### Smokes de base de datos verificados

Ejecutados contra producción dentro de transacciones con `ROLLBACK`, sin dejar efectos de prueba:

- command no autorizado → claim rechazado;
- primer claim autorizado → token + intento válidos;
- segundo claim concurrente → `IN_PROGRESS`, sin segunda propiedad;
- renew con token incorrecto → rechazado;
- renew con token correcto y lease vivo → PASS;
- finalize correcto → PASS;
- finalize idéntico → idempotente;
- mismo intento con resultado alterado → conflicto;
- renew/finalize después de lease vencido → rechazados;
- takeover tras expiración → token nuevo + attempt nuevo;
- dueño viejo después del takeover → stale/rechazado.

Los contratos canónicos son ejecutables por `service_role` y no por `authenticated`/`anon`. Los contratos legacy v64/v65/v66/v68 que podían crear rutas paralelas ya no tienen `EXECUTE` para `service_role`.

### Límite importante de exactamente-una-vez

El fencing evita que dos Workers posean simultáneamente el mismo intento, pero ningún coordinador puede garantizar por sí solo exactamente-una-vez si un proveedor externo ejecuta el efecto y el Worker cae antes de persistir el resultado. Para operaciones externas, el downstream debe aceptar `command_id` como idempotency key o producir un recurso determinista por `command_id`.

Para archivos de EOS, el generador debe usar `command_id` como clave/nombre lógico del artefacto cuando se haga el cutover. Hasta demostrar dos envíos idénticos → un solo artefacto real, Excel/PDF/Word no se marcan PASS de idempotencia externa.

## Cambios obligatorios en Conversational Gateway

### `01 GW Preparar Entrada`

- validar y conservar `body.request_id` UUID;
- no reemplazarlo con execution ID, timestamp ni otro UUID.

### `05 GW Preparar Respuesta`

- conservar `request_id` y `acciones` estructuradas.

### `08 GW Lanzar Worker`

- enviar el mismo `request_id` al Worker;
- cada retry HTTP reutiliza ese valor.

## Cambios obligatorios en Background Worker

- exigir `request_id` UUID;
- conservar una acción estructurada válida y no volver a inferirla desde texto;
- tarea/memoria/objetivo: sustituir nodos directos por `worker-authorize → action-effects`;
- efectos externos: `worker-authorize → action-claims claim/renew → generador → action-results`;
- eliminar/desconectar inserts y generadores legacy equivalentes antes de activar el nuevo camino.

La clave canónica sigue siendo `(usuario_id, request_id, accion)`. Varias acciones distintas de un mensaje pueden compartir `request_id` porque `accion` las diferencia.

## Pruebas live obligatorias

- secreto ausente/incorrecto → cero efecto;
- `request_id` inválido → cero efecto;
- payload cambiado en replay → bloqueado;
- command de otro request/acción/usuario → bloqueado;
- acción rechazada o sin aprobación → cero efecto;
- aprobación válida → un consumo y un efecto;
- contexto stale cuando se exige frescura → bloqueado;
- dos Workers simultáneos → solo uno obtiene `claimed=true`;
- mismo request dos veces → un solo efecto durable;
- token o `attempt_count` stale → bloqueado;
- lease vencido → no puede renovarse ni finalizarse por el dueño viejo;
- timeout/retry → mismo command;
- Worker/n8n caído → recuperación sin aceptar resultados stale;
- éxito/error quedan auditados;
- downstream externo idempotente → dos retries producen un solo efecto externo.

## Rollback

Antes del corte guardar export de Gateway y Worker activos. Ante cualquier smoke fallido:

1. desactivar el workflow nuevo o restaurar el export anterior;
2. no reactivar nuevo + legacy simultáneamente;
3. conservar las migraciones de hardening; son compatibles con rollback del workflow;
4. revisar commands, action events y approvals antes de reintentar;
5. no borrar commands ni efectos para “limpiar” un retry sin auditar el estado real.

## Condición de PASS

Worker Gate no se marca PASS por tener backend verde. Solo se marca PASS después de modificar el workflow live, configurar el secreto, conservar `request_id`, desconectar las rutas legacy y demostrar en n8n real que dos envíos idénticos producen un único efecto esperado.
