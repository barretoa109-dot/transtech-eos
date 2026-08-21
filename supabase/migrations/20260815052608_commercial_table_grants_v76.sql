-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

-- EOS RC1 v76
-- Commercial tables are read-only from browser roles.
-- Mutations are owned by server/service-role RPCs and API routes.

revoke all privileges on table public.solicitudes_pago from anon, authenticated;
grant select on table public.solicitudes_pago to authenticated;

revoke all privileges on table public.historial_pagos from anon, authenticated;
grant select on table public.historial_pagos to authenticated;

revoke all privileges on table public.planes from anon, authenticated;
grant select on table public.planes to anon, authenticated;

comment on table public.solicitudes_pago is
  'EOS commercial payment requests. Browser roles are SELECT-only through RLS; mutations are server-owned.';
comment on table public.historial_pagos is
  'EOS payment history. Browser roles are SELECT-only through RLS; mutations are server-owned.';
comment on table public.planes is
  'EOS plan catalog. Browser roles are SELECT-only; mutations are server-owned.';
