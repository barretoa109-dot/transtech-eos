-- ============================================================
-- v0 · gen_random_bytes fuera del search_path que usa `db push`
-- ============================================================
--
-- QUÉ PASABA
--
-- Al reconstruir desde cero, la migración siguiente
-- (eos_finanzas_buzon_v53) falla con:
--
--   ERROR: function gen_random_bytes(integer) does not exist
--
-- La extensión pgcrypto está instalada —en el esquema `extensions`, como
-- hace Supabase por defecto—, y `select gen_random_bytes(12)` funciona sin
-- problema por `db query` o desde el SQL Editor del panel. El problema es
-- puntual de `db push`: ejecuta cada migración con un `search_path` más
-- restrictivo que el de una sesión normal, y ese search_path no incluye
-- `extensions`. Por eso una llamada sin calificar a `gen_random_bytes(...)`
-- —tal como está escrita en eos_finanzas_buzon_v53— no resuelve.
--
-- POR QUÉ UN PUENTE Y NO EDITAR LA MIGRACIÓN QUE FALLA
--
-- eos_finanzas_buzon_v53 ya está aplicada en producción: es una migración
-- pasada, y las migraciones pasadas no se editan, se corrigen hacia
-- adelante. Este archivo agrega en `public` —que sí está en el search_path
-- restringido— una función que sólo reenvía a la de `extensions`, para que
-- la llamada sin calificar de la migración siguiente encuentre algo.
--
-- No es necesaria en producción: ahí la extensión ya resuelve por otra vía
-- (probablemente porque la aplicación original no pasó por este mismo
-- search_path acotado). Se marca como aplicada sin ejecutar en
-- producción, igual que el resto de las migraciones "v0".

create or replace function public.gen_random_bytes(integer)
returns bytea
language sql
immutable
as $$
  select extensions.gen_random_bytes($1);
$$;

comment on function public.gen_random_bytes(integer) is
  'Reenvío a extensions.gen_random_bytes(), para que las llamadas sin calificar resuelvan bajo el search_path restringido que usa `supabase db push`.';
