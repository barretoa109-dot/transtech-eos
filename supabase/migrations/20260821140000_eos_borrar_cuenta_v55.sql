-- EOS — borrado real de la cuenta y sus datos
--
-- Apple y Google exigen que una app con registro permita borrar la cuenta
-- desde adentro. Pero el motivo real es anterior a las tiendas: la Ley
-- 6534/2020 de protección de datos personales, y el hecho de que un usuario
-- que se va tiene derecho a que sus cosas se vayan con él.
--
-- POR QUÉ NO ALCANZA CON BORRAR DE auth.users:
-- solo 8 tablas tienen `on delete cascade` hacia auth.users. Hay **73 tablas
-- más** con `usuario_id`/`user_id` sin clave foránea: conversaciones,
-- mensajes, documentos, memorias, finanzas, tarjetas de Bancard. Borrar el
-- usuario de auth dejaría todo eso vivo y sin dueño — invisible para RLS,
-- pero presente en la base.
--
-- POR QUÉ ES DINÁMICO:
-- enumerar 73 tablas a mano garantiza que la lista quede vieja: la próxima
-- tabla con `usuario_id` que alguien agregue no va a estar acá, y nadie se va
-- a enterar. Recorrer el catálogo hace que el borrado cubra por definición
-- todo lo que exista hoy y mañana.
--
-- POR QUÉ NO RECIBE PARÁMETRO:
-- usa `auth.uid()`. Es imposible pedirle que borre la cuenta de otro, ni por
-- error ni a propósito.

create or replace function public.eos_borrar_mis_datos_v55()
returns table (tabla text, filas_borradas bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  r record;
  n bigint;
  pendientes text[] := '{}';
  intento int := 0;
  hubo_error boolean;
  ultimo_error text;
begin
  if v_usuario is null then
    raise exception 'Sin sesión' using errcode = 'insufficient_privilege';
  end if;

  -- Hasta 3 pasadas: algunas tablas se referencian entre sí (los chunks de un
  -- documento apuntan al documento), así que un borrado en orden arbitrario
  -- puede chocar con una clave foránea. Reintentar resuelve el orden sin
  -- tener que modelar el grafo de dependencias a mano.
  loop
    intento := intento + 1;
    hubo_error := false;

    for r in
      select c.table_name, c.column_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public'
         and t.table_type = 'BASE TABLE'
         and c.column_name in ('usuario_id', 'user_id')
         and (intento = 1 or c.table_name = any(pendientes))
       order by c.table_name
    loop
      begin
        -- El cast a text es necesario porque no todas las tablas guardan el
        -- id como uuid (`notificaciones.usuario_id` es text). Comparar como
        -- texto cubre las dos formas sin ramificar por tipo.
        execute format('delete from public.%I where %I::text = $1', r.table_name, r.column_name)
          using v_usuario::text;
        get diagnostics n = row_count;

        if n > 0 then
          tabla := r.table_name;
          filas_borradas := n;
          return next;
        end if;

        pendientes := array_remove(pendientes, r.table_name);
      exception
        when others then
          hubo_error := true;
          ultimo_error := sqlerrm;
          if not (r.table_name = any(pendientes)) then
            pendientes := array_append(pendientes, r.table_name);
          end if;
      end;
    end loop;

    exit when not hubo_error or intento >= 3;
  end loop;

  -- Si después de 3 pasadas algo sigue sin poder borrarse, se falla fuerte.
  -- Un borrado a medias es peor que ninguno: el usuario cree que sus datos se
  -- fueron y no es cierto.
  if array_length(pendientes, 1) > 0 then
    raise exception 'No se pudieron borrar las tablas: % (último error: %)',
      array_to_string(pendientes, ', '), ultimo_error;
  end if;

  -- `usuarios` va aparte: su columna es `id`, no `usuario_id`, así que el
  -- recorrido de arriba no la alcanza.
  delete from public.usuarios where id = v_usuario;
  get diagnostics n = row_count;
  if n > 0 then
    tabla := 'usuarios';
    filas_borradas := n;
    return next;
  end if;
end;
$$;

revoke all on function public.eos_borrar_mis_datos_v55() from public;
grant execute on function public.eos_borrar_mis_datos_v55() to authenticated;

comment on function public.eos_borrar_mis_datos_v55() is
  'Borra todos los datos del usuario autenticado recorriendo el catálogo. Dinámico a propósito: una lista fija de tablas queda vieja sin que nadie lo note.';
