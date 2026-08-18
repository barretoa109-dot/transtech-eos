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

**Nota importante descubierta hoy:** varias funciones/tablas viven en la base de producción sin tener su migración correspondiente en este repo (p. ej. el trigger `handle_new_user` sobre `auth.users`, y varias tablas de Worker Gate/autonomía). Antes de asumir que un rollback de código alcanza, verificar si el problema está también en un objeto de base que no está versionado acá — puede requerir revertir directamente en la base, no solo en git.

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
