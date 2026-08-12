# EOS Worker Gate — contrato v1

Estado: preparado para integración final. El workflow actual de n8n todavía no llama a este contrato.

## Endpoint canónico

`POST /api/internal/worker-gate/v1`

No integrar contra `/api/internal/worker-gate` directamente. La ruta `/v1` fija el contrato y añade auditoría independiente.

## Autenticación

Header obligatorio:

`Authorization: Bearer <EOS_WORKER_GATE_SECRET>`

El secreto debe existir únicamente en variables seguras del servidor/Worker. Nunca debe enviarse al navegador, guardarse en Supabase ni escribirse en logs.

Si falta la variable, el secreto es incorrecto o el gate falla, la respuesta es fail-closed: `execute: false`.

## Request — evaluación

```json
{
  "usuario_id": "uuid",
  "request_id": "uuid",
  "accion": "CREAR_TAREA",
  "payload": {
    "titulo": "Ejemplo"
  }
}
```

Campos:

- `usuario_id`: obligatorio; propietario real de la acción.
- `request_id`: obligatorio; UUID estable para idempotencia. Debe reutilizarse en reintentos de la misma intención.
- `accion`: obligatorio; debe pertenecer al catálogo gobernado por EOS.
- `payload`: opcional; datos necesarios para ejecutar. El audit log guarda solo SHA-256 del payload, no su contenido.
- `command_id`: opcional durante evaluación; obligatorio al consumir una aprobación.
- `approval_id`: obligatorio únicamente al consumir una aprobación.
- `consume_approval`: `true` únicamente en el paso de consumo one-shot.

## Catálogo v1

- `RESPONDER`
- `GENERAR_EXCEL`
- `GENERAR_PDF`
- `GENERAR_WORD`
- `CREAR_TAREA`
- `CREAR_OBJETIVO`
- `GUARDAR_MEMORIA`
- `VER_DASHBOARD`
- `VER_BRIEFING`

Acciones fuera del catálogo se bloquean.

## Respuesta estable

Toda respuesta de `/v1` incluye:

```json
{
  "contract_version": "eos-worker-gate-contract-v1",
  "policy_version": "eos-worker-gate-v1",
  "execute": false,
  "decision": "approval"
}
```

`execute` es el único indicador que habilita el efecto secundario. Si no es exactamente `true`, el Worker NO debe ejecutar.

## Decisiones

### `recommend`

EOS puede recomendar la acción, pero no prepararla ni ejecutarla como efecto secundario.

Worker: no ejecutar.

### `prepare`

EOS puede preparar contenido/datos, pero no ejecutar el efecto secundario.

Worker: no ejecutar.

### `approval`

Existe una solicitud pendiente de aprobación.

Worker: no ejecutar. Guardar/reutilizar `approval.id` y esperar decisión del usuario.

### `approval_ready`

El usuario ya aprobó, pero la aprobación todavía no fue consumida.

Worker: crear o resolver el `command_id` correspondiente y llamar nuevamente al gate con `consume_approval: true`.

### `allow`

Solo ejecutar si `execute === true`.

Puede ocurrir por autonomía permitida o por consumo atómico exitoso de una aprobación.

### `block`

La acción está bloqueada por política, límites, estado de aprobación, error de seguridad o fallo interno.

Worker: no ejecutar.

## Consumo one-shot de aprobación

Request inmediatamente anterior al efecto secundario:

```json
{
  "usuario_id": "uuid",
  "request_id": "mismo-uuid-de-la-intencion",
  "accion": "CREAR_OBJETIVO",
  "command_id": "uuid-de-eos_action_commands",
  "approval_id": "uuid-de-la-aprobacion",
  "consume_approval": true,
  "payload": {}
}
```

El gate llama `eos_consume_action_approval_v12()` y vincula la aprobación con `eos_action_commands` de forma atómica.

Solo si responde simultáneamente:

- HTTP 2xx
- `decision: "allow"`
- `execute: true`
- `consumed: true`

el Worker puede ejecutar el efecto secundario aprobado.

La misma aprobación no puede consumirse dos veces.

## Secuencia de integración

1. El Worker determina una acción candidata, pero todavía no produce el efecto secundario.
2. Genera/reutiliza `request_id` estable.
3. Llama `/api/internal/worker-gate/v1` en modo evaluación.
4. Si `execute: true`, continúa a la ejecución idempotente existente.
5. Si `decision: approval`, no ejecuta y espera aprobación.
6. Si después recibe `approval_ready`, garantiza que existe `command_id`.
7. Llama otra vez con `consume_approval: true`.
8. Solo con `execute: true` + `consumed: true` ejecuta.
9. Registra el resultado mediante el sistema existente `eos_action_events`.
10. Cualquier timeout, 4xx, 5xx, respuesta inválida o decisión desconocida equivale a BLOCK.

## Punto exacto recomendado en n8n

Insertar el gate inmediatamente después de que el Worker ya haya clasificado la acción y preparado su payload, pero inmediatamente antes del nodo que crea el efecto secundario real.

No colocarlo en Respuesta Rápida ni en la ruta conversacional que devuelve texto al usuario. No modificar el webhook de WhatsApp para integrar esta fase.

## Idempotencia

- Reintentos de la misma intención deben conservar `request_id`.
- `eos_action_commands` conserva su idempotencia actual.
- Una aprobación usa `approval_id` único y consumo one-shot.
- El audit log permite correlacionar `request_id`, acción, `command_id`, `approval_id` y fingerprint sin guardar el payload completo.

## Auditoría

Tabla: `eos_worker_gate_audit_v15`.

Registra:

- usuario
- request
- acción
- modo `evaluate` / `consume`
- decisión
- execute
- command / approval
- fingerprint SHA-256
- contract version
- policy version
- HTTP status
- motivo/error
- timestamp

El usuario autenticado solo puede leer sus propios registros por RLS. La escritura queda reservada al servidor.

## Regla de seguridad principal

**El Worker nunca interpreta silencio, error o ausencia de respuesta como permiso.**

La única autorización válida es una respuesta explícita del gate con `execute === true`.

## Activación futura

Antes de conectar n8n:

- configurar `EOS_WORKER_GATE_SECRET` en el deployment que expone el endpoint;
- configurar el mismo secreto en las credenciales seguras del Worker;
- probar con una acción de solo lectura;
- probar un `prepare`;
- probar una aprobación pendiente;
- aprobar y consumir una vez;
- verificar que el segundo consumo sea rechazado;
- verificar que un secreto incorrecto bloquee;
- verificar que un timeout bloquee;
- verificar auditoría en Supabase;
- recién entonces activar el gate para efectos secundarios reales.
