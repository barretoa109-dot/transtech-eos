-- EOS 4.0 RC1 v27
-- Trigger functions are implementation details, not client-callable RPCs.
-- Keep automatic trigger execution intact while removing direct EXECUTE grants
-- from public API roles.

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
    function_signature := format(
      '%I.%I(%s)',
      r.nspname,
      r.proname,
      r.identity_args
    );

    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      function_signature
    );

    execute format(
      'grant execute on function %s to service_role',
      function_signature
    );
  end loop;
end
$$;
