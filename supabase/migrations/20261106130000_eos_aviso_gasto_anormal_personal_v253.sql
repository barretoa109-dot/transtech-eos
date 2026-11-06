-- El aviso de "gasto anormal" ya existe para el negocio (v128,
-- `eos_negocio_avisos`). Esta migración le da el mismo mecanismo de dedup a
-- las finanzas PERSONALES — el mismo detector (`lib/erp/gasto-anormal.ts`,
-- genérico, sin nada específico del ERP) se reutiliza, pero la tabla de
-- avisos es propia: `eos_negocio_avisos` es del negocio por nombre y por
-- intención (ver su comentario, v97), y la regla del proyecto es que la plata
-- del negocio y la de la persona van separadas (ver eos_finanzas_ambito).
--
-- Mismo diseño que v97: una fila por tipo, no un historial. Cuando el riesgo
-- desaparece, la fila se borra; si vuelve, la clave cambia (son otros
-- movimientos) y se avisa de nuevo.

create table if not exists public.eos_finanzas_avisos (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('gasto_anormal')),
  clave text not null,
  enviado_en timestamptz not null default now(),
  primary key (usuario_id, tipo)
);

comment on table public.eos_finanzas_avisos is
  'v253: el último aviso de riesgo de las finanzas PERSONALES enviado por tipo, para no repetir el mismo problema todos los días. Paralela a eos_negocio_avisos (v97), que es la del negocio.';

alter table public.eos_finanzas_avisos enable row level security;

drop policy if exists eos_finanzas_avisos_select_own on public.eos_finanzas_avisos;
create policy eos_finanzas_avisos_select_own
  on public.eos_finanzas_avisos
  for select to authenticated
  using ((select auth.uid()) = usuario_id);

-- Misma regla del proyecto que v97: toda tabla con datos de una persona le
-- revoca todo a `anon`. Dice qué gasto le pareció raro a EOS; no es público.
revoke all on table public.eos_finanzas_avisos from public, anon, authenticated;
grant select on table public.eos_finanzas_avisos to authenticated;
grant all on table public.eos_finanzas_avisos to service_role;
