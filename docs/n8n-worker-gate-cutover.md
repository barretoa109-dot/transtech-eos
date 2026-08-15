# n8n → EOS Worker Gate: cutover seguro

Estado: backend RC preparado y probado para autorización, command binding, efectos internos idempotentes y fencing de efectos externos. El workflow live de n8n/Railway todavía no fue modificado desde esta sesión.

## Brecha del workflow recuperado

Los exports recuperados pierden `request_id` entre Gateway y Worker, vuelven a clasificar acciones y ejecutan rutas legacy directas de tarea, objetivo y memoria. Por eso no debe afirmarse todavía que el n8n live esté gobernado E2E.

## Endpoints internos disponibles

Todos requieren `Authorization: Bearer <EOS_WORKER_GATE_SECRET>` y mantienen la service key de Supabase únicamente en Next.js.

- `POST /api/internal/worker-authorize/v1`: Gate inicial → command v61 → Gate final. Es la entrada recomendada para cada acción.
- `POST /api/internal/action-effects/v1`: ejecuta de forma atómica `CREAR_TAREA`, `GUARDAR_MEMORIA` y `CREAR_OBJETIVO`.
- `POST /api/internal/action-lease/v1`: `claim`/`renew` con lease y `attempt_count` para efectos externos.
- `POST /api/internal/action-results/v1`: registra el resultado terminal ligado al `attempt_count` que poseía el lease.
- `POST /api/internal/worker-gate/v1` y `/api/internal/action-commands/v1`: contratos de bajo nivel; no hacen falta en el camino n8n recomendado.

## Requisitos del cutover live

1. Configurar el mismo `EOS_WORKER_GATE_SECRET` en Vercel y n8n/Railway.
2. No guardar ni imprimir el secreto.
3. Conservar el mismo `request_id` desde `/api/eos` → Gateway → Worker y en todos los retries.
4. Construir el `payload` canónico una sola vez; un retry debe reutilizar exactamente el mismo JSON.
5. Cualquier timeout, 4xx/5xx, secreto inválido, JSON inválido, payload/contexto distinto o estado inesperado significa **cero efecto**.
6. Desactivar la ruta legacy antes de activar la gobernada. Nunca conectar dos caminos que puedan ejecutar el mismo efecto.

## Efectos internos: tarea, memoria y objetivo

Secuencia única:

`worker-authorize → execute=true + command_id → action-effects`

Si `worker-authorize` no devuelve `HTTP 2xx + execute=true + command_id UUID`, detener. Si `action-effects` devuelve un replay `idempotent:true`, tratarlo como éxito ya materializado y no ejecutar ninguna ruta adicional.

El backend ya fue probado transaccionalmente con `ROLLBACK`: tarea, memoria y objetivo conservan un único efecto por `action_command_id`; un segundo envío devuelve el mismo efecto.

## Efectos externos: Excel, PDF y Word

Estos generadores no deben usar `action-effects/v1`. Su secuencia segura es:

1. `worker-authorize` con `usuario_id`, `request_id`, `accion` y el payload canónico.
2. Exigir `execute=true` y `command_id`.
3. `action-lease/v1` con `operation:"claim"`, `command_id` y un lease apropiado.
4. Solo `claimed=true + execute_effect=true` habilita el generador real.
5. Guardar el `attempt_count` devuelto por el claim.
6. Generar el artefacto usando `command_id` como clave de idempotencia/nombre lógico cuando el generador lo permita.
7. Si la operación dura, renovar el lease usando el mismo `attempt_count`.
8. Al terminar, llamar `action-results/v1` con el mismo `command_id`, `attempt_count`, estado y resultado.
9. Un Worker stale o un resultado distinto para el mismo intento debe recibir `409`; no debe intentar forzar el cierre.

### Claim

```json
{
  "operation": "claim",
  "command_id": "uuid",
  "lease_seconds": 300
}
```

Solo esta forma habilita el efecto:

```json
{
  "ok": true,
  "claimed": true,
  "execute_effect": true,
  "command_id": "uuid",
  "attempt_count": 1
}
```

`EOS_COMMAND_IN_PROGRESS` significa que otro Worker posee el intento. `EOS_COMMAND_ALREADY_COMPLETED` significa que el efecto ya fue confirmado. En ambos casos, **no generar otro artefacto**.

### Renovación

```json
{
  "operation": "renew",
  "command_id": "uuid",
  "attempt_count": 1,
  "lease_seconds": 300
}
```

Un `attempt_count` stale se rechaza.

### Resultado terminal

```json
{
  "command_id": "uuid",
  "attempt_count": 1,
  "estado": "completada",
  "resultado": {
    "artifact_key": "command-id.pdf",
    "url": "url-o-identificador"
  }
}
```

`action-results/v1` usa el contrato v68/v69: exige autorización previa, un claim durable `claim:<attempt>`, el mismo `attempt_count` y un resultado terminal compatible. Un replay idéntico es idempotente; un replay con otro resultado o un Worker viejo se bloquea.

## Por qué existe el fencing v67–v69

Fase 4 crea automáticamente el evento `start:1` al insertar un command y lo mueve a `ejecutando` con un lease inicial. Ese lease histórico no representa propiedad real de un Worker. v67 distingue ese estado de un claim real usando eventos `claim:<attempt_count>`. v68/v69 ligan el resultado terminal al intento reclamado y rechazan cierres stale o incompatibles.

Smokes en producción con `ROLLBACK`:

- primer claim real: PASS;
- segundo claim concurrente: bloqueado como `IN_PROGRESS`;
- claim después de completar: no ejecuta;
- finalize idéntico: idempotente;
- resultado terminal alterado: bloqueado;
- `attempt_count` stale: bloqueado.

## Cambios obligatorios en Conversational Gateway

### `01 GW Preparar Entrada`

- validar y conservar `body.request_id`;
- no reemplazarlo con execution ID, timestamp ni un UUID nuevo.

### `05 GW Preparar Respuesta`

- conservar `request_id` y `acciones` estructuradas.

### `08 GW Lanzar Worker`

- enviar el mismo `request_id` al Worker;
- un retry HTTP reutiliza el mismo valor.

## Cambios obligatorios en Background Worker

- exigir `request_id` UUID;
- conservar una acción estructurada válida; no volver a inferirla desde texto;
- tarea/memoria/objetivo: sustituir nodos directos por `worker-authorize → action-effects`;
- Excel/PDF/Word: `worker-authorize → action-lease claim → generador → action-results`;
- eliminar/desconectar los inserts legacy equivalentes antes de activar el nuevo camino.

La clave canónica sigue siendo `(usuario_id, request_id, accion)`. Varias acciones de un mismo mensaje pueden compartir `request_id` porque `accion` las diferencia.

## Pruebas live obligatorias

- secreto ausente/incorrecto → cero efecto;
- request_id inválido → cero efecto;
- payload cambiado en replay → bloqueado;
- command de otro request/acción/usuario → bloqueado;
- acción rechazada/sin aprobación → cero efecto;
- aprobación válida → un consumo y un efecto;
- contexto stale cuando se exige frescura → bloqueado;
- dos Workers simultáneos → uno solo obtiene `claimed=true`;
- mismo request dos veces → un solo efecto/artefacto;
- timeout/retry → mismo command, sin duplicado;
- Worker caído → lease recuperable sin aceptar resultados stale;
- n8n caído → replay seguro;
- éxito y error terminal quedan auditados.

## Rollback

Antes del corte guardar export de Gateway y Worker activos. Ante cualquier smoke fallido:

1. desactivar el workflow nuevo o restaurar el export anterior;
2. no reactivar nuevo + legacy simultáneamente;
3. conservar las migraciones de hardening, que son compatibles con rollback del workflow;
4. revisar `eos_action_commands`, `eos_action_events` y approvals antes de reintentar;
5. no borrar commands/efectos para “limpiar” un retry sin auditar el estado real.

## Condición de PASS

Worker Gate no se marca PASS por tener backend verde. Solo se marca PASS después de modificar el workflow live, configurar el secreto, conservar `request_id`, desconectar las rutas legacy y demostrar en n8n real que dos envíos idénticos producen **exactamente un efecto**.
