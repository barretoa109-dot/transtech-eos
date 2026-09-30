#!/usr/bin/env bash
# El camino de desastre de verdad: la base se levanta desde las migraciones y
# se le cargan los datos del respaldo. Lo corre .github/workflows/respaldo.yml
# después de `ensayo-restauracion.sh`, que ya dejó la base `ensayo`.
#
#   ENSAYO_URL=postgresql://postgres:x@localhost:5432/postgres DUMP=salida/eos.dump \
#   SALIDA=salida bash scripts/respaldo/ensayo-desde-migraciones.sh
#
# El primer ensayo prueba que el volcado vuelve tal cual. Este prueba lo que
# dice docs/respaldo-nocturno.md para un proyecto nuevo: esquema desde
# `supabase/migrations/`, datos desde el volcado. Si una migración no aplica
# desde cero, o producción tiene una tabla o una columna que ninguna migración
# crea, acá se ve — antes del día en que haga falta.
#
# LOS LOGS SON PÚBLICOS: por pantalla salen nombres de migración y de tabla
# (que están en el repositorio) y totales. Las cantidades por tabla y los
# errores de la carga van a $SALIDA, que se cifra.
set -euo pipefail
: "${ENSAYO_URL:?falta ENSAYO_URL}" "${DUMP:?falta DUMP}" "${SALIDA:?falta SALIDA}"

SERVIDOR="${ENSAYO_URL%/*}"
MIG="$SERVIDOR/ensayo_migraciones"
VOLCADO="$SERVIDOR/ensayo"
inicio=$(date +%s)

psql "$ENSAYO_URL" -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists ensayo_migraciones" -c "create database ensayo_migraciones"
psql "$MIG" -q -v ON_ERROR_STOP=1 -f supabase/pruebas/local/bootstrap.sql > /dev/null 2>&1
psql "$ENSAYO_URL" -q -c "alter database ensayo_migraciones set search_path = public, extensions"

# 1. El esquema, migración por migración, como `supabase db push`.
n=0
for f in $(ls supabase/migrations/*.sql | sort); do
  n=$((n + 1))
  if ! sed 's/create extension if not exists pg_cron;/-- pg_cron (stub)/' "$f" \
      | psql -1 -q -v ON_ERROR_STOP=1 -d "$MIG" > /dev/null 2> "$SALIDA/migracion-error.log"; then
    echo "::error::La migración #$n ($(basename "$f")) no aplica desde cero. Detalle en el respaldo cifrado."
    exit 1
  fi
done
echo "esquema: $n migraciones aplicadas desde cero"

# 2. Lo que las migraciones siembran (planes, catálogos) se vacía: los datos
#    vienen del respaldo, no de la semilla.
psql "$MIG" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare t text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ') into t
  from pg_tables where schemaname = 'public';
  if t is not null then execute 'truncate ' || t || ' cascade'; end if;
end $$;
SQL

# 3. Las cuentas de acceso: solo id, correo y alta. El auth.users de acá es el
#    mínimo de bootstrap.sql; el real lo recrea Supabase. Sin triggers: si no,
#    handle_new_user da de alta perfil y módulos, que vienen del respaldo.
psql "$VOLCADO" -q -c "\copy (select id, email, created_at from auth.users) to stdout" \
  | PGOPTIONS="-c session_replication_role=replica" psql "$MIG" -q -c "\copy auth.users (id, email, created_at) from stdin"

# 4. Los datos de public, sin disparar triggers ni revisar claves foráneas
#    mientras entran (el orden de las tablas en el volcado no es el de las FK).
set +e
PGOPTIONS="-c session_replication_role=replica" \
  pg_restore --data-only --no-owner --no-privileges --schema=public --dbname="$MIG" "$DUMP" \
  2> "$SALIDA/migraciones-carga-errores.log"
set -e
errores=$(grep -c "^pg_restore: error" "$SALIDA/migraciones-carga-errores.log" || true)

# 5. Tabla por tabla, contra la primera restauración (que es producción tal cual).
CONTEO=$(cat <<'SQL'
select format('%I.%I', schemaname, tablename),
       (xpath('/row/n/text()',
              query_to_xml(format('select count(*) as n from %I.%I', schemaname, tablename),
                           false, true, '')))[1]::text
from pg_tables where schemaname = 'public' order by 1
SQL
)
psql "$VOLCADO" -At -F $'\t' -c "$CONTEO" > "$SALIDA/filas-produccion.tsv"
psql "$MIG" -At -F $'\t' -c "$CONTEO" > "$SALIDA/filas-desde-migraciones.tsv"

awk -F '\t' '
  NR == FNR { mig[$1] = $2; next }
  {
    if (!($1 in mig)) estado = "FALTA_EN_MIGRACIONES"
    else if (mig[$1] + 0 != $2 + 0) estado = "DIFIERE"
    else estado = "ok"
    print $1 "\t" $2 "\t" (($1 in mig) ? mig[$1] : "-") "\t" estado
  }
' "$SALIDA/filas-desde-migraciones.tsv" "$SALIDA/filas-produccion.tsv" > "$SALIDA/informe-migraciones.tsv"

total=$(wc -l < "$SALIDA/informe-migraciones.tsv")
malas=$(awk -F '\t' '$4 != "ok"' "$SALIDA/informe-migraciones.tsv" | wc -l)
echo "tablas: $total · distintas: $malas · errores de carga: $errores · $(( $(date +%s) - inicio ))s"

if [ "$malas" -gt 0 ]; then
  awk -F '\t' '$4 != "ok" { print "::error::" $4 ": " $1 }' "$SALIDA/informe-migraciones.tsv"
  exit 1
fi

echo "La base se levanta desde las migraciones y el respaldo entra completo."
