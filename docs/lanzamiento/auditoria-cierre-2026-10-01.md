# Auditoría de cierre antes de tiendas, Bancard y clientes — 01/10/2026

Continúa la auditoría de lanzamiento del mismo día (INC-01 a INC-19, informe
"Auditoría de lanzamiento EOS"). Acá: lo que quedaba abierto, lo nuevo que
apareció al revisar, y el estado de cada fila con su evidencia.

Base: `main` en `6426054` (incluye #220, Sol + 5.5). Rama: `fix/auditoria-cierre`.
Todo lo que tocó producción fue **lectura** o **transacción revertida** con
cuentas sintéticas. No se escribió, borró ni editó ningún dato real.

## Decisión: CONDITIONAL GO

No queda ningún P0 ni P1 abierto en código, base ni workflows. Pasa a GO cuando:

1. Se mergea este PR y, **desde main**, se aplica la v228 (`db push` en
   `eos-db-push`) y se corre el parche `2026-10-01-lo-que-la-persona-decidio.mjs`
   + `node n8n/exportar.mjs` (el export ya viene en el PR: tiene que salir igual).
2. El dueño hace las pruebas manuales que una sesión no puede hacer:
   caso Green por el chat con una cuenta QA, `certificar 3 6 11` (tarjeta de
   prueba de Bancard), micrófono en un iPhone y un Android, y dos cuentas QA
   que no se vean entre sí.

## Registro de incidentes

Estados: **RESUELTO** = causa + cambio + prueba de regresión + E2E con relectura +
estado de producción. **CORREGIDO** = todo eso salvo aplicarlo en producción o
la prueba por el chat real. **ABIERTO** = causa conocida, sin cambio.

| ID | Sev. | Síntoma | Causa | Cambio | Prueba | Ambiente | Estado |
|---|---|---|---|---|---|---|---|
| INC-09 | P2 | Cuenta pagada que figura como Free | **Confirmada y reproducida en producción** (transacción revertida): plan `free` + tramo `conversaciones_plus` pago y vigente → la reserva daba `free`, 7 por día | v228: `eos_plan_efectivo_v228` + la reserva la usa (parche en su lugar, ancla única). El servidor TS toma el plan de la reserva (`planDelCupo`) | E2E `plan_efectivo_e2e.sql` **10/10** contra producción, revertida, con relectura (no quedó ni la función ni las cuentas). `mensaje-cupo.test` | **v228 aplicada** (01/10, desde main); E2E repetida ya aplicada 10/10; 16 cuentas reales sin cambio de plan | RESUELTO |
| INC-15 | P2 | Contexto "CTX 60/62 [{}]" | **Confirmada**: nodos `60 CTX Leer Perfil`…`66` de 17 workflows EOS 2.x/3.x: Supabase v1 con `alwaysOutputData` (devuelve `[{}]` sin filas), usuario de relleno fijo si faltaba el id, y filtros que n8n ignora salvo el primero. **Los 17 están inactivos**; el camino de hoy lee el contexto con el usuario de la sesión | Prueba que impide el patrón en un workflow exportado | `lib/n8n/referencias.test.ts` (INC-15) | n8n: 8 activos, ninguno con esos nodos | RESUELTO |
| INC-20 | P1 | Referencias a nodos no ejecutados / desconectados en n8n | Auditoría preventiva | `lib/n8n/referencias.ts`: detecta `$('X')`, `$node["X"]`, `$items("X")` a un nodo inexistente, desactivado o que no corre antes | 7 pruebas. Los 6 exportados: 22 referencias, 0 rotas. **Los 5 vivos leídos por API: idénticos a main, 0 rotas** | n8n producción | RESUELTO |
| INC-21 | P1 | Respuesta con el JSON crudo y acciones perdidas | **Confirmada en QA**: si el modelo escribe prosa y DESPUÉS el JSON, `JSON.parse` falla → la persona ve el JSON, las acciones se pierden y la vuelta a gpt-5.5 no se dispara. gpt-6-luna lo hizo en 2 de 6 casos; no se vio con Sol ni 5.5 | `separarJsonFinal` en `respuesta.ts`: recupera el objeto, el `"acciones": [...]}` suelto o una acción suelta, solo si el final parsea entero; todo sigue pasando por la lista blanca. `metadata.formato_recuperado` | 7 pruebas nuevas en `respuesta.test.ts`. QA real: los 2 casos que fallaban pasan con el texto limpio | Desplegado (`c97dfa9`) | RESUELTO |
| INC-22 | P3 | Excel por WhatsApp: el enlace llegaba dos veces | **Confirmada** leyendo el código: la respuesta ya trae "Descargar archivo: <enlace>" y el webhook lo volvía a pegar | `textoConEnlace` (no repite; un documento guardado sigue yendo adjunto) | `texto-con-enlace.test.ts` 4/4 | Desplegado (`c97dfa9`) | RESUELTO |
| INC-19 | P2 | Beta: priorizó la moto sobre los préstamos que la persona dijo que iban primero; plan como si el ingreso fuera fijo; repetir datos | Conducta del asesor, sin dato de base en juego. Antes del cambio, Luna ponía las cuotas primero en el texto pero **no guardaba** la prioridad ni el ingreso (1/4) | Prompt (TS y n8n, mismo texto): lo decidido manda, ingreso fijo vs variable, se guarda como memoria, plan = pasos con cuándo, tareas se ofrecen y no se crean solas, no adivinar lo que no se entiende | `prompt-asesoria.test.ts`, paridad n8n/TS. QA: antes 1/4 → después 4/4 + 2 regresiones OK (ver "Llamadas al modelo") | Desplegado (`c97dfa9`); **parche de n8n corrido** desde main, reexporte idéntico | CORREGIDO (falta el chat real) |
| INC-19b | — | Aprobar acciones por WhatsApp | Pedido de diseño | **No implementado** a propósito. Ver "Aprobación por WhatsApp" | — | — | ABIERTO (diseño) |
| INC-23 | P3 | Pruebas que fallaban en Windows (2) | La prueba leía el `.sql` con CRLF y comparaba contra LF | Normalizar al leer | `npm test` 2583/2583 | — | RESUELTO |
| INC-11 | P2 | Micrófono trabado en "escuchando" | (auditoría anterior) | máquina de estados en `dictado.ts` | 24/24; todos los eventos vuelven a `inactivo`; el campo de texto no se bloquea por el dictado | Vercel | CORREGIDO (falta dispositivo) |
| INC-24 | P3 | "Mandale a X un mensaje…" a veces pide confirmación | Variación del modelo (2/3 con gpt-5.5 low también con el prompt anterior) | Ninguno | — | — | ABIERTO |

INC-01 a INC-08, INC-10, INC-12 a INC-14, INC-16 a INC-18: sin cambios desde la
auditoría anterior (ver su informe).

## Revisado sin hallazgos (lectura de código y producción)

- **`/api/eos`**: el usuario sale de la sesión (`getUser`), nunca del cuerpo; la
  conversación se comprueba contra ese usuario (403 si no es suya); el plan lo
  decide la base. Las dos rutas que reciben `usuario_id`/`plan` en el cuerpo no
  dan privilegios: `empresa/miembros` lo usa como destino y la base valida al actor;
  `ventas/contacto` guarda `plan` como etiqueta.
- **Transferencias manuales**: aprueba solo un correo de `ADMIN_EMAILS`; una
  sola función atómica (`eos_process_manual_payment_v42`) con `idempotent`; el
  comprobante se acepta solo de la solicitud del propio usuario y en estado
  permitido; el correo de confirmación sale una vez (no en reintentos).
- **Tiempos y cuelgues (7 días, producción)**: 82 mensajes consumidos, 0
  reservas colgadas, 0 liberadas por error; `fin` p50 8,9 s, p95 24,3 s, máx
  25,3 s. n8n: 0 ejecuciones con error, 0 de más de 60 s, 0 sin terminar; el
  gateway y el worker de n8n con 0 ejecuciones (todo lo atiende el gateway TS).
- **WhatsApp y duplicados**: ningún workflow de n8n atiende WhatsApp (entra por
  la app, con índice único por `wa_id`): no hay dos caminos procesando lo mismo.
- **Build**: `next build` en verde (los errores históricos de páginas de EOS y
  login no se reproducen).

## Aprobación por WhatsApp (evaluación, sin implementar)

Ya existe la aprobación en la web (`eos_action_approvals_v12`: foto del pedido,
vencimiento, estado; `/api/autonomy/approvals`). Para hacerlo por WhatsApp sin
abrir un agujero:

1. **Identidad**: solo desde el número vinculado y verificado de la cuenta; un
   número no vinculado no aprueba nada.
2. **Qué se aprueba**: un mensaje con el resumen de la acción (qué, a quién,
   cuánto) y un código corto de un solo uso atado a ESA aprobación.
3. **Confirmación explícita**: "SÍ 4821", no un "ok" suelto que podría ser
   respuesta a otra cosa.
4. **Duplicados**: la transición `pending → approved` una sola vez en la base
   (el reenvío de Meta o un doble "SÍ" no ejecuta dos veces).
5. **Auditoría**: `wa_id` del mensaje, número, código y hora en el registro.
6. **Vencimiento**: el mismo de la aprobación web.

Es una función nueva con superficie de seguridad propia: va en su propio PR,
después del lanzamiento.

## Llamadas reales al modelo

Configuración QA: `gpt-6-luna`, razonamiento `low`, `max_output_tokens` 1200,
contexto mínimo, sin historial, **sin ejecutar acciones ni tocar la base**
(`evals/qa/qa-con-tope.mts`). Modelo efectivo comprobado en el pedido y en la
respuesta de la API en cada llamada. Tope US$ 1, estimado antes de cada
llamada. **La clave es la misma de producción** (no hay una de QA): el gasto
aparece en esa factura; el tope lo impone el script.

| Corrida | Llamadas | Resultado | USD |
|---|---|---|---|
| Antes de INC-19 (Luna) | 4 | 1/4 | 0,00229 |
| Después (Luna) | 6 | 5/6 (la falla: JSON pegado al final) | 0,00303 |
| Caso crítico con `gpt-6.1-sol` (regla de respaldo), 1.ª versión de la regla | 2 | Sol creó dos tareas no pedidas → se ajustó la regla | 0,02623 |
| Caso crítico, regla ajustada | 1 + 2 | Luna falla por formato; `gpt-6.1-sol` OK | 0,00651 |
| Recuperación del JSON (INC-21), Luna | 2 | 2/2 | 0,00069 |
| **Total** | **17** | | **≈ US$ 0,039** |

Una llamada a `gpt-6.1-sol` devolvió error y no registró consumo. Detalle y
respuestas: `evals/qa/resultados/2026-10-01-*.md`. No se cambió el modelo de
producción.

## Estado por ambiente

| | Estado |
|---|---|
| Código | Rama `fix/auditoria-cierre`: `npm test` 2583/2583, `tsc`, lint de lo tocado, `next build`, evals, migraciones, grants, rutas, ámbito, columnas, tema: verde |
| Vercel | Sin cambios hasta el merge. Producción en el último main según el dueño (`npm run go` OK GO, 01/10) |
| Supabase | v228 probada en transacción revertida, **sin aplicar**. Última aplicada: `20260930105000` (v227) |
| n8n | 8 workflows activos; los 5 versionados idénticos a main. Parche de INC-19 probado en seco contra n8n real (ancla única, 9 nodos compilan), **sin correr** |
| Producción | Sin escrituras de esta auditoría |

Rollback: v228 → recrear la reserva con el cuerpo de la v125 y `drop function
eos_plan_efectivo_v228(uuid)`; prompt → PUT del respaldo que deja el parche y
`git revert`; el resto → `git revert`.

## Datos reales que necesitan una tarea aparte (no se tocaron)

- Cuenta del dueño, 29/09: compras repetidas en la tarjeta del caso Green, un
  movimiento personal repetido, el emisor y la fecha de resumen de esa tarjeta
  cambiados por el chat, una posible tarjeta repetida. El dueño pidió **no
  borrar** sus datos de finanzas personales ni de negocio: queda como tarea
  suya, desde la pantalla.
- Cuenta de una clienta (caso de congruencia del 29/09): venta repetida, stock
  negativo, costos mal cargados y una venta que no se registró. Se corrige
  desde Negocio, por ella o con su autorización.

Los identificadores están en las notas internas, no acá: el repositorio es público.

## Aplicado — 01/10/2026

PR #221 mergeado (`c97dfa9`) y desplegado (`/api/version`). v228 aplicada desde main; parche de n8n corrido desde main. `npm run go` 9/9 GO; deriva 326/326. Quedan solo las pruebas manuales del dueño (ver la decisión, punto 2).
