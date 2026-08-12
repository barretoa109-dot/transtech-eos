# EOS Worker Gate — contrato HTTP v1 / política v2

Estado: preparado para integración final. El workflow actual de n8n todavía **no** llama a este contrato.

## Endpoint canónico

`POST /api/internal/worker-gate/v1`

La ruta `/v1` fija el contrato HTTP. La política interna vigente se identifica como `eos-worker-gate-v2`.

## Autenticación

Header obligatorio:

`Authorization: Bearer <EOS_WORKER_GATE_SECRET>`

El secreto vive únicamente en servidor/Worker. Nunca se envía al navegador ni se guarda en logs/Supabase.

Cualquier secreto ausente/incorrecto, timeout, error interno o respuesta inválida es fail-closed: `execute: false`.

## Principio principal

**Solo `execute === true` habilita un efecto secundario.**

No interpretar `decision: "allow"` por sí solo como permiso. En política v2 puede existir `decision: "allow"` + `execute: false` + `requires_command: true`.

## Catálogo gobernado

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

## Evaluación inicial — sin command_id

El Worker clasifica la acción y prepara el payload, pero todavía NO crea `eos_action_commands`.

```json
{
  "usuario_id": "uuid",
  "request_id": "uuid-estable",
  "accion": "CREAR_TAREA",
  "payload": {
    "titulo": "Ejemplo"
  }
}
```

Campos:

- `usuario_id`: obligatorio.
- `request_id`: obligatorio y estable para la misma intención/reintentos.
- `accion`: obligatorio y perteneciente al catálogo gobernado.
- `payload`: opcional.
- `command_id`: no enviarlo en la evaluación inicial.
- `approval_id`: solo para consumo de aprobación.
- `consume_approval`: `true` solo para consumo one-shot.

## Decisiones

### `recommend`

No ejecutar.

### `prepare`

Puede prepararse contenido/datos, pero no producirse el efecto secundario.

### `approval`

Se creó o reutilizó una aprobación pendiente. No crear todavía una orden ejecutable; esperar la decisión del usuario.

### `approval_ready`

El usuario aprobó. En este punto el Worker crea/asegura el `eos_action_commands` exacto de esa intención y vuelve al gate con `consume_approval: true`.

### `allow` + `execute: false` + `requires_command: true`

La política permite autoejecución, pero todavía falta el anclaje idempotente de Fase 4.

Worker:
1. crear o recuperar el `eos_action_commands` para el mismo `usuario_id + request_id + accion`;
2. volver a llamar al gate con ese `command_id`;
3. no ejecutar todavía.

### `allow` + `execute: true`

Única autorización válida para producir el efecto secundario.

### `block`

No ejecutar.

## Autoejecución segura

Segunda llamada inmediatamente anterior al efecto:

```json
{
  "usuario_id": "uuid",
  "request_id": "mismo-uuid",
  "accion": "CREAR_TAREA",
  "command_id": "uuid-de-eos_action_commands",
  "payload": {
    "titulo": "Ejemplo"
  }
}
```

El gate valida que `command_id` exista y coincida exactamente en:

- `usuario_id`
- `request_id`
- `accion`
- estado ejecutable (`recibida` o `ejecutando`)

Solo después registra `auto_allowed` vinculado al mismo comando. Si esa auditoría no puede persistirse, el gate devuelve `execute: false`.

## Consumo one-shot de aprobación

Después de `approval_ready`, crear/asegurar el comando y llamar:

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

`eos_consume_action_approval_v12()` verifica atómicamente que el comando coincide con la aprobación en:

- propietario
- `request_id`
- `accion`
- estado ejecutable

Solo si responde simultáneamente:

- HTTP 2xx
- `decision: "allow"`
- `execute: true`
- `consumed: true`

puede ejecutarse el efecto aprobado.

La aprobación no puede consumirse dos veces.

## Secuencia final recomendada en n8n

1. Clasificar intención y preparar payload.
2. Generar/reutilizar `request_id` estable.
3. Llamar al gate **sin `command_id`**.
4. Si `recommend`, `prepare`, `approval` o `block`: no ejecutar.
5. Si `allow + requires_command:true`: crear/recuperar `eos_action_commands` y llamar nuevamente con `command_id`.
6. Si `approval_ready`: crear/recuperar `eos_action_commands` y llamar con `approval_id + command_id + consume_approval:true`.
7. Solo `execute:true` permite pasar al nodo de efecto secundario.
8. Registrar resultado con `eos_action_events` como en Fase 4.
9. Timeout, 4xx, 5xx, JSON inválido o ausencia de respuesta = BLOCK.

## Por qué no crear el comando antes de una aprobación

Fase 4 inicia automáticamente el comando y crea un lease al insertarlo. Crear el comando antes de que el usuario apruebe provocaría órdenes `ejecutando` que pueden vencer mientras la aprobación sigue pendiente. Por eso el command se crea únicamente cuando la política ya está lista para ejecutar.

## Idempotencia

- La misma intención conserva `request_id`.
- `eos_action_commands` mantiene unicidad por `usuario_id + request_id + accion`.
- Una autorización automática ejecutable queda vinculada al `command_id` exacto.
- Una aprobación se consume una sola vez y queda ligada al comando exacto.
- Reintentos con otro command no heredan autorización automáticamente.

## Auditoría

La tabla `eos_worker_gate_audit_v15` se alimenta desde eventos reales de `eos_autonomy_events_v12`.

La política v2 persiste `policy_version: eos-worker-gate-v2` en eventos nuevos. La auditoría no almacena secretos ni payloads completos.

## Activación futura

Antes de conectar n8n:

- configurar `EOS_WORKER_GATE_SECRET` en el deployment del endpoint;
- configurar el mismo secreto en credenciales seguras del Worker;
- probar una acción `recommend`;
- probar `prepare`;
- probar autoejecución: evaluación sin command -> `requires_command` -> segunda llamada con command -> `execute:true`;
- probar aprobación pendiente;
- aprobar y consumir una vez;
- comprobar que command con request/acción diferente sea rechazado;
- comprobar que segundo consumo sea rechazado;
- comprobar que secreto incorrecto y timeout bloqueen;
- verificar auditoría en Supabase;
- recién entonces conectar efectos secundarios reales.

## Frontera

Este contrato está listo del lado plataforma. **n8n y WhatsApp siguen sin modificar** y no se considera activa la autonomía sobre efectos reales hasta completar esa conexión final.