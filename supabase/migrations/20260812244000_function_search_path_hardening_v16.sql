begin;

alter function public.eos_actualizar_updated_at()
  set search_path = '';

alter function public.eos_periodo_actual()
  set search_path = '';

revoke all on function public.eos_actualizar_updated_at()
  from public, anon, authenticated;
grant execute on function public.eos_actualizar_updated_at()
  to service_role;

comment on function public.eos_actualizar_updated_at() is
  'Trigger interno con search_path inmutable y RPC cliente revocado.';
comment on function public.eos_periodo_actual() is
  'Helper estable de periodo comercial con search_path inmutable.';

commit;
