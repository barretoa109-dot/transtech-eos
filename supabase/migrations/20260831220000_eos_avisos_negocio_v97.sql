-- Recordar qué aviso del negocio ya se mandó (v97).
--
-- ============================================================
-- POR QUÉ HACE FALTA UNA TABLA
-- ============================================================
--
-- El detector de riesgos del negocio (`lib/erp/riesgos-negocio.ts`) encuentra
-- el MISMO problema todos los días hasta que se resuelve: si hoy faltan harina
-- y levadura, mañana también. Mandar ese aviso cinco veces es exactamente lo
-- que entrena a la gente a ignorar las notificaciones — y una alerta ignorada
-- es peor que ninguna, porque deja la sensación de estar cubierto.
--
-- El faltante de plata ya resuelve esto con `eos_finanzas_avisos_riesgo`,
-- comparando fecha y monto. Acá la regla es distinta y más exacta: cada riesgo
-- trae una CLAVE armada con los ids de lo que lo compone. Misma clave, mismo
-- problema, no se avisa.
--
-- ============================================================
-- UNA FILA POR TIPO, NO UN HISTORIAL
-- ============================================================
--
-- La primera versión de esto tenía un `unique` sobre (usuario, tipo, clave), o
-- sea un historial permanente. Estaba mal: si el usuario repone la harina y dos
-- meses después se le vuelve a acabar, la clave es la misma y el aviso nunca
-- llegaría. El problema volvió, y eso SÍ es una noticia.
--
-- Entonces se guarda solo el ÚLTIMO aviso de cada tipo. Cuando el riesgo
-- desaparece, la fila se borra, y el día que vuelva se avisa de nuevo aunque
-- sean los mismos productos.

create table if not exists public.eos_negocio_avisos (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('inventario_bajo', 'cobros_demorados')),
  clave text not null,
  enviado_en timestamptz not null default now(),
  primary key (usuario_id, tipo)
);

comment on table public.eos_negocio_avisos is
  'v97: el último aviso de riesgo del negocio enviado por tipo, para no repetir el mismo problema todos los días.';

alter table public.eos_negocio_avisos enable row level security;

drop policy if exists eos_negocio_avisos_select_own on public.eos_negocio_avisos;
create policy eos_negocio_avisos_select_own
  on public.eos_negocio_avisos
  for select to authenticated
  using ((select auth.uid()) = usuario_id);

-- La regla del proyecto: toda tabla con datos de una persona le revoca todo a
-- `anon`. Un aviso dice qué le falta y a quién le deben; no es público.
revoke all on table public.eos_negocio_avisos from public, anon, authenticated;
grant select on table public.eos_negocio_avisos to authenticated;
grant all on table public.eos_negocio_avisos to service_role;
