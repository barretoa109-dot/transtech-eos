# CLAUDE_REVIEW.md

Revisión de solo lectura del repositorio `transtech-eos`, hecha el 2026-08-26 en coordinación con Codex. No se ejecutó ninguna migración, no se corrió `supabase db push` ni se modificó la base remota. Los únicos comandos ejecutados fueron de diagnóstico: `npm test`, `npm run lint`, `npm run evals`, `tsc --noEmit` y `supabase migration list --linked` (solo lectura).

---

## 1. Resumen ejecutivo

TransTech EOS es una app Next.js 16 / React 19 que funciona como "gerente operativo" para PYMEs paraguayas: un chat conversacional (EOS) respaldado por Supabase (Postgres + RLS + Auth), un motor de automatización en n8n, cobro con Bancard/Pagopar, y módulos de negocio contratables por separado (Finanzas, Briefing, Documentos, ERP, CRM, Facturación electrónica).

Estado general: **sólido y con buena disciplina de ingeniería** (RLS por defecto, `security definer` para lo sensible, triggers idempotentes, tests reales, evals que corren en CI). El código nuevo (ERP/CRM, plan armado, factura electrónica) sigue los mismos patrones que el resto de la base, no son islas.

Hallazgo más importante para accionar ya: **hay 6 migraciones locales (v64–v69) que todavía no están aplicadas en la base remota**, y el propio repo documenta que deben aplicarse *antes* de desplegar el código que las usa (ver §3 y §4.1).

---

## 2. Arquitectura actual

### 2.1 Stack

- **Framework**: Next.js 16.2 (App Router) + React 19.2, TypeScript, Tailwind v4.
- **Backend de datos**: Supabase (Postgres) — 146 migraciones en `supabase/migrations/`, todas con prefijo `eos_` para tablas propias del producto (conviven con tablas heredadas sin ese prefijo, ver §4.3).
- **Auth**: Supabase Auth, con `proxy.ts` (equivalente a middleware) que protege `/eos/chat`, `/eos/onboarding`, `/dashboard*`, `/mobile*`, y redirige `/dashboard` legado a `/eos/chat`.
- **Pagos**: Bancard (tokenización + cobro recurrente + 3DS) y Pagopar, ambos con webhooks propios.
- **Automatización**: n8n en Railway, 8 workflows activos (gateway conversacional + worker de acciones + subsistemas de briefing/aprendizaje/seguimiento), respaldados como JSON en `docs/n8n-backups/`.
- **Documentos**: generación de Excel (`exceljs`), PDF (`pdfkit`), Word (`docx`) a pedido desde el chat.
- **Push**: Web Push (VAPID) para lo urgente; el resumen diario va por correo (Resend).
- **Mobile**: Capacitor (Android/iOS) envolviendo la misma app web.
- **Testing**: `node --test` nativo sobre `lib/**/*.test.ts` (no Jest/Vitest) — 341 tests. Evals propios (`evals/correr.ts`) que verifican comportamiento del chat (correo bancario, categorización, importes, fechas) — 60/60 casos. Ambos corren en CI (`.github/workflows/evals.yml`) en cada push a `main` y en cada PR.

### 2.2 Estructura de carpetas

```
app/
  api/            → route handlers (uno por dominio: finanzas, erp, crm, facturacion, pagos, autonomy, decisions, learnings, ...)
  eos/            → la UI del chat (chat, onboarding, autonomy, hooks, services, types)
  components/ui/  → sistema de componentes propio (animations, cards, charts, forms, ...)
  admin/, planes/, pago/, login/, ...
lib/
  finanzas/, pagos/, facturacion/, erp/, crm/, modulos/, documentos/, auditoria/,
  seguridad/, push/, briefing/, monitoreo/, auth/, supabase/
components/        → auth, effects (three.js), legal, pwa
supabase/
  migrations/      → 146 archivos, forward-only
docs/              → runbooks, backups de n8n, notas de puesta en marcha
evals/             → corpus de evaluación del chat
android/, ios (vía capacitor.config.ts)
```

Cada dominio de negocio tiene su propia carpeta en `lib/` con lógica pura y testeada, y su propia carpeta en `app/api/` con los route handlers, que son delgados: validan entrada, llaman a `lib/` o a una función Postgres (RPC), y devuelven la respuesta. La lógica de negocio "que importa" (cálculo de precios, estado, atomicidad) vive mayormente **en la base**, vía funciones `security definer` y triggers — no en TypeScript. Esto es consistente en todo el repo, no solo en el código nuevo.

### 2.3 Patrones que se repiten y valen la pena nombrar

- **La puerta de módulos (`lib/modulos/acceso.ts`)**: todo endpoint de un anexo (ERP, CRM, Facturación, ...) empieza con `exigirModulo("codigo")`. La decisión de acceso vive en una función de Postgres (`eos_tengo_modulo`), no en TypeScript, para que un cron y la app respondan igual. Ante cualquier error de lectura, **se niega el acceso** (fail-closed) — excepto en el caso explícito de "el módulo todavía no existe en el catálogo", donde se permite a propósito para no apagar funciones recién desplegadas antes de que la migración que siembra el catálogo haya corrido. Es una decisión de diseño explícita y bien documentada en el código, no un descuido.
- **RLS por tabla + `security definer` para lo cruzado**: el patrón de las migraciones nuevas (ver v67, ERP/CRM) es `enable row level security` + política `using/with check (auth.uid() = usuario_id)` + `revoke all` + `grant` explícito a `authenticated`/`service_role`. Las tablas "hijas" sin `usuario_id` propio (ítems de venta, ítems de compra) resuelven la política contra la tabla padre. Este patrón se endureció con el tiempo: hay ~30 migraciones dedicadas solo a "hardening" (RLS, `search_path` de funciones, fencing de comandos idempotentes, atomicidad de commits) fechadas 12–17 de agosto.
- **Atomicidad vía RPC con "fencing tokens"**: para operaciones concurrentes (pagos, acciones del worker, snapshots del "business twin"), el patrón es una función Postgres con guardas de idempotencia y un token de versión, en vez de lógica optimista en la aplicación. Se ve una progresión clara de v60 a v77 refinando este mecanismo (varias migraciones "_fix" seguidas indican iteración rápida sobre bugs de concurrencia reales, ya resueltos).
- **Precio armado, no plan fijo**: desde v66, `/planes` dejó de vender planes cerrados y pasa a ser un armador de módulos. El total que ve el usuario en pantalla es solo para feedback inmediato; `POST /api/modulos/armado` **recalcula todo en la base** (`eos_precio_armado`) y descarta lo que mandó el navegador — evita que un cliente manipulado fije su propio precio.
- **Import documentado con "por qué", no "qué"**: el estilo de comentario dominante en el código nuevo explica una decisión de producto o una trampa evitada (ej. por qué el embudo de CRM tiene 5 etapas y no 10, por qué el IVA se deriva y no se suma). Es información que no está en ningún otro lado del repo y es genuinamente útil para quien edite ese archivo después.

---

## 3. Estado del proyecto

- **Rama**: `main`, sin cambios preexistentes en el árbol salvo dos carpetas nuevas sin trackear: `app/api/crm/` y `lib/crm/` (el módulo CRM, código del último ciclo de trabajo, aún no comiteado).
- **Últimos commits**: la secuencia reciente (`0b64a1c` "ERP, CRM y la base de la factura electrónica", `5e1f8c3` "planes armados", `303b684` "orden entre migrar y desplegar") corresponde exactamente al trabajo de las migraciones v64–v69 y su documentación en `docs/puesta-en-marcha-v64-v69.md`.
- **Migraciones — verificado con `supabase migration list --linked`**: 140 de 146 migraciones están sincronizadas (`local` = `remote`). **Las 6 más nuevas (20260826140000 a 20260826190000, es decir v64 a v69) tienen `remote` vacío: existen como archivo pero no están aplicadas en la base.** Esto confirma lo que dice `docs/puesta-en-marcha-v64-v69.md` y es información fresca, no derivada solo del doc.
- **Tests**: `npm test` → **341/341 OK** (incluye `lib/crm/embudo.test.ts`, ya presente pese a que la carpeta no está trackeada en git).
- **Type-check**: `tsc --noEmit` → **sin errores**.
- **Evals**: `npm run evals` → **60/60, APROBADO** (correo bancario, categorización, importes, fechas).
- **Lint**: `npm run lint` → **43 errores, 39 warnings** (detalle en §4.2). No corre en CI hoy (el workflow de CI solo corre `npm test` y `npm run evals`, no `npm run lint` ni `tsc`).
- **Repo**: dos archivos `.zip` pesados siguen trackeados en git (`auditoria-chat-eos.zip`, `supabase-schema.zip`) pese a que `*.zip` ya está en `.gitignore` — el ignore no afecta a lo ya trackeado. Bajo impacto, pero infla el repo.

---

## 4. Errores y riesgos detectados

### 4.1 P0 — Orden migración/despliegue (ya identificado por el equipo, no nuevo, pero confirmado en vivo)

Las migraciones v64–v69 (documentos generados, multimoneda, plan armado, ERP/CRM, factura electrónica, registrar venta) **no están aplicadas en remoto**. El propio `docs/puesta-en-marcha-v64-v69.md` advierte que desplegar el código antes de correrlas **puede apagar funciones para todos los usuarios existentes** si la puerta de módulos no encuentra el catálogo poblado — aunque el mecanismo de "fail open ante módulo inexistente" (§2.3) mitiga el caso más grave, la migración v66 es además la que **regala los módulos por cortesía a las cuentas existentes**, así que sin ella corrida, ninguna cuenta vieja tiene módulos activos hasta que se aplique.

**Acción**: correr las 6 migraciones (en orden, respetando las dependencias que el doc ya señala: v66 depende de v63, v68 y v69 dependen de v67) *antes* de mergear/desplegar el código que las usa. Esto no lo hace esta revisión a propósito (instrucción explícita de no tocar la base).

### 4.2 P1 — Deuda de tipado en módulos de dinero (`lint`)

`lint` reporta 43 errores, casi todos `@typescript-eslint/no-explicit-any`, concentrados en:

- `lib/bancard.ts` (3), `lib/bancard-cobro.ts` (5) — el cliente de la pasarela de pago con tarjeta.
- `lib/worker-gate-handler.ts` (4), `lib/worker-gate-payload-binding.ts` (1) — el despachador de acciones del worker de n8n.

Que el `any` esté justo en los dos módulos que manejan plata en tránsito y ejecución de acciones autónomas es lo que lo sube de "limpieza cosmética" a "vale la pena mirar": un `any` ahí puede esconder un campo de la respuesta de Bancard mal tipado que hoy no rompe nada porque el flujo feliz no lo ejercita, pero tampoco lo protege el compilador si cambia. No se encontró un bug concreto detrás de ninguno de estos `any` en esta pasada — es una recomendación de endurecimiento, no un error confirmado.

### 4.3 P1 — Página de prueba olvidada, pública, contra una tabla real

`app/test/page.tsx` es una página de scaffold (`"Prueba Supabase"`) que:

1. Usa el cliente **anon** (`lib/supabase`) para hacer `select *` sobre `public.usuarios` — que **no es una tabla de juguete**: es la tabla real de perfiles de usuario (tiene columnas `nombre`, `plan`, y un trigger de invalidación de contexto maestro que dispara con sus updates — ver migración `20260813023008`).
2. La ruta `/test` **no está protegida** por `proxy.ts` — su `matcher` solo cubre `/login`, `/dashboard*`, `/eos/chat*`, `/eos/onboarding*`, `/mobile*`. `/test` queda servida a cualquiera, sin sesión.
3. Falla lint por un bug real de React (`cargar` se usa en el `useEffect` antes de declararse — funciona por *function hoisting*, pero es la clase de patrón que `react-hooks/immutability` marca porque no se actualiza si `cargar` alguna vez pasa a depender de props/estado).

No se pudo confirmar en esta revisión si esto **filtra datos hoy**: `public.usuarios` no tiene su política RLS en ninguna migración trackeada del repo — junto con el trigger `handle_new_user`, es uno de los objetos "no versionados" que ya señala `docs/rollback-runbook.md` §2. Es decir: **el riesgo real depende de una política de RLS que vive solo en la base y que este repo no puede verificar por sí solo.**

**Recomendación**: borrar `app/test/page.tsx` (es código muerto de scaffold, no cumple ninguna función de producto) y, por separado, documentar la política de RLS real de `public.usuarios` en una migración (aunque sea una que solo la declare `create policy if not exists` de forma idempotente) para que deje de ser un objeto invisible para el repo.

### 4.4 P2 — CI no corre `lint` ni `tsc`

`.github/workflows/evals.yml` corre `npm test` y `npm run evals` en cada push/PR a `main`, pero no `npm run lint` ni `tsc --noEmit`. Ahora mismo el build de Next.js probablemente atrapa los errores de tipos en build (Next corre su propio type-check), pero **no atrapa los errores de ESLint** salvo que Next esté configurado para fallar el build con ellos — lo cual, dado que ya hay 43 errores acumulados sin romper nada, sugiere que **no** está fallando el build. Eso significa que la deuda de `any` de §4.2 puede seguir creciendo sin que nada la marque.

### 4.5 P2 — Higiene de repo menor

- `auditoria-chat-eos.zip` y `supabase-schema.zip` siguen trackeados en git pese a que `*.zip` está en `.gitignore` desde el commit `b7ccf4b`. `git rm --cached` los sacaría sin tocar el archivo local.
- `supabase-schema.sql` en la raíz está vacío (0 bytes) — o es un remanente que ya no cumple función, o falta poblarlo; en cualquier caso confunde si alguien lo abre esperando el esquema.
- `lib-backup.txt` (vacío, en la raíz) y dos `.env.local.backup-*` / `.env.local.txt` locales — estos últimos ya están cubiertos por `.env*` en `.gitignore`, así que no hay riesgo de fuga, pero son ruido en el directorio de trabajo.

### 4.6 Observación, no riesgo: cobertura de tests pareja en lo nuevo

El módulo CRM nuevo (`lib/crm/embudo.ts`) llegó con test (`embudo.test.ts`) desde el primer commit visible, igual que ERP (`lib/erp/impuestos.test.ts`) y Facturación (`lib/facturacion/cdc.test.ts`). La proporción global es 30 archivos de test sobre 54 de código en `lib/` — no es 1:1 pero la lógica más peligrosa de calcular (impuestos, CDC, embudo ponderado, cifrado) está cubierta. No se identificó código de cálculo de dinero sin test.

---

## 5. Recomendaciones

1. **Antes de desplegar lo que ya está commiteado**: aplicar v64–v69 en el orden documentado en `docs/puesta-en-marcha-v64-v69.md`. Es la única acción de esta lista con ventana de tiempo real (afecta a todas las cuentas existentes si se invierte el orden).
2. Borrar `app/test/page.tsx` y, si el equipo quiere quedarse tranquilo con `public.usuarios`, escribir la migración que declare su RLS actual de forma explícita (`create policy if not exists ...`) para que dependencia deje de vivir solo en el dashboard de Supabase.
3. Agregar `npm run lint` (y opcionalmente `tsc --noEmit`) al workflow de CI, aunque sea sin bloquear el merge al principio (`continue-on-error: true`), para que la cuenta de 43 errores no seguir creciendo en silencio sea visible en cada PR.
4. Cuando se retome el trabajo de Bancard (ya señalado como pendiente en `docs/puesta-en-marcha-v64-v69.md`): conectar `armado_id` en `solicitudes_pago.metadata` para el cobro con tarjeta, y hacer que la renovación recurrente lea `eos_planes_armados` (`estado = 'vigente'`) en vez del precio fijo del plan — confirmado en esta revisión que el código de `app/api/cron/bancard-renovaciones` y `lib/pagos/` todavía no referencia `armado_id` en ningún lado.
5. Sacar los dos `.zip` trackeados del índice de git (`git rm --cached auditoria-chat-eos.zip supabase-schema.zip`) para que dejen de pesar en cada clone.
6. Tipar los `any` de `lib/bancard.ts`, `lib/bancard-cobro.ts`, `lib/worker-gate-handler.ts` y `lib/worker-gate-payload-binding.ts` — no como urgencia, pero sí antes de que ese código vuelva a tocarse por otro motivo, aprovechando el viaje.

## 6. Próximos pasos sugeridos (orden)

1. Aplicar migraciones v64–v69 en remoto (bloqueante para desplegar el código de ERP/CRM/factura electrónica/plan armado ya commiteado).
2. Comitear `app/api/crm/` y `lib/crm/` (hoy sin trackear) junto con el resto del ciclo ERP/CRM/plan armado, o confirmar si se quiere dejar afuera de este despliegue a propósito.
3. Eliminar `app/test/page.tsx`.
4. Decidir si la certificación de Bancard en curso (mencionada en `docs/puesta-en-marcha-v64-v69.md` como razón para no tocar `planes.es_publico`) ya terminó; si terminó, es un buen momento para conectar `armado_id` al cobro con tarjeta (punto 4 de recomendaciones).
5. Agregar `lint`/`tsc` a CI.
