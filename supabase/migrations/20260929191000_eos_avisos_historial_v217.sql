-- v217: la historia de los avisos y el tope de dos por día.
--
-- Dos tareas del tablero de lanzamiento con la misma raíz:
--
--   encargado-05  Como máximo dos avisos no pedidos por día y por cuenta. Hoy
--                 negocio, finanzas y CRM avisan cada uno por su lado desde el
--                 cron de la mañana: una cuenta con todo prendido podía recibir
--                 tres avisos el mismo día, y así se apagan las notificaciones.
--   negocio-02    Guardar la historia de los avisos de stock. `eos_negocio_avisos`
--                 BORRA el aviso cuando el problema se resuelve (es lo que evita
--                 repetirlo), así que el informe no puede decir "te avisé tres
--                 veces antes de que se acabe".
--
-- Una fila por aviso que se intentó dar, que NO se borra nunca (salvo con la
-- cuenta). `eos_reservar_aviso_v217` toma un lugar de los dos del día con un
-- candado por cuenta y fecha: negocio, finanzas y CRM corren en paralelo y
-- sin candado los tres verían "0 usados". Lo que queda fuera del tope se anota
-- como `sobre_el_tope` y, como no se entregó, el emisor lo vuelve a intentar al
-- día siguiente si el problema sigue.
--
-- La agenda del día no pasa por acá: son recordatorios de lo que la persona
-- misma agendó.
--
-- Solo el service role.

create table if not exists public.eos_avisos_historial_v217 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  fecha date not null,
  familia text not null check (familia in ('negocio', 'finanzas', 'crm')),
  tipo text not null,
  clave text,
  resultado text not null default 'reservado'
    check (resultado in ('reservado', 'entregado', 'sin_canal', 'sobre_el_tope')),
  creado_en timestamptz not null default now()
);

create index if not exists eos_avisos_historial_v217_dia
  on public.eos_avisos_historial_v217 (usuario_id, fecha);

create index if not exists eos_avisos_historial_v217_tipo
  on public.eos_avisos_historial_v217 (usuario_id, tipo, creado_en desc);

alter table public.eos_avisos_historial_v217 enable row level security;

revoke all on table public.eos_avisos_historial_v217 from public, anon, authenticated;
grant select, insert, update on table public.eos_avisos_historial_v217 to service_role;

comment on table public.eos_avisos_historial_v217 is
  'Cada aviso no pedido que se intentó dar (negocio, finanzas, CRM) y cómo terminó. No se borra: es la historia. Solo service_role.';

create or replace function public.eos_reservar_aviso_v217(
  p_usuario_id uuid,
  p_fecha date,
  p_familia text,
  p_tipo text,
  p_clave text,
  p_tope integer default 2
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_usados integer;
  v_id uuid;
begin
  -- Negocio, finanzas y CRM corren a la vez: el candado ordena a los tres.
  perform pg_advisory_xact_lock(hashtextextended('eos-aviso:' || p_usuario_id::text || ':' || p_fecha::text, 0));

  select count(*) into v_usados
  from public.eos_avisos_historial_v217
  where usuario_id = p_usuario_id
    and fecha = p_fecha
    and resultado in ('reservado', 'entregado');

  if v_usados >= greatest(coalesce(p_tope, 2), 0) then
    insert into public.eos_avisos_historial_v217 (usuario_id, fecha, familia, tipo, clave, resultado)
    values (p_usuario_id, p_fecha, p_familia, p_tipo, left(p_clave, 500), 'sobre_el_tope');
    return null;
  end if;

  insert into public.eos_avisos_historial_v217 (usuario_id, fecha, familia, tipo, clave, resultado)
  values (p_usuario_id, p_fecha, p_familia, p_tipo, left(p_clave, 500), 'reservado')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.eos_reservar_aviso_v217(uuid, date, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.eos_reservar_aviso_v217(uuid, date, text, text, text, integer) to service_role;

comment on function public.eos_reservar_aviso_v217(uuid, date, text, text, text, integer) is
  'Toma uno de los avisos del día de una cuenta (tope 2). Devuelve el id de la reserva, o null si ya no hay lugar (y lo anota como sobre_el_tope).';
