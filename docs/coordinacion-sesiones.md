# Cómo trabajar este repo con varias sesiones de IA a la vez

Este repo lo tocan, al mismo tiempo, varias sesiones de Claude (a veces también
Codex) y el usuario. Ninguna ve lo que las demás están escribiendo hasta que
alguien mergea. Esto ya causó incidentes reales — no es una precaución
teórica:

- **2026-09-02:** dos sesiones escribieron, sin saberlo, dos migraciones con
  el mismo timestamp `20260902100000`. En la base ya aplicada no se notó
  (cada una corrió bajo su propia versión histórica), pero una instalación
  desde cero habría aplicado una y saltado la otra en silencio.
- **2026-09-20:** el PR #104 falló en CI porque otra sesión ya había usado la
  misma versión de migración.
- Reiterado varias veces: una sesión aplica una migración a producción **desde
  su propia rama, antes de mergear**, y la migración que otra sesión venía
  preparando en paralelo queda "vieja" o duplicada cuando por fin intenta
  aplicar la suya.

Ninguno de estos fue un error de lógica. Fueron dos sesiones sin visibilidad
entre sí tocando el mismo recurso compartido (el número de versión, la base de
producción) al mismo tiempo. Este documento es el protocolo para que deje de
pasar.

## 1. Trabajar en un worktree limpio desde `origin/main`, no en el checkout compartido

El checkout principal del repo suele tener cambios sin commitear de otras
sesiones o del propio usuario. Escribir ahí arriesga pisar trabajo ajeno sin
enterarse.

```bash
git fetch origin main
git worktree add <ruta-temporal> -b <tu-rama> origin/main
```

Trabajar ahí, empujar la rama (`git push -u origin <tu-rama>`), y borrar el
worktree al terminar (`git worktree remove <ruta-temporal>`). `main` está
protegida desde 2026-09-18 (PR obligatorio + el check `evals` en verde,
también para admins) — nadie, ni humano ni IA, puede pushear directo a
`main`. El usuario abre y mergea el PR.

**Windows:** no copiar `node_modules` dentro del worktree (rutas largas
rompen el borrado); usar una junction (`New-Item -ItemType Junction
node_modules -Target <repo>\node_modules`) y, al limpiar, `cmd //c rmdir
<worktree>\node_modules` ANTES de `git worktree remove`.

## 2. Antes de escribir una migración, correr `npm run siguiente-migracion`

El script (`scripts/siguiente-migracion.mjs`) mira el repo local, `origin/main`
y **todas las ramas remotas** — mergeadas o no — para encontrar la versión más
alta que cualquier sesión ya está usando, y recomienda una versión por delante
de esa. No reserva nada de verdad (no hay servidor central para eso): es una
fotografía del instante en que se corre. Por eso:

- Correr `git fetch --all --prune` primero — si no, el resultado miente.
- Crear el archivo con esa versión **inmediatamente**, no guardarla para
  después.
- Si pasaron varios minutos entre correr el script y crear el archivo, volver
  a correrlo.

`npm run migraciones` (bloqueante en CI) detecta el choque DESPUÉS de que ya
pasó, comparando archivos que conviven en el mismo checkout — es la red de
seguridad, no el método para elegir el número.

## 3. Nunca aplicar una migración a producción desde una rama sin mergear

Aplicar quirúrgicamente a producción (vía la Management API o `db push`) antes
de que el PR esté mergeado en `main` dos veces causó que otra sesión, sin
saberlo, preparara una migración que colisionaba con la ya aplicada. La regla:
**mergear primero, aplicar después** — salvo que el usuario pida explícitamente
lo contrario para un caso puntual, y avise a las demás sesiones activas
(`ListAgents` para verlas).

Aplicar contra producción (`db push`, o la Management API) sigue pasando por
el clasificador de permisos del usuario — es una escritura real e
irreversible — y se corre desde una carpeta limpia (`C:\Users\galea\eos-db-push`
si ya existe, o un worktree nuevo de `origin/main`), nunca desde el checkout
compartido.

## 4. Antes de tocar un archivo compartido, mirar si ya está sucio

`git status` en el checkout principal antes de decidir si conviene un
worktree nuevo o si hay trabajo ajeno en curso ahí. Si un archivo que se
necesita tocar (`lib/eos/procesar-mensaje.ts`, cualquier cosa bajo
`lib/gateway/`, los workflows de n8n) ya aparece modificado sin commit, asumir
que otra sesión lo está tocando — `ListAgents` para ver quién más está activo
— y avisar antes de pisarlo, o trabajar sobre una copia en un worktree y
resolver el choque como un merge normal, no sobrescribiendo.

## 5. n8n no pasa por git

Los workflows (`gateway`, `worker`) se tocan por la API de n8n, no por commit.
Un cambio ahí es invisible para cualquier sesión que no lo mire explícitamente.
Ver `docs/n8n-backups/` y [respaldo de flujos] — antes de tocar un nodo,
respaldar, y después de tocarlo, reexportar a `n8n/workflows/` (o
`node n8n/exportar.mjs`) para que el repo refleje lo que está vivo.

## Resumen de una línea por regla

1. Worktree limpio desde `origin/main`, nunca el checkout compartido.
2. `npm run siguiente-migracion` antes de nombrar un archivo nuevo.
3. Mergear antes de aplicar a producción, no al revés.
4. `git status` + `ListAgents` antes de tocar algo que ya está sucio.
5. Todo cambio de n8n se respalda y se reexporta a `n8n/workflows/`.
