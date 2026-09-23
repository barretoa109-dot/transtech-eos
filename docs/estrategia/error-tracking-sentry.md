# Error tracking real antes de cobrar en serio (punto 11 del plan de fortalecimiento)

**Por qué esto queda como instructivo y no como dependencia ya instalada:**
`@sentry/nextjs` no es una librería más — toca `next.config.js`, agrega
`instrumentation.ts`, y en un build real sube source maps con un token de
autenticación de Sentry. Instalarlo a ciegas, sin un DSN real para probar el
flujo completo y sin poder correr un `next build` de producción contra un
proyecto real de Sentry, es exactamente el tipo de cambio que puede romper
el build de todas las demás sesiones activas en este repo sin que se note
hasta el próximo deploy. Mejor dejarlo listo para instalar en una sesión
que sí pueda probarlo de punta a punta con el DSN real.

## Por qué hace falta, en una frase

`/api/internal/salud` (construido 2026-08-21) fue diseñado a propósito
porque **Sentry no habría detectado los fallos reales de esa semana** — eran
respuestas manejadas (403, 503), no excepciones. Sentry no reemplaza ese
chequeo. Lo complementa: captura las excepciones sin capturar (JS sin
manejar, timeouts no anticipados) que hoy no dejan ningún rastro salvo los
logs de Vercel, que nadie mira en tiempo real.

## El costo real: gratis para el tamaño actual

Sentry tiene un tier gratuito permanente: 5.000 errores/mes, 1 usuario, 30
días de retención. Con 6-7 cuentas reales y el volumen de tráfico actual,
está muy por debajo de ese límite — no hace falta presupuestar nada para
arrancar (a diferencia de Supabase/Vercel, ver
`costo-upgrade-infraestructura.md`).

## Pasos para instalarlo (para la sesión que lo ejecute)

1. Crear el proyecto en sentry.io (lo hace el usuario — es una cuenta con su
   propio login, no algo que una sesión de Code deba crear en su nombre) y
   conseguir el DSN.
2. `npx @sentry/wizard@latest -i nextjs` — el wizard oficial hace la mayoría
   de la integración (crea `sentry.client.config.ts`,
   `sentry.server.config.ts`, `sentry.edge.config.ts`, ajusta
   `next.config.js`). **Revisar el diff que genera con cuidado** antes de
   commitear — los wizards de instalación suelen agregar más configuración
   de la necesaria (session replay, profiling) que conviene desactivar para
   empezar simple y barato.
3. Variables de entorno en Vercel: `NEXT_PUBLIC_SENTRY_DSN` (o el nombre que
   use la versión del wizard) y `SENTRY_AUTH_TOKEN` (solo para subir source
   maps en el build, no se expone al cliente).
4. **Probar con un error real a propósito** en un entorno de prueba (no en
   producción con clientes reales) antes de confiar en que está capturando
   — un `throw` deliberado en una ruta de prueba, confirmar que aparece en
   el dashboard de Sentry.
5. Confirmar que no duplica ni compite con el `console.error` que ya usa
   `lib/monitoreo/salud.ts` — Sentry captura la excepción, el chequeo de
   salud sigue siendo la fuente de verdad de "¿está sano el sistema ahora
   mismo?".

## Qué NO instrumentar con Sentry

- Nada de lo que ya pasa por `lib/auditoria/registrar.ts` (la bitácora
  inmutable) — son sistemas con propósitos distintos: uno es un registro de
  negocio append-only, el otro es diagnóstico técnico volátil.
- Nunca mandar el cuerpo de un mensaje de chat o un movimiento financiero
  como contexto de un error — la misma regla de privacidad que ya aplica a
  la auditoría (`limpiarDetalle()`) debería aplicar acá: un error de
  Sentry no puede ser el camino por el que se filtra el texto de una
  conversación.
