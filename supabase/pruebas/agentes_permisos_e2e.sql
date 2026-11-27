-- Permisos de los agentes contra la base REAL (v267).
--
-- Se corre DESPUÉS de aplicar la v267 (o concatenada a ella para ensayarla:
-- no lleva `commit`, y termina en `rollback`):
--
--   npx supabase db query --linked -f supabase/pruebas/agentes_permisos_e2e.sql
--
-- Devuelve una fila por comprobación (`ok = true` en todas). A diferencia del
-- test de PGlite (lib/sql/agentes-infra.test.ts), esto mira TODAS las
-- funciones y tablas de producción, de todos los schemas, con las extensiones
-- de Supabase incluidas: lo que un rol de agente puede tocar fuera de
-- `agentes` tiene que ser nada.

begin;

with agentes_roles as (
  select r.oid, r.rolname
  from pg_roles r
  where r.rolname ~ '^agente_[a-z]+$'
),
funciones_expuestas as (
  select a.rolname, p.oid::regprocedure::text as funcion
  from agentes_roles a
  cross join pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname not in ('agentes', 'pg_catalog', 'information_schema')
    and has_schema_privilege(a.oid, n.oid, 'USAGE')
    and has_function_privilege(a.oid, p.oid, 'EXECUTE')
),
tablas_expuestas as (
  select a.rolname, c.oid::regclass::text as tabla
  from agentes_roles a
  cross join pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'v', 'm', 'p', 'f')
    and n.nspname not in ('pg_catalog', 'information_schema')
    and has_schema_privilege(a.oid, n.oid, 'USAGE')
    and (
      has_table_privilege(a.oid, c.oid, 'SELECT')
      or has_table_privilege(a.oid, c.oid, 'INSERT')
      or has_table_privilege(a.oid, c.oid, 'UPDATE')
      or has_table_privilege(a.oid, c.oid, 'DELETE')
    )
)
select 'existen los seis roles de agente' as prueba,
       (select count(*) from agentes_roles) = 6 as ok,
       (select string_agg(rolname, ', ') from agentes_roles) as detalle
union all
select 'ningún agente ejecuta una SECURITY DEFINER fuera de agentes',
       not exists (select 1 from funciones_expuestas),
       (select string_agg(rolname || ' → ' || funcion, '; ') from (select * from funciones_expuestas limit 20) f)
union all
-- La única excepción conocida: pg_net le da a PUBLIC uso del schema `net` y
-- todos los permisos sobre su cola. Lo otorgó `supabase_admin` y `postgres`
-- no lo puede revocar (probado el 27/11/2026: el revoke no hace nada). Ver
-- docs/agentes/operar.md, "Lo que la base no puede cerrar".
select 'ningún agente lee ni escribe una tabla fuera de agentes (salvo la cola de pg_net)',
       not exists (
         select 1 from tablas_expuestas
         where tabla not like 'agentes.%'
           and tabla not in ('net.http_request_queue', 'net._http_response')
       ),
       (select string_agg(rolname || ' → ' || tabla, '; ') from (
          select * from tablas_expuestas
          where tabla not like 'agentes.%' and tabla not in ('net.http_request_queue', 'net._http_response')
          limit 20) t)
union all
select 'la cola de pg_net sigue abierta a PUBLIC (conocido: avisa si Supabase lo cierra)',
       true,
       (select string_agg(distinct tabla, ', ') from tablas_expuestas where tabla like 'net.%')
union all
select 'ningún agente lee las tablas de agentes directo',
       not exists (select 1 from tablas_expuestas where tabla like 'agentes.%'),
       null
union all
select 'ninguna SECURITY DEFINER de public quedó abierta a PUBLIC',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef
           and (p.proacl is null or exists (
             select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
       ),
       null
union all
select 'service_role sigue pudiendo cobrar (eos_process_manual_payment_v42)',
       coalesce((
         select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'eos_process_manual_payment_v42'
       ), true),
       null
union all
select 'los seis agentes nacen apagados y sin versión aprobada',
       (select count(*) from agentes.agent_config where not activo and version_aprobada is null) = 6,
       null
union all
select 'anon no ve el schema agentes',
       not has_schema_privilege('anon', 'agentes', 'USAGE'),
       null;

rollback;
