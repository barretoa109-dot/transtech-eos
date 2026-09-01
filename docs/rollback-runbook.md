# Runbook de rollback — TransTech EOS

Última actualización: 2026-08-18.

## 1. Vercel (app Next.js)

Producción: `www.transtech.com.py`, proyecto `trans-tech/transtech-eos`.

**Rollback inmediato a un deploy anterior** (sin rebuild, alias instantáneo):

```bash
vercel ls transtech-eos --prod   # ver deploys recientes y sus IDs
vercel alias set <deployment-url-anterior> www.transtech.com.py
```

O desde el dashboard: Vercel → proyecto → Deployments → deploy anterior conocido-bueno → "Promote to Production". Es instantáneo, no requiere rebuild.

**Si el problema es un env var mal seteado** (como pasó hoy con `EOS_APP_BASE_URL`): corregir con `vercel env rm <NOMBRE> production` + `vercel env add <NOMBRE> production`, y volver a desplegar con `vercel deploy --prod` — los env vars nuevos no aplican a deploys ya construidos.

## 2. Supabase (base de datos)

Las migraciones en `supabase/migrations/` son forward-only — no hay un mecanismo de "down migration" automático en este repo.

**Si una migración recién aplicada rompe algo:**
1. Escribir una migración nueva que revierta el cambio específico (nunca editar ni borrar una migración ya aplicada en producción — el historial de migraciones debe ser append-only).
2. Aplicar esa migración de reversión de la misma forma que cualquier otra.

**Drift de migraciones: RESUELTO el 2026-08-21.** Durante un tiempo hubo 91 migraciones aplicadas en producción sin archivo en este repo (venían de la rama RC1 y del dashboard), más 2 archivos locales que nunca se habían registrado en el remoto. Eso significaba dos cosas graves: el repo no podía reconstruir el esquema desde cero, y `supabase db push` habría intentado reejecutar esas dos.

Se resolvió sin aplanar nada: Supabase guarda el SQL de cada migración en la columna `statements` de `supabase_migrations.schema_migrations`, así que las 91 se recuperaron textualmente y se restituyeron como archivos (llevan una cabecera que lo aclara). Las 2 locales se verificaron aplicadas —el trigger y las tablas existían— y se registraron con su SQL.

Estado verificado con `supabase migration list --linked`: **125 migraciones, todas con `local` y `remote` coincidentes**. `supabase db push` volvió a ser seguro.

**Cómo no volver a romperlo:** toda migración nueva debe quedar como archivo en `supabase/migrations/` *y* registrada en el remoto. Si se aplica quirúrgicamente por la Management API (que sigue siendo el método usado en este proyecto), hay que insertar la fila en `supabase_migrations.schema_migrations` en el mismo movimiento, incluyendo el SQL en `statements` — eso es lo que permitió esta recuperación.

**Nota que sigue vigente:** algunos objetos viven en la base sin haber pasado nunca por una migración (p. ej. el trigger `handle_new_user` sobre `auth.users`). Antes de asumir que un rollback de código alcanza, verificar si el problema está también en un objeto de base no versionado.

**Antes de un rollback de datos**: Supabase free tier no incluye point-in-time recovery más allá de backups diarios automáticos cortos — ver sección 4 (mover fuera del free tier es un P1 abierto).

## 3. n8n (workflows)

Producción: `https://n8n-production-6cdb.up.railway.app` (Railway).

Los 8 workflows activos están respaldados como JSON en [`docs/n8n-backups/`](./n8n-backups/), exportados el 2026-08-18 vía la API de n8n:

- `eos-4-0-conversational-gateway-worker-gate-rc1.json` — gateway conversacional principal (RESPONDER, routing de intents).
- `eos-4-0-background-worker-worker-gate-rc1.json` — worker de acciones (CREAR_TAREA, CREAR_OBJETIVO, GUARDAR_MEMORIA, generadores, VER_DASHBOARD, VER_BRIEFING, INT autorizar/efecto).
- `eos-3-0-briefing-personalizado-diario-v5.json`, `eos-3-0-aprendizaje-de-resultados-v7.json`, `eos-3-0-seguimiento-proactivo-v3.json`, `eos-3-0-registro-de-decisiones-y-resultados-v6.json`, `eos-3-0-background-worker-ejecucion-confiable-v3.json` — subsistemas EOS 3.0 aún activos.
- `eos-correo-estable-prueba-controlada.json` — envío de correo.

**Restaurar un workflow desde backup:** n8n UI → Workflows → Import from File → seleccionar el JSON correspondiente. Verificar que las credenciales referenciadas (no incluidas en el export, n8n las guarda aparte) sigan existiendo con los mismos nombres/IDs antes de activar.

**Regenerar el backup** (correr después de cualquier cambio a un workflow activo):

```bash
node -e "
const fs = require('fs');
const url = 'https://n8n-production-6cdb.up.railway.app';
const key = process.env.N8N_API_KEY; // desde .env.local
// GET \${url}/api/v1/workflows/<id>, guardar el JSON resultante
"
```

(o repetir el mismo patrón usado para generar los backups actuales — ver historial de este repo).

Estos backups **no incluyen** los ~50 workflows inactivos/legacy del proyecto n8n (versiones viejas de EOS 2.0/3.0 sin usar) — solo los 8 que están `active` hoy.

## 4. Pendientes que afectan la capacidad real de rollback (P1, no bloquean beta pero sí "impecable")

- Mover Supabase fuera del free tier (mejor retención de backups / point-in-time recovery).
- Activar protección de contraseñas filtradas (leaked-password protection) en Supabase Auth.
- SMTP propio para Supabase Auth (hoy usa el SMTP compartido de Supabase, con límites de tasa bajos) — ya hay `RESEND_API_KEY` disponible en el proyecto para esto.
- Documentar las env vars de Railway (n8n) — no auditadas todavía en este runbook.

Estos cuatro requieren acceso al dashboard de Supabase (Settings → Auth / Database / Billing) que no es accesible vía las API keys disponibles en este repo (anon/service-role son API de datos, no de gestión del proyecto).

---

# Cuando se cae algo de lo que EOS depende

> Escrito el 31 de agosto de 2026 contra lo que el código hace HOY, no contra lo
> que debería hacer. Donde dice "verificado" es que se leyó el camino en el
> código; donde dice "sin verificar" es que hace falta probarlo de verdad.

EOS depende de cinco cosas que no controla: Supabase, n8n, Resend, el modelo de
OpenAI y Bancard. Ninguna caída es hipotética y todas se ven distinto desde
afuera.

La regla que ordena todo lo de abajo: **cuando algo no funciona, EOS lo dice.**
Nunca inventa una respuesta, nunca da por hecha una acción que no se confirmó, y
nunca deja un cobro en un estado que no sabe explicar. Un producto que se
degrada diciendo la verdad se recupera; uno que miente para verse entero pierde
al usuario aunque vuelva a andar.

## Cómo se entera uno

`/admin/salud` corre los chequeos de `lib/monitoreo/salud.ts`: variables de
entorno críticas, entorno de cobros, páginas legales, avisos de pago sin
procesar, acciones trabadas y briefing del día. El cron del briefing lo ejecuta
solo y **manda alerta por correo cuando algo está en rojo**.

El agujero conocido: si lo que se cayó es Resend, la alerta de que se cayó
Resend tampoco sale. Es la limitación clásica de avisar por el mismo canal que
se está vigilando, y hoy no está resuelta.

## Supabase

**Qué se cae con él:** todo. Es la sesión, los datos, las funciones de negocio
y las de cobro.

**Qué ve el usuario:** las rutas contestan 503 con "No disponible". El chat no
puede reservar cupo y no llama a n8n.

**Qué NO se rompe:** el techo de solicitudes deja pasar en vez de rechazar
(`lib/seguridad/limite.ts`), a propósito: una caída de la base no puede además
dejar el formulario de contacto muerto.

**Qué hacer:**
1. Mirar https://status.supabase.com y el panel del proyecto `TransTech EOS`
   (`dirugpkamzgvyshcnsxs`, us-east-2).
2. Si es un problema de recursos y no una caída regional, el plan del proyecto
   se escala desde el panel sin downtime adicional.
3. **Recuperación puntual (PITR):** hay que confirmar que esté habilitada. En el
   plan gratuito de Supabase **no lo está**, y sin ella lo único disponible es
   la copia diaria automática. Ver "Lo que falta" al final.

## n8n — el gateway del chat

**Qué se cae con él:** solo el chat. El panel financiero, el ERP, los informes
y los cobros siguen andando.

**Qué ve el usuario (verificado):** "EOS recibió tu mensaje, pero tuvo un
problema procesándolo. Probá nuevamente en unos segundos." Y —esto es lo que
importa— **el mensaje no se le cobra**: `releaseQuota()` devuelve el cupo
reservado antes de contestar. Una caída de n8n no puede además gastarle
mensajes del plan a nadie.

**Qué hacer:**
1. Revisar el workflow en n8n (`EOS 4.0 - Conversational Gateway WORKER GATE
   RC1`). Ver `docs/salida-de-n8n.md` para editarlo por API sin gastar cupo.
2. Si el workflow quedó roto, restaurarlo desde `docs/n8n-backups/`.
3. **Cuidado:** el respaldo está desactualizado. Ver "Lo que falta".

## Resend — el correo

**Qué se cae con él:** el briefing diario, los avisos de riesgo, el aviso de
renovación y el formulario de contacto de ventas.

**Qué ve el usuario (verificado):** nada. Todo lo que usa correo es de fondo, y
el cron corta con 503 "Correo no configurado" sin romper la app. El formulario
de ventas sí contesta 503 al visitante.

**Qué hacer:**
1. Revisar la cuota en el panel de Resend. **La causa más probable no es una
   caída: es la cuota agotada**, y la comparten el briefing, los avisos y el
   formulario público.
2. Si se agotó por abuso del formulario, el techo de solicitudes (v99) ya lo
   limita a cinco cada quince minutos por visitante.
3. Los briefings no enviados NO se reintentan solos: el UNIQUE de
   `eos_briefing_envios` impide el duplicado, no el reenvío. Se manda el del día
   siguiente.

## OpenAI — el modelo

**Qué se cae con él:** el chat, desde adentro de n8n.

**Qué ve el usuario:** lo mismo que con n8n caído, porque el error llega por el
mismo camino.

**Qué hacer:** mirar https://status.openai.com y la cuota de la cuenta. El
cambio de modelo se hace en el workflow de n8n, no en este repositorio.

## Bancard — los cobros

**Qué se cae con él:** contratar módulos y renovar. Nada de lo ya contratado se
apaga: los vencimientos son fechas en la base y no dependen de Bancard.

**Qué ve el usuario:** el pago no se completa. La solicitud queda en
`pendiente` con su `vencimiento_pago`, así que no queda colgada para siempre.

**Qué hacer:**
1. Confirmar el entorno: `BANCARD_ENV` en `production` para cobrar de verdad.
2. **Una solicitud pendiente no se fuerza a mano.** El webhook de confirmación
   es idempotente y la puede cerrar cuando llegue, aunque llegue tarde —
   certificado en el caso 11, "una confirmación que llega tres días tarde igual
   acredita".
3. Si Bancard revirtió un cobro, existe `eos_bancard_revertir_cobro_v95`, que
   deshace plan, módulos, solicitud e historial en una transacción y es
   idempotente. No deshacerlo a mano.

## Lo que falta, dicho sin adornos

Este runbook explica qué hacer. Lo que todavía **no** está, y el punto 47 lo
pide:

1. **Restauración verificada.** Nadie restauró nunca una copia de esta base para
   comprobar que la copia sirve. Una copia que no se probó es una copia que no
   se sabe si existe.
2. **Recuperación puntual (PITR).** Hay que confirmar si está habilitada en el
   plan actual. Sin ella, la ventana de pérdida es de hasta un día.
3. **El respaldo de n8n está desactualizado.** `docs/n8n-backups/` es del 18 y
   20 de agosto; `n8n/workflows/eos-conversational-gateway-rc1.json` se tocó el
   28. Restaurar desde ahí hoy volvería el gateway diez días atrás.
4. **La alerta viaja por el canal que vigila.** Si Resend se cae, el aviso de
   que Resend se cayó tampoco sale. Hace falta un segundo canal.
5. **Nada de esto se ensayó.** Un procedimiento que nunca se ejecutó es una
   hipótesis. El simulacro es el punto 50.
