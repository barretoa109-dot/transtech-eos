-- Que quien entre con Google llegue con su nombre (v81).
--
-- `handle_new_user` busca el nombre en `raw_user_meta_data->>'nombre'`, que es
-- la clave que manda NUESTRO formulario de registro. Google no manda esa clave:
-- manda `full_name` y `name`. Sin esto, quien entra con Google queda llamándose
-- por la parte izquierda de su correo —"augusto" en vez de "Augusto Galeano"—
-- y ese nombre es el que después aparece en el saludo del chat, en el briefing
-- diario y en el comprobante.
--
-- Se corrige en el trigger y no en el callback a propósito: el callback nunca
-- escribe el perfil, y hacer una excepción ahí abriría la puerta a que el
-- cliente decida qué plan tiene. El trigger sigue siendo el único dueño.
--
-- El orden importa. `nombre` primero, porque si vino es porque la persona lo
-- escribió; después lo que declare el proveedor; y recién al final el correo,
-- que es lo que había antes y sigue siendo mejor que "Usuario".

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_nombre text;
  v_whatsapp text;
begin
  v_nombre := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'nombre'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuario'
    ),
    160
  );

  v_whatsapp := nullif(
    left(btrim(coalesce(new.raw_user_meta_data ->> 'whatsapp', '')), 40),
    ''
  );

  insert into public.usuarios (
    id,
    nombre,
    email,
    whatsapp,
    plan
  ) values (
    new.id,
    v_nombre,
    new.email,
    v_whatsapp,
    'free'
  )
  on conflict (id) do update
  set
    nombre = excluded.nombre,
    email = excluded.email,
    whatsapp = excluded.whatsapp;

  return new;
end;
$function$;
