-- Blindaje de public.mensajes.usuario_id
--
-- Contexto: las políticas RLS de `mensajes` (select/insert/delete) exigen
-- `usuario_id = auth.uid()`, pero la columna era nullable, sin default ni
-- trigger. Cualquier cliente que olvidara enviar `usuario_id` producía uno
-- de estos dos fallos silenciosos:
--   * el INSERT era rechazado por el with_check de la política, o
--   * (con service_role, que evita RLS) la fila quedaba con usuario_id NULL
--     y por lo tanto invisible para su propio dueño.
-- Esto ya rompió el historial de chat en producción: se acumularon ~9.861
-- filas huérfanas (usuario_id y conversacion_id en NULL) que hubo que purgar.
--
-- Esta migración lo hace estructuralmente imposible de repetir.

-- 1) Completar usuario_id automáticamente en el INSERT.
--    Prioridad: el valor explícito que mande el cliente > auth.uid() (camino
--    normal desde el navegador) > el dueño de la conversación (camino del
--    backend/n8n con service_role, donde auth.uid() es NULL).
create or replace function public.mensajes_set_usuario_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.usuario_id is null then
    new.usuario_id := auth.uid();
  end if;

  if new.usuario_id is null and new.conversacion_id is not null then
    select c.usuario_id
      into new.usuario_id
      from public.conversaciones c
     where c.id = new.conversacion_id;
  end if;

  if new.usuario_id is null then
    raise exception
      'mensajes.usuario_id no pudo determinarse (conversacion_id=%). Enviá usuario_id explícitamente o insertá con una sesión autenticada.',
      new.conversacion_id
      using errcode = 'not_null_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists mensajes_set_usuario_id_trg on public.mensajes;

create trigger mensajes_set_usuario_id_trg
  before insert on public.mensajes
  for each row
  execute function public.mensajes_set_usuario_id();

-- 2) Cinturón y tirantes: aunque el trigger ya garantiza el valor, dejamos la
--    columna NOT NULL para que ninguna ruta futura (otro trigger, un COPY,
--    una migración) pueda volver a insertar filas huérfanas.
--    Seguro de ejecutar: las filas con NULL ya fueron purgadas.
do $$
begin
  if exists (select 1 from public.mensajes where usuario_id is null) then
    raise exception 'Todavía hay mensajes con usuario_id NULL; purgalos antes de aplicar el NOT NULL.';
  end if;
end;
$$;

alter table public.mensajes
  alter column usuario_id set not null;

-- 3) Índice para la consulta real del historial (mensajes de una conversación
--    en orden cronológico), que hoy hace un scan por conversacion_id.
create index if not exists mensajes_conversacion_created_idx
  on public.mensajes (conversacion_id, created_at);
