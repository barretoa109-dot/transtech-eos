# n8n Worker Gate — candidatos RC1

Estado: diseño y exports candidatos preparados fuera del workflow live. **No activar todavía sobre producción** hasta completar el smoke controlado y el swap sin solapamiento con los workflows legacy.

## Objetivo

Cerrar el corte `Gateway -> Worker` sin doble ejecución, conservando un `request_id` estable y haciendo que cada efecto durable quede ligado al `action_command_id` canónico del backend RC1.

## Conversational Gateway RC1

El candidato:

- exige `request_id` UUID y nunca lo regenera;
- conserva las acciones estructuradas producidas por el Gateway;
- no vuelve a guardar mensajes en Supabase: la Web ya persiste usuario/respuesta con `request_id`;
- no usa IF/Switch;
- emite un job por acción; varias acciones del mismo turno comparten `request_id` y se distinguen por `accion`;
- los retries del HTTP Worker reutilizan exactamente `request_id + accion + datos`;
- agrega los resultados de todos los jobs antes de responder a `/api/eos`.

### Admission Gate

Antes de OpenAI consulta `public.eos_message_usage_v40` y exige una fila que coincida con:

- `usuario_id` del payload;
- `request_id` del payload;
- `status = reserved`;
- `expires_at > now()`;
- `metadata.source = api-eos-v40`.

Esto vincula el webhook a la reserva server-owned creada por `/api/eos` antes del fetch a n8n. Una llamada directa sin reserva vigente se detiene antes de OpenAI y antes del Worker.

## Background Worker RC1

El candidato no usa IF/Switch y separa rutas lineales por webhook para evitar volver a inferir la acción desde texto:

- `eos-worker-rc1-internal`: `CREAR_TAREA`, `CREAR_OBJETIVO`, `GUARDAR_MEMORIA`;
- `eos-worker-rc1-file`: `GENERAR_EXCEL`, `GENERAR_PDF`, `GENERAR_WORD`;
- `eos-worker-rc1-dashboard`: `VER_DASHBOARD`;
- `eos-worker-rc1-briefing`: `VER_BRIEFING`;
- `eos-worker-rc1-respond`: turno sin efecto secundario.

Los webhooks del Worker reciben `Authorization: Bearer <EOS_WORKER_GATE_SECRET>` desde el Gateway. Las rutas con efectos validan ese Bearer en los endpoints internos de Vercel; las rutas read-only/echo usan `POST /api/internal/worker-ping/v1` antes de cualquier lectura o respuesta.

### Efectos internos

Secuencia:

`worker-authorize -> action-effects`

No existen inserts directos de n8n a `eos_tasks`, `eos_memory` ni `eos_goal_commands`. El ejecutor v64 usa el payload canónico ligado al command y deduplica por `action_command_id`.

### Archivos / efectos externos

Secuencia:

`worker-authorize -> action-claims -> preparar efecto -> action-results`

Excel usa `command_id` dentro de la URL lógica de `/descargar` y finaliza el command con esa misma `archivo_url`. PDF y Word terminan de forma explícita como `no_disponible` hasta que exista un generador gobernado equivalente.

Si el claim no entrega `claimed=true + lease_token + attempt_count`, el generador no se ejecuta. Replay completado, command en progreso o Worker stale producen cero efecto adicional.

## Variables necesarias en n8n/Railway

- `EOS_APP_BASE_URL`: durante el smoke RC debe apuntar al Preview exacto; tras merge puede pasar a producción.
- `EOS_N8N_BASE_URL`: URL base de la instancia n8n/Railway.
- `EOS_WORKER_GATE_SECRET`: exactamente el mismo secreto configurado en Vercel.

No incrustar estos valores secretos en el export JSON.

## Orden seguro de import/cutover

1. Importar ambos candidatos con `active=false`.
2. Confirmar que las credenciales Supabase/OpenAI referenciadas resuelven en la misma instancia.
3. Configurar las tres variables anteriores.
4. Activar primero el Worker RC1, cuyos paths son distintos a `eos-worker` legacy.
5. Probar directamente los endpoints RC1 con requests controlados y sin activar el Gateway RC1.
6. Probar replay idéntico, doble envío, payload alterado, contexto stale, approval, claim concurrente y Excel command-bound.
7. Desactivar el Gateway legacy.
8. Activar el Gateway RC1 en `eos-chat`.
9. Verificar E2E desde `/api/eos` con usuario real.
10. Desactivar el Worker legacy cuando no queden ejecuciones pendientes.

Nunca mantener dos Gateways activos con el mismo webhook ni dos caminos capaces de ejecutar el mismo efecto.

## PASS

No marcar Worker Gate live como PASS hasta demostrar en n8n real:

- misma solicitud repetida -> mismo command;
- tarea/memoria/objetivo -> un único efecto durable;
- dos Workers sobre archivo -> uno solo obtiene el claim;
- Excel replay -> un único command/artefacto lógico;
- resultado stale -> rechazado;
- llamada directa al Gateway sin reserva server-owned -> bloqueada;
- rutas Worker sin Bearer válido -> bloqueadas;
- Gateway legacy y camino gobernado nunca ejecutan en paralelo.
