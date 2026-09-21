-- v187 — Calendario de EOS: la agenda propia de cada persona.
--
-- El calendario junta lo que EOS ya sabe (tareas y oportunidades del CRM,
-- vencimientos de cobros y pagos, metas, decisiones a revisar, cuotas y
-- tarjetas) con lo que la persona quiere anotar a mano: una cita, un
-- recordatorio, un trabajo que hizo. Lo primero se LEE de las tablas de cada
-- módulo, sin copiarlo. Esta tabla guarda solo lo segundo.
--
-- Por qué no reutiliza `eos_crm_actividades`: esa tabla es del módulo CRM, que
-- se contrata. Alguien sin CRM también tiene citas y recordatorios, y no
-- corresponde que anotar "llamar al contador" dependa de un anexo.
--
-- Sin `begin;`/`commit;`: `db push` ya envuelve el archivo en su transacción.

create table if not exists public.eos_calendario_eventos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  titulo text not null check (length(btrim(titulo)) between 1 and 200),
  detalle text check (detalle is null or length(detalle) <= 4000),

  -- Las cinco cosas que la persona anota a mano. El resto de las categorías
  -- del calendario (cobro, pago, meta) vienen de otras tablas y no se guardan.
  categoria text not null default 'actividad'
    check (categoria in ('agenda', 'recordatorio', 'actividad', 'seguimiento', 'trabajo')),

  fecha date not null,
  -- Sin hora = todo el día. Es lo más común (un vencimiento, un pendiente) y
  -- obligar a inventar una hora crea eventos que "vencen" a las 00:00.
  hora_inicio time,
  hora_fin time,

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'hecho', 'cancelado')),

  -- Con quién es. Texto libre y no una referencia: los contactos son parte del
  -- CRM/ERP, y esta tabla tiene que funcionar sin ninguno de los dos.
  contacto_nombre text check (contacto_nombre is null or length(btrim(contacto_nombre)) <= 160),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint eos_calendario_hora_fin_check
    check (hora_fin is null or hora_inicio is null or hora_fin >= hora_inicio),
  constraint eos_calendario_fin_sin_inicio_check
    check (hora_fin is null or hora_inicio is not null)
);

create index if not exists eos_calendario_usuario_fecha_idx
  on public.eos_calendario_eventos (usuario_id, fecha);

-- Lo que quedó sin hacer: es lo que arma la lista de atrasados sin recorrer
-- todo el historial.
create index if not exists eos_calendario_pendientes_idx
  on public.eos_calendario_eventos (usuario_id, fecha)
  where estado = 'pendiente';

comment on table public.eos_calendario_eventos is
  'Agenda propia de cada usuario: citas, recordatorios, actividades, seguimientos y trabajos anotados a mano. El resto del calendario se lee de las tablas de cada módulo.';

alter table public.eos_calendario_eventos enable row level security;

drop policy if exists calendario_select on public.eos_calendario_eventos;
create policy calendario_select on public.eos_calendario_eventos
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists calendario_insert on public.eos_calendario_eventos;
create policy calendario_insert on public.eos_calendario_eventos
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists calendario_update on public.eos_calendario_eventos;
create policy calendario_update on public.eos_calendario_eventos
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists calendario_delete on public.eos_calendario_eventos;
create policy calendario_delete on public.eos_calendario_eventos
  for delete to authenticated using ((select auth.uid()) = usuario_id);

-- Toda tabla con datos de una persona se cierra a `anon` (ver v72).
revoke all on table public.eos_calendario_eventos from public, anon, authenticated;
grant select, insert, update, delete on table public.eos_calendario_eventos to authenticated;
grant select, insert, update, delete on table public.eos_calendario_eventos to service_role;
