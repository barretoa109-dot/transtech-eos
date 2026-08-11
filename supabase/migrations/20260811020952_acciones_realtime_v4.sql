do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'eos_action_commands'
  ) then
    alter publication supabase_realtime
      add table public.eos_action_commands;
  end if;
end;
$$;
