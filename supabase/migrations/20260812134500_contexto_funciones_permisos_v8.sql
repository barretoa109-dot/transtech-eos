begin;

revoke all on function public.eos_prepare_master_context() from public, anon, authenticated;
grant execute on function public.eos_prepare_master_context() to service_role;

commit;
