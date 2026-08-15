begin;

alter table public.acciones_activas enable row level security;
alter table public.archivos_generados enable row level security;

drop policy if exists "allow all acciones activas" on public.acciones_activas;
drop policy if exists "allow all archivos_generados" on public.archivos_generados;

revoke all privileges on table public.acciones_activas from anon, authenticated;
revoke all privileges on table public.archivos_generados from anon, authenticated;

grant all privileges on table public.acciones_activas to service_role;
grant all privileges on table public.archivos_generados to service_role;

comment on table public.acciones_activas is
  'RC1 v66: tabla legacy service-only; removida la antigua policy PUBLIC allow-all.';
comment on table public.archivos_generados is
  'RC1 v66: tabla legacy service-only; removida la antigua policy PUBLIC allow-all.';

commit;
