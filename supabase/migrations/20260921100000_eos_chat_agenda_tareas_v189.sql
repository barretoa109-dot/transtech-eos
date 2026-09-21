-- v189: lo que la persona dice con fecha por el chat llega solo al Calendario.
--
-- ============================================================
-- EL HUECO
-- ============================================================
--
-- "Tengo que pagar los salarios el 25" ya se podía decir: el chat tiene el verbo
-- CREAR_TAREA y guarda la tarea en `eos_tasks`. Pero la fecha se perdía por dos
-- lados:
--
--   1. El prompt no enseña la forma de los datos de CREAR_TAREA, y el modelo no
--      sabe qué día es hoy (el prompt es idéntico para todos, a propósito, para
--      poder cachearlo). Convertir "el 25" a AAAA-MM-DD es adivinar el mes y el
--      año.
--   2. El ejecutor solo aceptaba una fecha completa AAAA-MM-DD y la guardaba como
--      medianoche UTC, que en Paraguay es las 21:00 del DÍA ANTERIOR.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- Mismo criterio que la v182 (vencimientos de ventas): el chat manda LO QUE LA
-- PERSONA DIJO y la base hace la cuenta con la fecha de Paraguay.
--
--   vence_dia      el día del mes ("el 25"); este mes si no pasó, si no el próximo
--   vence_en_dias  "mañana" → 1, "en 15 días" → 15
--   vence_semana   "el lunes" → 'lunes'; el próximo que venga (nunca hoy)
--   vence_el       AAAA-MM-DD, solo si dijo la fecha completa con el año
--   hora           HH:MM de 24 horas, si la dijo
--
--   1. `eos_tarea_fecha_desde_datos_v189(datos)`: la cuenta de arriba. Guarda el
--      instante en hora de Paraguay: 00:00 es "todo el día", como lee el
--      Calendario.
--   2. `eos_execute_internal_effect_v64`, rama CREAR_TAREA: usa esa función y
--      devuelve en el resultado `fecha_limite` y `hora` YA resueltas, para que el
--      worker le diga a la persona el día que quedó, no el que ella dijo.
--
-- La función del ejecutor se PARCHA EN SU LUGAR leyendo `pg_get_functiondef`, no se
-- regenera desde un archivo: la base va por delante de la rama y otra sesión puede
-- haber tocado otras ramas (ver la memoria "base adelantada"). Si un ancla no está
-- exactamente una vez, se corta con una excepción sin cambiar nada. Las anclas son
-- de UNA sola línea a propósito: la función de producción tiene fines de línea
-- CRLF y un ancla de varias líneas no la encontraría.
--
-- ORDEN: se aplica ANTES de que el prompt de n8n empiece a mandar estos campos. Al
-- revés, el ejecutor los ignoraría sin avisar.
--
-- Sin `begin;`/`commit;` de nivel superior: `db push` ya envuelve el archivo.

create or replace function public.eos_tarea_fecha_desde_datos_v189(p_datos jsonb)
returns timestamptz
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_hoy date := public.eos_hoy_py();
  v_texto text;
  v_fecha date;
  v_dow integer;
  v_dias integer;
  v_hora time := time '00:00';
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    return null;
  end if;

  -- 1. Una fecha completa, con o sin hora pegada ("2026-09-25", "2026-09-25T10:00").
  --    Solo se toma el día: la hora, si la hay, viene aparte en `hora`.
  v_texto := nullif(btrim(coalesce(p_datos ->> 'fecha_limite', p_datos ->> 'vence_el', '')), '');

  if v_texto ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
    begin
      v_fecha := left(v_texto, 10)::date;
    exception when others then
      v_fecha := null; -- "2026-02-31": no existe; se descarta en vez de romper la tarea.
    end;

    -- Un año absurdo es un error de dictado.
    if v_fecha is not null and v_fecha not between v_hoy - 3650 and v_hoy + 3650 then
      v_fecha := null;
    end if;
  end if;

  -- 2. "El 25", "en 15 días": la misma cuenta que los vencimientos de la v182.
  if v_fecha is null then
    v_fecha := public.eos_vencimiento_desde_datos_v182(p_datos, 'credito');
  end if;

  -- 3. "El lunes": el próximo que venga. Si hoy es lunes, el de la semana que viene:
  --    quien dice "el lunes" un lunes habla del próximo.
  if v_fecha is null then
    v_texto := lower(translate(
      btrim(coalesce(p_datos ->> 'vence_semana', '')),
      'áéíóúÁÉÍÓÚ', 'aeiouaeiou'
    ));

    v_dow := case v_texto
      when 'domingo' then 0
      when 'lunes' then 1
      when 'martes' then 2
      when 'miercoles' then 3
      when 'jueves' then 4
      when 'viernes' then 5
      when 'sabado' then 6
      else null
    end;

    if v_dow is not null then
      v_dias := (v_dow - extract(dow from v_hoy)::integer + 7) % 7;
      if v_dias = 0 then
        v_dias := 7;
      end if;
      v_fecha := v_hoy + v_dias;
    end if;
  end if;

  if v_fecha is null then
    return null;
  end if;

  -- La hora, solo si viene bien escrita. Sin ella queda 00:00 = todo el día.
  v_texto := nullif(btrim(coalesce(p_datos ->> 'hora', '')), '');

  if v_texto ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' then
    v_hora := v_texto::time;
  end if;

  -- `date + time` es un timestamp SIN zona: `at time zone` lo lee como hora de
  -- Asunción y lo convierte al instante correcto.
  return (v_fecha + v_hora) at time zone 'America/Asuncion';
end;
$function$;

comment on function public.eos_tarea_fecha_desde_datos_v189(jsonb) is
  'v189: traduce lo que la persona dijo por el chat (vence_dia, vence_en_dias, vence_semana, vence_el o fecha_limite, y hora) al instante de una tarea, en hora de Paraguay. Sin hora, 00:00 = todo el día.';

-- Es un ayudante del ejecutor, no una API: nadie más tiene por qué llamarla.
revoke all on function public.eos_tarea_fecha_desde_datos_v189(jsonb) from public, anon, authenticated;
grant execute on function public.eos_tarea_fecha_desde_datos_v189(jsonb) to service_role;

-- ------------------------------------------------------------
-- Parche en su lugar de la rama CREAR_TAREA del ejecutor.
-- ------------------------------------------------------------

do $parche$
declare
  v_oid oid;
  v_def text;
  v_nueva text;
  v_ancla text;
  v_veces integer;
  v_ancla_when constant text :=
    $a$when coalesce(v_data ->> 'fecha_limite', '') ~ '^\d{4}-\d{2}-\d{2}'$a$;
  v_ancla_then constant text :=
    $a$then (v_data ->> 'fecha_limite')::timestamptz$a$;
  v_ancla_elsif constant text :=
    $a$elsif v_command.accion = 'GUARDAR_MEMORIA' then$a$;
begin
  select p.oid into v_oid
  from pg_proc p
  where p.proname = 'eos_execute_internal_effect_v64'
    and p.pronamespace = 'public'::regnamespace;

  if v_oid is null then
    raise exception 'v189: no existe eos_execute_internal_effect_v64';
  end if;

  v_def := pg_get_functiondef(v_oid);

  -- Idempotente: si ya está parcheada, avisar y salir.
  if position('eos_tarea_fecha_desde_datos_v189' in v_def) > 0 then
    raise notice 'v189: el ejecutor ya usa eos_tarea_fecha_desde_datos_v189; no se toca.';
    return;
  end if;

  -- Cada ancla tiene que aparecer EXACTAMENTE una vez.
  foreach v_ancla in array array[v_ancla_when, v_ancla_then, v_ancla_elsif] loop
    v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);

    if v_veces <> 1 then
      raise exception 'v189: el ancla "%" aparece % veces, no 1. No se cambió nada.', v_ancla, v_veces;
    end if;
  end loop;

  v_nueva := replace(v_def, v_ancla_when,
    $n$when public.eos_tarea_fecha_desde_datos_v189(v_data) is not null$n$);

  v_nueva := replace(v_nueva, v_ancla_then,
    $n$then public.eos_tarea_fecha_desde_datos_v189(v_data)$n$);

  -- Antes de `elsif ... GUARDAR_MEMORIA`, todavía dentro de la rama CREAR_TAREA:
  -- el resultado lleva el día y la hora que quedaron, ya resueltos, para que el
  -- worker diga "quedó para el 25 de septiembre" con la fecha real.
  v_nueva := replace(v_nueva, v_ancla_elsif,
    $n$v_result := coalesce(v_result, '{}'::jsonb) || coalesce((
      select jsonb_build_object(
        'fecha_limite', to_char(t.fecha_limite at time zone 'America/Asuncion', 'YYYY-MM-DD'),
        'hora', case
          when (t.fecha_limite at time zone 'America/Asuncion')::time <> time '00:00'
            then to_char(t.fecha_limite at time zone 'America/Asuncion', 'HH24:MI')
          else null
        end
      )
      from public.eos_tasks t
      where t.id = v_effect_id
        and t.fecha_limite is not null
    ), '{}'::jsonb);

  $n$ || v_ancla_elsif);

  execute v_nueva;

  raise notice 'v189: rama CREAR_TAREA del ejecutor actualizada.';
end;
$parche$;
