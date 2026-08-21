-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

do $$
declare
  r record;
  function_signature text;
begin
  for r in
    select distinct
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace table_ns on table_ns.oid = c.relnamespace
    join pg_namespace n on n.oid = p.pronamespace
    where not t.tgisinternal
      and table_ns.nspname = 'public'
      and n.nspname = 'public'
      and pg_get_function_result(p.oid) = 'trigger'
  loop
    function_signature := format('%I.%I(%s)', r.nspname, r.proname, r.identity_args);
    execute format('revoke execute on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end
$$;
