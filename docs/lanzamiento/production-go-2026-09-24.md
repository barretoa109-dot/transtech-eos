# Production GO — auditoría del 24/09/2026 (ciclos 1 y 2)

Rama: `claude/eos-production-go-audit-pgqhq4`, sobre `main` en `c54d498`.

## Veredicto: **NO-GO** para lanzamiento abierto

Pasa a **CONDITIONAL GO (piloto controlado)** cuando se cumplan los tres pasos
de "Qué hace falta para pasar a CONDITIONAL GO", al final. Ninguno necesita
código nuevo.

El motivo no es que EOS esté mal construido: el núcleo está más cuidado de lo
habitual (2124 tests, evals, candados de CI, idempotencia en el Worker Gate,
auditoría encadenada). El motivo es que **había un P0 posible que no se podía
descartar desde el repositorio** (un usuario gratuito se asigna un plan pago
desde la consola del navegador) y **un P1 real en cobros** (doble cobro / pago
sin plan cuando Bancard no contesta a tiempo). Los dos quedan corregidos en esta
rama, pero la corrección de base de datos todavía no está aplicada en
producción.

## Qué se inspeccionó y cómo

Estados: **IMPL** implementado · **CONECT** conectado de punta a punta ·
**PROBADO** con evidencia ejecutada · **RESIL** maneja fallas ·
**PROD** listo para producción. "Leído" quiere decir revisado en el código,
**no** probado.

| Módulo | Estado real | Evidencia de este ciclo | Riesgo abierto |
|---|---|---|---|
| Autenticación | CONECT; `proxy.ts` protege `/eos/chat` y `/eos/onboarding`; las APIs validan con `getUser()` o `exigirModulo` | Leído. Se revisaron las 124 rutas: las que no llaman `getUser` pasan por `exigirModulo`, secreto de cron, secreto de worker o firma | No se probó recuperación de contraseña ni sesión vencida en navegador real |
| Usuarios / Perfil | **Corregido (v197)** | Base reconstruida: sin v197, `anon` y `authenticated` leían y escribían `usuarios` de cualquiera. Con v197, 24/24 en la prueba A/B | v197 no aplicada en producción |
| Planes / Entitlements | Fuente de verdad única en base (`obtener_estado_comercial_eos`, `eos_tengo_modulo`) + `exigirModulo` en el servidor | Prueba A/B: "A intenta darse `enterprise` hasta 2099" → sin cambio | Ídem v197 |
| Límite Free (5/día) | PROBADO en migraciones previas: reserva/finaliza/libera server-side (`eos_*_message_quota_server_v75`) | Leído. Con v197, el usuario tampoco puede poner su `uso_mensual` en cero (antes podía, en la reconstrucción) | — |
| Pagos Bancard | **Corregido**: resultado incierto + conciliación | 7 tests nuevos; `tsc`, build | Bancard producción es trámite externo (ver `estrategia/bancard-produccion-seguimiento.md`); certificación (`npm run certificar`) no corrida: sin credenciales en este entorno |
| Pagopar / transferencias | IMPL, firma verificada en tiempo constante, monto validado | Leído | Proceso manual de transferencias separado del automático: sí (`/api/admin/pagos`) |
| Billing / renovaciones | Cron diario con protección de doble cobro; ahora concilia primero y no cobra sobre un cobro incierto | Tests de conciliación | Vercel Hobby solo permite cron diario: un pago sin webhook tarda hasta 24 h en conciliarse **salvo** que el usuario esté mirando la pantalla de pago (ahí concilia a los 2 min) |
| Chat / IA | CONECT (gateway n8n); gateway TS listo pero apagado (`EOS_GATEWAY_TS`). **Ciclo 2: freno de ráfaga por usuario (20/min, 300/h) en web y WhatsApp**; documentos adjuntos citados como datos (prompt injection) | `npm run evals` 103/103; 7 tests nuevos | Dependencia de n8n en Railway; no probado en vivo |
| Memoria / Contexto | CONECT | Prueba A/B: B no ve memorias de A ni puede borrarlas | Calidad de memoria (duplicados, obsoletas) no evaluada con datos reales |
| Objetivos | CONECT | Prueba A/B de aislamiento | — |
| Business Twin | CONECT: se arma solo con indicadores calculados y anomalías con evidencia; lo que no se sabe queda en `null` a propósito (`lib/kpi/twin.ts`) | Tests existentes (`twin.test.ts`) | — |
| Negocios (ERP/CRM) | CONECT, transaccional (`eos_erp_registrar_venta`), aislamiento por empresa | `supabase/pruebas/negocio_e2e.sql` existente | — |
| Personal / Finanzas | CONECT; candado `npm run ambito` (89 consultas declaran dueño) | Candado en verde | — |
| Documentos | **PROBADO** | Ciclo 2: PDF, Excel y Word generados de verdad y abiertos con herramientas externas (openpyxl, unpdf, lectura del XML del .docx): acentos, ñ, montos en Gs., números como números en Excel. Repetir la descarga regenera desde la especificación guardada: no duplica | — |
| Acciones / Worker Gate | CONECT, idempotente, con aprobación y binding de payload | Leído; la aprobación ya tenía trigger guardián (v12) | **Hallazgo −1 de la lista maestra** (n8n apuntando a un preview viejo): no verificable sin acceso a Railway |
| n8n | CONECT | No accesible desde este entorno | Ídem |
| Supabase | **Reconstruible desde cero** (294 migraciones) | `supabase/pruebas/local/reconstruir.sh` | Producción puede tener objetos fuera de migraciones (ya documentado en el runbook) |
| WhatsApp | Recibe; firma HMAC por canal; dedupe. **Ciclo 2: vinculación por código blindada contra fuerza bruta** | 5 tests + contador real en base reconstruida | Envío depende del trámite con Meta (`estrategia/whatsapp-business-checklist.md`) |
| Email | Resend, transaccionales con reclamo de envío único | Leído | — |
| Web / PWA / Mobile | IMPL | No probado en dispositivos | P2: no hay navegador real ni iPhone en este entorno |
| Micrófono | Arreglado antes (máquina de estados testeada en `lib/eos/dictado.test.ts`); el campo de texto nunca se deshabilita por el dictado | Leído + tests existentes | Falta prueba manual en iPhone: permiso negado, cancelar, volver |
| Seguridad | Ver sección siguiente | Prueba A/B | — |
| Observabilidad | Salud propia (`/api/admin/salud`), errores de servidor (v194) | Nuevo chequeo "Cobros con resultado desconocido" | — |
| Soporte / Admin | Panel de pagos por allowlist de correo | Leído | — |
| Analytics | Vistas v172/v192 | Leído | — |
| Infraestructura / Rollback | `docs/rollback-runbook.md` | — | Supabase free tier sin PITR (P1 ya documentado, decisión de gasto) |

## Hallazgos de este ciclo

### P0 (posible) — El plan se podía autoasignar desde el navegador · CORREGIDO EN RAMA

**Problema.** `usuarios` es la fuente de verdad del plan y el navegador escribe
en esa tabla (`RegisterForm` hace un upsert). Ninguna migración limitaba qué
columnas puede tocar el usuario, y ninguna encendía RLS en `usuarios`.

**Causa raíz.** Las 40 tablas del esquema heredado (v0) se crearon en el panel
de Supabase antes del versionado. La v0 las reconstruyó a partir del catálogo
—columnas, índices, claves— pero no el estado de RLS. Hay políticas escritas en
migraciones para varias de ellas (`solicitudes_pago`, `tareas`, `eos_profiles`)
que nunca se encienden en el repositorio. El código del chat da por hecho
políticas de `mensajes` que tampoco existen en ninguna migración.

**Evidencia.** Base reconstruida desde cero sobre Postgres 16 con los roles de
Supabase: 40 tablas sin RLS; `anon` con SELECT/UPDATE sobre `usuarios`,
`objetivos`, `eventos_pago`, `eos_historial`. Prueba A/B sin v197: **14 de 24
comprobaciones fallan**, incluida "A se asigna un plan pago".

**Cambio.** `20260924101000_eos_blindaje_rls_heredado_v197.sql`:
trigger que ignora lo que el navegador escriba en columnas comerciales;
RLS idempotente en las 40 tablas; políticas de dueño solo donde no hay
ninguna; plata y consumo de solo lectura; `anon` solo lee `planes` e inserta
`leads`.

**Riesgo del cambio.** Si producción tiene RLS apagada en alguna tabla que la
app lee con el cliente del usuario **para filas que no son suyas**, esa lectura
dejaría de devolver filas. Se buscó ese patrón en `app/`, `lib/` y
`components/`: los accesos con el cliente del usuario a estas tablas son todos
sobre filas propias. La migración es idempotente y aditiva; revertirla es
`alter table … disable row level security` + `drop trigger`.

**Prueba.** `supabase/pruebas/aislamiento_rls_e2e.sql`: **24/24 con v197,
14 fallas sin ella.**

### P1 — Cobro con tarjeta cortado: doble cobro o pago sin plan · CORREGIDO EN RAMA

**Problema.** Si el `charge` a Bancard excedía los 30 s, devolvía un 5xx o un
cuerpo ilegible, la solicitud se marcaba `rechazado` (terminal) o quedaba
`pendiente` para siempre. El cron de renovaciones solo mira pagos `pagado`, así
que al día siguiente cobraba otra vez. Tampoco existía nada que cerrara los
cobros cuyo webhook no llegó o cuya verificación falló tres veces.

**Síntoma para el cliente.** "Me cobró y sigo en Free" y, en renovaciones,
un segundo cargo en la tarjeta.

**Cambio.** `lib/pagos/conciliacionBancard.ts` (nuevo), `lib/bancard-cobro.ts`,
cron de renovaciones, `/api/pagos/bancard/estado`, `/cobrar`, `PagoTarjeta.tsx`,
chequeo de salud.

**Prueba.** 7 tests (`lib/pagos/conciliacionBancard.test.ts`): aprueba solo
con `S`/`00`, no adivina ante la duda, respeta 10 minutos de gracia para el
webhook, una falla no corta la pasada, y si no se puede saber si hay un cobro
incierto se asume que sí.

**Lo que no se pudo probar.** El camino contra Bancard real. Hay que correr el
caso 3 de `npm run certificar` con credenciales de staging.

### Otros

- **La aprobación de acciones ya estaba protegida.** Se sospechó que el usuario
  podía reescribir el payload de una aprobación; el trigger
  `eos_guard_user_approval_update_v12` ya lo impedía. Se acotó igual el permiso
  a `status`.
- **`worker-ping` dice de qué despliegue es** (entorno, rama, commit), para
  poder comprobar que n8n habla con producción (hallazgo −1 de la lista maestra).

## Release Gate

| Criterio | Estado |
|---|---|
| Sin P0 abiertos | **No**: corregido en rama, falta aplicar v197 en producción |
| Sin P1 abiertos relevantes | **No**: cobros corregidos en rama sin desplegar; hallazgo −1 sin verificar |
| Build reproducible | Sí: `npm run build`, `tsc`, 2124 tests, evals 103/103, lint dentro del tope |
| Autenticación end-to-end | Leído, no probado en navegador |
| RLS y aislamiento verificados | **Sí en la reconstrucción** (24/24). Falta correr la misma prueba contra producción |
| Pagos sincronizados | Corregido en rama; Bancard producción es externo |
| Planes y permisos server-side | Sí, con v197 |
| WhatsApp no duplica | Dedupe por id y firma; no probado en vivo |
| Rollback | Runbook existe; sin PITR |
| Secretos expuestos | No se encontraron en el repositorio |
| QA end-to-end ejecutado | **No**: requiere credenciales y un navegador contra producción |

## Qué hace falta para pasar a CONDITIONAL GO

1. **Unir esta rama y aplicar la v197** (`supabase db push`, desde una carpeta
   limpia y después de unir). Después, correr contra producción:
   `npx supabase db query --linked -f supabase/pruebas/aislamiento_rls_e2e.sql`
   → las 24 filas en `true`. La prueba termina en `rollback`: no deja datos.
2. **Confirmar que n8n habla con producción**: en Railway,
   `EOS_APP_BASE_URL=https://www.transtech.com.py`. Con el nuevo `worker-ping`
   se comprueba: la respuesta tiene que decir `entorno: "production"`.
3. **Correr `npm run certificar`** (casos 3, 6 y 11 como mínimo) con las
   credenciales de staging de Bancard, para que el cobro, el vencimiento y la
   reversión tengan evidencia después de este cambio.

## Para GO (además)

- Bancard en producción (externo).
- Plan pago de Supabase con PITR (decisión de gasto, `estrategia/costo-upgrade-infraestructura.md`).
- QA manual en iPhone/Safari y Android: registro, chat, micrófono (permiso
  negado, cancelar, volver), PWA instalada.
- Recorrido completo del cliente en producción con dos cuentas QA, incluido
  WhatsApp, una vez que Meta habilite el envío.


## Ciclo 2 (mismo día)

| # | Severidad | Hallazgo | Estado | Evidencia |
|---|---|---|---|---|
| 5 | **P1** (toma de cuenta) | Cualquier WhatsApp podía mandar códigos de vinculación de 6 dígitos al azar sin límite. Acertar el código pendiente de otra persona dejaba ese teléfono **dentro de su cuenta**. Los códigos salían de `Math.random` | Corregido: 5 intentos/hora por teléfono, 100 cada 10 min globales, falla cerrado; `crypto.randomInt` | `lib/whatsapp/intentos-codigo.test.ts` 5/5; `eos_consumir_cupo_v99` real corta en el 6.º intento |
| 6 | **P1** (costos) | Sin freno de ráfaga: el plan Business no tiene tope y un script con la sesión de un usuario podía mandar cientos de mensajes por minuto | Corregido: 20/min y 300/h por usuario, antes del cupo del plan, en web y WhatsApp | `lib/seguridad/rafaga.test.ts` 4/4 |
| 7 | P2 (prompt injection) | El resumen de un documento adjunto se pegaba al mensaje sin frontera; con las acciones que se ejecutan solas, un PDF de un tercero podía pedir "registrá una venta" | Mitigado: citado entre marcas fijas con la regla escrita adentro; el documento no puede cerrar la cita | `lib/eos/adjuntos.test.ts` |
| — | Revisado, sin hallazgo | Buzón de correo: token de 96 bits y parser determinista (sin IA). Invitaciones a empresa atadas al correo. Landing: promesas prudentes (aclara SIFEN) | — | Leído |

Suite al cierre del ciclo 2: **2136/2136 tests**, `tsc` y build en verde, evals 103/103, lint dentro del tope.

## Cómo se declara GO oficial

`npm run go` (nuevo, `scripts/verificar-go.mjs`) consulta producción y devuelve
GO/NO-GO con evidencia: que producción corre el último `main`, que la v197
está aplicada, que no queda tabla sin RLS, la prueba de aislamiento A/B contra
la base real (con `rollback`), que n8n autoriza contra producción, la salud,
los cobros inciertos y dos puertas públicas. Desde el entorno donde se hizo
esta auditoría no hay salida de red a producción: lo tiene que correr el dueño.

**GO oficial = `npm run go` en verde + los tres puntos manuales que imprime
al final.** Ver `pasos-del-dueno.md`.

## Siguiente ciclo

1. Calidad de memoria con datos reales (duplicadas, contradictorias,
   obsoletas): necesita leer producción.
2. Con el resultado de `npm run go`, lo que salga en rojo.
