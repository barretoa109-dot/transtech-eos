-- "Eliminar mi cuenta" estaba roto para toda cuenta con historial.
--
-- ============================================================
-- EL CASO QUE LO EXPUSO
-- ============================================================
--
-- Un usuario real probó "Eliminar mi cuenta" en producción y recibió
-- "No pudimos completar la baja. No se borró nada." `eos_borrar_mis_datos_v55`
-- recorre el catálogo y borra de CADA tabla con `usuario_id` — incluida
-- `eos_auditoria_v60`, la bitácora de acciones. Esa tabla tiene un trigger
-- (`eos_auditoria_solo_agregar_v60`, v60) que rechaza CUALQUIER delete o
-- update, sin excepción, a propósito: es append-only para que ni el propio
-- sistema pueda alterar el historial.
--
-- El choque es real y no es de orden (no lo arregla reintentar): la función
-- reintenta 3 veces, falla las 3, y `eos_borrar_mis_datos_v55` revierte TODA
-- la operación —correcto, "no se borró nada" es literal— dejando la cuenta
-- sin poder cerrarse nunca.
--
-- Hay un segundo problema debajo, más serio: `eos_auditoria_v60.usuario_id`
-- referencia `auth.users(id) on delete cascade`. Aunque el paso 2 (esta
-- función) saltara la tabla, el paso 3 de `app/api/cuenta/eliminar`
-- (`admin.auth.admin.deleteUser`) dispara esa cascada — y Postgres corre los
-- triggers de fila también en los deletes por cascada. El mismo candado
-- rechazaría el cierre del login.
--
-- ============================================================
-- LA DECISIÓN, Y POR QUÉ ESTA Y NO OTRA
-- ============================================================
--
-- Preguntado el dueño del producto: borrar la bitácora también, sin
-- excepción, para esa cuenta. El derecho a borrar "todos tus datos" (Ley
-- 6534/2020, citada en la v55) no deja aparte el historial de lo que esa
-- persona hizo.
--
-- ============================================================
-- CÓMO SE ABRE EL CANDADO SOLO PARA ESTE CASO
-- ============================================================
--
-- No se saca el trigger ni se relaja para updates: la bitácora sigue sin
-- poder editarse NUNCA, ni durante una baja. Se agrega una excepción
-- angosta, solo para DELETE, solo cuando `eos_borrar_mis_datos_v55` la marcó
-- explícitamente para ESTA transacción con `set_config(..., true)` (local:
-- no sobrevive a la transacción ni se filtra a otro código que corra
-- después). Cerrar la cuenta es el único llamador que fija esa marca.
--
-- Con la bitácora borrada en el paso 2, el `on delete cascade` del paso 3 no
-- tiene nada que cascadear: el trigger ya no se dispara ahí tampoco.

create or replace function public.eos_auditoria_solo_agregar_v60()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('eos.borrando_cuenta', true), '') = 'true' then
    return old;
  end if;

  raise exception 'La bitácora de auditoría es append-only: % no está permitido.', tg_op
    using errcode = 'insufficient_privilege';
end;
$function$;

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

  -- Único caso en que la bitácora de auditoría deja de ser append-only: ver
  -- la cabecera de esta migración y `eos_auditoria_solo_agregar_v60`. Local a
  -- esta transacción (tercer argumento `true`): no se escapa a otro código.
  perform set_config('eos.borrando_cuenta', 'true', true);

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
  'Borra todos los datos del usuario autenticado recorriendo el catálogo. Dinámico a propósito: una lista fija de tablas queda vieja sin que nadie lo note. Marca eos.borrando_cuenta para que la bitácora de auditoría (append-only) se pueda borrar en este único caso.';
