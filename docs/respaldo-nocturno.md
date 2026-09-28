# Respaldo nocturno de la base

`.github/workflows/respaldo.yml` corre todas las noches a las 04:00 (Asunción):

1. `pg_dump` de los esquemas `public`, `auth` y `storage` de producción;
2. **lo restaura** en un Postgres 17 descartable y compara la cantidad de filas
   de cada tabla contra la base viva (`scripts/respaldo/ensayo-restauracion.sh`);
3. lo cifra con AES-256 y lo guarda como artifact del run, **14 días**.

Si el volcado o el ensayo fallan, el job queda en rojo y GitHub le manda un
correo a quien modificó este workflow por última vez.

Complementa, no reemplaza, lo que ya existía: `npm run respaldo` (manual, JSON
de `public`) y la copia diaria que trae Supabase Pro cuando se contrate.

## Por qué va cifrado aunque sea "nuestro" GitHub

El repositorio es **público**. Cualquier persona con cuenta de GitHub puede
bajar los artifacts de un run y leer sus logs. Por eso:

- nada sale del runner sin cifrar;
- los logs muestran solo totales y nombres de tabla (que ya están en las
  migraciones), nunca cantidades por tabla ni errores de `pg_restore`, que
  pueden citar filas;
- sin `RESPALDO_CLAVE` el archivo no sirve para nada, **tampoco para nosotros**:
  si se pierde la clave, se pierden los respaldos.

## Puesta en marcha (una sola vez)

En GitHub → el repo → **Settings → Secrets and variables → Actions → New
repository secret**:

| Secreto | De dónde sale |
|---|---|
| `SUPABASE_DB_URL` | Supabase → proyecto → **Connect** → *Session pooler* (no el *Direct*: los runners de GitHub no tienen IPv6). Queda así: `postgresql://postgres.dirugpkamzgvyshcnsxs:CONTRASEÑA@aws-…pooler.supabase.com:5432/postgres`, con la contraseña de la base en lugar de `[YOUR-PASSWORD]`. |
| `RESPALDO_CLAVE` | Una frase larga inventada (24 caracteres o más). **Guardarla también fuera de GitHub** (gestor de contraseñas): GitHub no deja volver a leer un secreto. |

Después: **Actions → respaldo → Run workflow**, y mirar que termine en verde.
El log del paso "Ensayo de restauración" dice cuántas tablas comparó y cuánto
tardó la restauración.

## Cómo se usa un respaldo

Bajar el artifact (Actions → el run → *Artifacts*, o
`gh run download <id> -n respaldo-<id>`) y abrirlo:

```bash
gpg -d respaldo.tar.gpg | tar -x     # pide la RESPALDO_CLAVE
```

Adentro: `eos.dump` (el volcado), `informe.tsv` (filas por tabla, viva vs.
restaurada), `restauracion-errores.log`.

**Recuperar filas puntuales** (alguien borró algo): restaurar en un Postgres
local y copiar de ahí lo que haga falta.

```bash
createdb eos_recuperado
pg_restore --no-owner --no-privileges -d eos_recuperado eos.dump
```

**Volver a levantar la base entera en un proyecto nuevo de Supabase:** el
esquema sale de las migraciones y los datos del volcado.

```bash
npx supabase link --project-ref <nuevo>
npx supabase db push
# auth primero: public tiene claves foráneas a auth.users
PGOPTIONS="-c session_replication_role=replica" pg_restore --data-only --no-owner \
  -n auth -t users -t identities -d "$URL_NUEVA" eos.dump
PGOPTIONS="-c session_replication_role=replica" pg_restore --data-only --no-owner \
  -n public -d "$URL_NUEVA" eos.dump
```

Si una tabla que las migraciones ya siembran (por ejemplo `planes`) choca por
clave duplicada, vaciarla y repetir esa tabla. **Este segundo camino no está
ensayado**: lo que se prueba cada noche es que el volcado vuelve completo, no
la carga en un proyecto de Supabase nuevo. Además, los objetos que viven en la
base sin migración (ver `docs/rollback-runbook.md`) no están en las
migraciones y hay que revisarlos.

## Lo que NO cubre

- Los archivos de Storage (solo sus filas en `storage.objects`, no el contenido).
- `vault`, `cron` y el resto de los esquemas internos de Supabase: se recrean
  con las migraciones; los secretos del vault se vuelven a cargar a mano.
- Volver a un minuto exacto: eso es PITR (Supabase Pro + complemento).
