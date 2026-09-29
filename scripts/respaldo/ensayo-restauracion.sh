#!/usr/bin/env bash
# Restaura un volcado en un Postgres descartable y compara, tabla por tabla,
# la cantidad de filas contra la base viva. Lo corre .github/workflows/respaldo.yml.
#
#   SUPABASE_DB_URL=... ENSAYO_URL=postgresql://postgres:x@localhost:5432/postgres \
#   DUMP=salida/eos.dump SALIDA=salida bash scripts/respaldo/ensayo-restauracion.sh
#
# Un respaldo que nunca se restauró no es un respaldo: es un archivo. Esto lo
# restaura CADA noche, así que el día que haga falta de verdad ya se sabe que
# vuelve y cuánto tarda.
#
# LOS LOGS SON PÚBLICOS (el repositorio lo es). Por pantalla salen solo nombres
# de tabla y totales; las cantidades por tabla y los errores de pg_restore
# (que pueden citar filas) van a $SALIDA, que el workflow cifra antes de subir.
set -euo pipefail
: "${SUPABASE_DB_URL:?falta SUPABASE_DB_URL}" "${ENSAYO_URL:?falta ENSAYO_URL}"
: "${DUMP:?falta DUMP}" "${SALIDA:?falta SALIDA}"

ENSAYO_DB="${ENSAYO_URL%/*}/ensayo"
inicio=$(date +%s)

psql "$ENSAYO_URL" -q -v ON_ERROR_STOP=1 -c "drop database if exists ensayo" -c "create database ensayo"

# Lo mínimo de Supabase para que el esquema entre: los roles que nombran las
# políticas y las extensiones que usan los defaults. Lo demás (pg_cron, vault,
# realtime) no hace falta para saber si los DATOS volvieron.
psql "$ENSAYO_DB" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role','authenticator',
    'supabase_admin','supabase_auth_admin','supabase_storage_admin','dashboard_user',
    'supabase_realtime_admin','pgbouncer'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
alter database ensayo set search_path = public, extensions;
SQL

# pg_restore sigue ante errores (objetos de extensiones que acá no existen) y
# los cuenta. Lo que decide si el ensayo pasó son las filas, no ese número.
set +e
pg_restore --no-owner --no-privileges --dbname="$ENSAYO_DB" "$DUMP" \
  2> "$SALIDA/restauracion-errores.log"
set -e
errores=$(grep -c "^pg_restore: error" "$SALIDA/restauracion-errores.log" || true)

CONTEO=$(cat <<'SQL'
select format('%I.%I', schemaname, tablename),
       (xpath('/row/n/text()',
              query_to_xml(format('select count(*) as n from %I.%I', schemaname, tablename),
                           false, true, '')))[1]::text
from pg_tables
where schemaname = 'public' or (schemaname = 'auth' and tablename in ('users', 'identities'))
order by 1
SQL
)

# Primero la restaurada y después la viva: entre medio solo puede haber
# entrado algo nuevo, y la tolerancia de abajo lo absorbe.
psql "$ENSAYO_DB" -At -F $'\t' -c "$CONTEO" > "$SALIDA/filas-restauradas.tsv"
psql "$SUPABASE_DB_URL" -At -F $'\t' -c "$CONTEO" > "$SALIDA/filas-vivas.tsv"

# Tolerancia: lo que pudo cambiar en los minutos entre el volcado y el conteo.
# 2 % o 5 filas, lo que sea mayor. Una tabla que no volvió da 0 o "falta".
awk -F '\t' '
  NR == FNR { rest[$1] = $2; next }
  {
    vivo = $2 + 0; tol = int(vivo * 0.02); if (tol < 5) tol = 5
    if (!($1 in rest)) { estado = "FALTA" }
    else { d = vivo - rest[$1]; if (d < 0) d = -d; estado = (d <= tol) ? "ok" : "DIFIERE" }
    print $1 "\t" vivo "\t" (($1 in rest) ? rest[$1] : "-") "\t" estado
  }
' "$SALIDA/filas-restauradas.tsv" "$SALIDA/filas-vivas.tsv" > "$SALIDA/informe.tsv"

total=$(wc -l < "$SALIDA/informe.tsv")
malas=$(awk -F '\t' '$4 != "ok"' "$SALIDA/informe.tsv" | wc -l)
segundos=$(( $(date +%s) - inicio ))

echo "tablas comparadas: $total · fuera de tolerancia: $malas · errores de pg_restore: $errores · restauración: ${segundos}s"

if [ "$total" -lt 10 ]; then
  echo "::error::Se compararon $total tablas: la consulta de la base viva o la restauración no trajo nada."
  exit 1
fi

if [ "$malas" -gt 0 ]; then
  awk -F '\t' '$4 != "ok" { print "::error::" $4 ": " $1 }' "$SALIDA/informe.tsv"
  exit 1
fi

echo "El respaldo se restauró completo."
