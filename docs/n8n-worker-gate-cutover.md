# n8n → EOS Worker Gate: cutover seguro

Estado: listo para implementación controlada. Este documento describe el cambio requerido en los workflows activos antes de considerar que las acciones reales de EOS están gobernadas de extremo a extremo.

## Hallazgos del workflow activo recuperado

El Conversational Gateway actual llama a `/webhook/eos-worker`, pero al normalizar la entrada no conserva `request_id`. El Background Worker actual vuelve a clasificar una sola acción, usa rutas legacy y escribe directamente en `eos_tasks`, `eos_goals` y `eos_memory` sin presentar primero la intención al Worker Gate.

Por eso, aunque el contrato `/api/internal/worker-gate/v1` y el binding de payload están listos del lado plataforma, todavía no debe afirmarse que n8n esté gobernado por el Gate.

## Requisitos previos al cambio en producción

1. Configurar `EOS_WORKER_GATE_SECRET` en el deployment de la app y en el Worker n8n usando el mismo valor secreto.
2. No exponer el secreto al navegador, historial, logs ni Supabase.
3. Conservar `request_id` desde `/api/eos` → Gateway → Worker. Para la misma intención/reintento debe mantenerse estable.
4. Construir el payload de la acción una sola vez. Ese mismo JSON exacto se usa para Gate, command y efecto real.
5. Mantener fail-closed: timeout, 4xx/5xx, JSON inválido, secreto faltante o cualquier discrepancia => no ejecutar.

## Secuencia obligatoria por acción con efecto

1. El Worker recibe `usuario_id`, `request_id`, `accion` y prepara `payload`.
2. Llama `POST /api/internal/worker-gate/v1` sin `command_id`.
3. `recommend`, `prepare`, `approval` o `block` nunca producen el efecto.
4. `allow + requires_command:true`: crear/recuperar `eos_action_commands` con el payload exacto y volver al Gate con `command_id`.
5. `approval_ready`: crear/recuperar el command con el payload aprobado y volver al Gate con `approval_id + command_id + consume_approval:true`.
6. Solo `HTTP 2xx + decision=allow + execute=true` habilita el nodo de efecto secundario.
7. El efecto durable debe guardar `action_command_id` cuando corresponda.
8. Registrar evento terminal `completada`, `error`, `no_disponible` o `cancelada` en `eos_action_events`.

## Binding durable v60

Producción incorpora v60 para cerrar idempotencia en los efectos que todavía no tenían vínculo durable:

- `eos_memory.action_command_id` con índice único parcial.
- `eos_goal_commands.action_command_id` con índice único parcial.
- `eos_tasks.action_command_id` ya existía desde Fase 4.
- usuarios autenticados no pueden forjar `action_command_id` en memorias.

Esto permite que reintentos del Worker no creen la misma tarea, memoria u objetivo dos veces cuando todos los nodos usan el command canónico.

## Cambios mínimos en Conversational Gateway

- Conservar `request_id` válido recibido desde la app.
- Pasarlo sin modificación a `08 GW Lanzar Worker`.
- No generar un nuevo request id entre Gateway y Worker.
- Mantener respuesta rápida separada de la ejecución secundaria.

## Cambios mínimos en Background Worker

- `01 WK Preparar Entrada`: exigir/conservar `request_id` y `acciones` entregadas por Gateway.
- Evitar volver a inventar una intención incompatible con la que ya produjo el Gateway.
- Antes de `GENERAR_EXCEL`, `GENERAR_PDF`, `GENERAR_WORD`, `CREAR_TAREA`, `CREAR_OBJETIVO` o `GUARDAR_MEMORIA`, pasar por Worker Gate.
- Lecturas (`RESPONDER`, `VER_DASHBOARD`, `VER_BRIEFING`) no deben generar efectos durables.
- Para tareas, insertar `action_command_id` en `eos_tasks`.
- Para memoria, insertar `action_command_id` en `eos_memory`.
- Para objetivos, preferir `eos_goal_commands` y asociar `action_command_id`; no escribir un objetivo duplicado por reintento.

## Pruebas de corte obligatorias

- secreto incorrecto => 401 y ningún efecto.
- secreto ausente => 503 y ningún efecto.
- payload A evaluado y payload B ejecutado => bloqueado.
- command de otro request/acción/usuario => bloqueado.
- autoejecución válida => un solo efecto y evento terminal.
- reintento idéntico => cero duplicados.
- aprobación pendiente => cero efectos.
- aprobación aceptada => un solo consumo y un solo efecto.
- segundo consumo de aprobación => bloqueado.
- timeout del Gate => cero efectos.
- `action_command_id` queda ligado a tarea/memoria/comando de objetivo creado.

## Activación

No conectar nodos de efecto real al nuevo camino hasta que todas las pruebas anteriores estén verdes en una copia controlada del workflow. El cutover debe hacerse reemplazando el camino legacy completo, no agregando una ruta paralela que pueda ejecutar el mismo efecto dos veces.
