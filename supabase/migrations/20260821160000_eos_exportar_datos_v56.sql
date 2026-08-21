-- EOS — exportación de los datos del usuario
--
-- La otra mitad del derecho que ya cubre el borrado: además de poder irse,
-- el usuario tiene derecho a llevarse lo suyo. Las tiendas lo miran y la Ley
-- 6534/2020 lo respalda, pero también es lo que uno esperaría de un producto
-- al que le confía su vida financiera: que no sea una jaula.
--
-- Mismo criterio que `eos_borrar_mis_datos_v55`: recorre el catálogo en vez
-- de enumerar tablas, para que no quede vieja sola. Y sin parámetro, usando
-- `auth.uid()`, para que sea imposible exportar los datos de otro.

create or replace function public.eos_exportar_mis_datos_v56()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  r record;
  filas jsonb;
  datos jsonb := '{}'::jsonb;
  total int := 0;
  -- Claves que NO salen en la exportación.
  --
  -- Son credenciales, no datos personales: el alias de la tarjeta permite
  -- cobrar, y el token del buzón permite inyectar movimientos en la cuenta.
  -- Un archivo descargado se reenvía, se sube a un drive y se olvida ahí;
  -- que arrastre credenciales activas convierte un derecho del usuario en
  -- un riesgo para él.
  sensibles text[] := array[
    'token', 'alias_token', 'secret', 'password', 'private_key', 'api_key'
  ];
begin
  if v_usuario is null then
    raise exception 'Sin sesión' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.column_name in ('usuario_id', 'user_id')
     order by c.table_name
  loop
    begin
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(t.*) - $2), ''[]''::jsonb) from public.%I t where t.%I::text = $1',
        r.table_name, r.column_name
      )
      into filas
      using v_usuario::text, sensibles;

      if jsonb_array_length(filas) > 0 then
        datos := datos || jsonb_build_object(r.table_name, filas);
        total := total + jsonb_array_length(filas);
      end if;
    exception
      when others then
        -- Una tabla ilegible no puede tumbar la exportación entera: es
        -- preferible entregar el resto y dejar constancia de lo que faltó.
        datos := datos || jsonb_build_object(
          r.table_name, jsonb_build_object('error', 'no se pudo exportar')
        );
    end;
  end loop;

  -- `usuarios` va aparte: su columna es `id`, no `usuario_id`.
  select coalesce(jsonb_agg(to_jsonb(u.*) - sensibles), '[]'::jsonb)
    into filas
    from public.usuarios u
   where u.id = v_usuario;

  if jsonb_array_length(filas) > 0 then
    datos := datos || jsonb_build_object('usuarios', filas);
    total := total + jsonb_array_length(filas);
  end if;

  return jsonb_build_object(
    'exportado_en', now(),
    'usuario_id', v_usuario,
    'total_registros', total,
    'nota', 'No se incluyen credenciales (tokens de tarjeta, claves de buzón) por seguridad.',
    'datos', datos
  );
end;
$$;

revoke all on function public.eos_exportar_mis_datos_v56() from public;
grant execute on function public.eos_exportar_mis_datos_v56() to authenticated;
