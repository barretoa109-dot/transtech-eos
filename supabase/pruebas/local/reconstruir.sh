#!/usr/bin/env bash
# Reconstruye la base desde cero con TODAS las migraciones sobre un Postgres
# local y corre la prueba de aislamiento entre cuentas.
#
#   sudo -u postgres bash supabase/pruebas/local/reconstruir.sh [nombre_base]
#
# Cada migración corre en su propia transacción (-1), igual que `supabase db push`.
# `create extension pg_cron` se saltea: cron.* existe como stub en bootstrap.sql.
set -euo pipefail
BASE="${1:-eos_local}"
RAIZ="$(cd "$(dirname "$0")/../../.." && pwd)"

dropdb --if-exists "$BASE"
createdb "$BASE"
psql -q -v ON_ERROR_STOP=1 -d "$BASE" -f "$RAIZ/supabase/pruebas/local/bootstrap.sql" 2>&1 | grep -v "NOTICE\|wal_level\|HINT" || true
psql -q -d "$BASE" -c "alter database \"$BASE\" set search_path = public, extensions"

n=0
for f in $(ls "$RAIZ"/supabase/migrations/*.sql | sort); do
  n=$((n + 1))
  if ! sed 's/create extension if not exists pg_cron;/-- pg_cron (stub)/' "$f" \
      | psql -1 -q -v ON_ERROR_STOP=1 -d "$BASE" > /dev/null 2> /tmp/eos_migracion_error.txt; then
    echo "FALLÓ la migración #$n: $(basename "$f")"
    cat /tmp/eos_migracion_error.txt
    exit 1
  fi
done
echo "$n migraciones aplicadas desde cero."

psql -d "$BASE" -f "$RAIZ/supabase/pruebas/aislamiento_rls_e2e.sql" 2>/dev/null | grep -E "\| [tf]$"
