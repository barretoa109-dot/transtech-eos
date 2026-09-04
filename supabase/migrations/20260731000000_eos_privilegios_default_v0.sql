-- ============================================================
-- v0 · Los privilegios por defecto que ninguna migración fija nunca
-- ============================================================
--
-- QUÉ SE ENCONTRÓ
--
-- Probando un alta real contra la reconstrucción desde cero, `usuarios` y
-- `eos_onboarding` daban "permission denied" para `service_role` —la clave
-- con la que la aplicación real habla con la base—, aunque las tablas, sus
-- columnas y sus políticas RLS estuvieran perfectas.
--
-- Ninguna de las 190 migraciones existentes tiene un solo `grant` para
-- `eos_onboarding`, y sin embargo en producción service_role SÍ puede
-- leerla y escribirla. La razón está en `pg_default_acl`, no en ninguna
-- migración: hay una regla `ALTER DEFAULT PRIVILEGES` fijada para el
-- esquema `public` que dice "toda tabla, secuencia o función NUEVA que
-- cree postgres (o supabase_admin) le da automáticamente estos permisos a
-- anon, authenticated y service_role". Ninguna migración necesita otorgar
-- nada explícitamente porque esa regla ya lo hace por todas, en el momento
-- en que se crean.
--
-- Eso también explica por qué el problema no apareció en ningún punto
-- anterior de la reconstrucción: la regla faltaba SOLO en el proyecto de
-- validación —no viene con cada proyecto nuevo de Supabase, se fija a
-- mano, igual que las tablas huérfanas—, y ninguna verificación anterior
-- había probado usar una tabla a través de la API real, sólo que existiera.
--
-- POR QUÉ NO ALCANZA CON OTORGAR TABLA POR TABLA
--
-- Se podría enumerar un `grant` por cada una de las 48 tablas huérfanas —de
-- hecho el primer intento de este arreglo fue exactamente eso—, pero sería
-- corregir el síntoma que se alcanzó a ver, no la causa: cualquiera de las
-- otras ~140 tablas de las migraciones ordinarias, que tampoco tienen un
-- `grant` propio porque nunca lo necesitaron, tendría el mismo problema en
-- una reconstrucción si esta regla no estuviera. Fijar la regla misma cubre
-- todo de una vez, en vez de perseguir el síntoma tabla por tabla.
--
-- POR QUÉ ANON TAMBIÉN RECIBE PRIVILEGIOS AMPLIOS
--
-- Es lo que hace producción, verificado en su propio catálogo, y no es tan
-- permisivo como suena: el permiso a nivel de tabla es una condición
-- necesaria pero no suficiente. Row Level Security, que este mismo proyecto
-- usa sistemáticamente y que cada migración habilita tabla por tabla, es lo
-- que de verdad decide qué fila puede tocar cada rol. Sin una política RLS
-- que lo permita, tener el `grant` no le abre a `anon` una sola fila.
--
-- Va con fecha anterior al esquema base (v0), para que rija desde la
-- primerísima tabla que se crea.
--
-- Producción tiene esta misma regla fijada DOS veces —una vez para lo que
-- crea `postgres`, otra para lo que crea `supabase_admin`—, pero
-- `ALTER DEFAULT PRIVILEGES FOR ROLE X` sólo lo puede fijar el propio rol X,
-- y la conexión con la que corren las migraciones no puede hablar en nombre
-- de `supabase_admin`. Alcanza con fijarla para `postgres`: es el rol con el
-- que corren las migraciones —incluidas todas las de este repositorio—, así
-- que es la regla que de verdad gobierna cada tabla que se crea acá.

alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to postgres, anon, authenticated, service_role;
