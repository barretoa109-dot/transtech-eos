begin;

alter table public.dashboard_resumen enable row level security;

create index if not exists dashboard_resumen_usuario_idx_v16
  on public.dashboard_resumen (usuario_id);

drop policy if exists dashboard_resumen_select_own_v16
  on public.dashboard_resumen;

create policy dashboard_resumen_select_own_v16
on public.dashboard_resumen
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid())::text = usuario_id
);

-- La vista debe respetar permisos y RLS del usuario que la consulta.
alter view public.dashboard_usuario
  set (security_invoker = true);

-- La capa cliente solo necesita lectura propia.
revoke all on table public.dashboard_resumen from anon, authenticated;
grant select on table public.dashboard_resumen to authenticated;
grant all on table public.dashboard_resumen to service_role;

revoke all on table public.dashboard_usuario from anon, authenticated;
grant select on table public.dashboard_usuario to authenticated;
grant select on table public.dashboard_usuario to service_role;

comment on view public.dashboard_usuario is
  'Vista de dashboard con security_invoker; el aislamiento se aplica mediante RLS de dashboard_resumen.';

commit;
