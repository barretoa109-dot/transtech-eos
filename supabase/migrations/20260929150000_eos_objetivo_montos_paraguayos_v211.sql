-- Un objetivo pedido por chat ya no se cae por cómo vino escrito un número o
-- una fecha (v211).
--
-- ============================================================
-- LO QUE PASÓ
-- ============================================================
--
-- 22/09/2026, una cuenta real: armó su presupuesto con EOS ("para que te sobren
-- Gs. 3.000.000...") y pidió el objetivo. CREAR_OBJETIVO terminó en
-- EOS_INTERNAL_EFFECT_GOAL_FAILED y el chat dijo "La orden no pudo ejecutarse
-- de forma segura".
--
-- `eos_process_goal_command()` (v2, trigger AFTER INSERT en
-- `eos_goal_commands`) convierte lo que manda el modelo con casts directos:
-- `(datos ->> 'valor_objetivo')::numeric`, `::date`, `::smallint`. Cualquiera de
-- estas formas, todas normales acá, revienta la conversión:
--
--   "3.000.000"   (punto de miles)            invalid input syntax for type numeric
--   "Gs. 3.000.000", "3 millones", "500 mil"  ídem
--   "31/12/2026"                              date/time field value out of range
--   "alta" como prioridad                     invalid input syntax for type smallint
--
-- El trigger atrapa el error y marca el comando en 'error', pero el ejecutor
-- lanza EOS_INTERNAL_EFFECT_GOAL_FAILED y la transacción entera se revierte:
-- no queda ni la fila con el motivo (por eso la consulta a eos_goal_commands
-- del 29/09 volvió vacía). El detalle solo quedó en los logs de Vercel, que ya
-- no existen. No se pudo leer el payload de ese día; esto cubre las formas en
-- que el modelo escribe montos y fechas en guaraníes, que es lo que ella estaba
-- conversando.
--
-- ============================================================
-- EL ARREGLO
-- ============================================================
--
-- Un trigger BEFORE INSERT en `eos_goal_commands` que deja cada número y cada
-- fecha del payload en la forma que el cast entiende, o lo quita si no hay
-- forma de leerlo (y entonces rige el valor por defecto de siempre: prioridad
-- 3, fecha de inicio hoy, sin fecha límite). No se toca
-- `eos_process_goal_command()`, que ya fue parchada en su lugar por la v25 y
-- la v144: regenerarla desde un archivo pisaría esos cambios.
--
-- Montos, a la paraguaya: el punto separa miles y la coma decimales
-- ("1.500" es mil quinientos). "mil" y "millón/millones" multiplican.

create or replace function public.eos_goal_numero_v211(p_texto text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text := lower(btrim(coalesce(p_texto, '')));
  v_limpio text;
  v_multiplo numeric := 1;
begin
  if v_texto = '' then
    return null;
  end if;

  if v_texto ~ 'mill[oó]n|millones' then
    v_multiplo := 1000000;
  elsif v_texto ~ '(^|[^a-z])mil([^a-z]|$)' then
    v_multiplo := 1000;
  end if;

  v_limpio := regexp_replace(v_texto, '[^0-9.,-]', '', 'g');
  v_limpio := regexp_replace(v_limpio, '^[.,]+|[.,]+$', '', 'g');

  if v_limpio ~ '^-?[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$' then
    -- 3.000.000 / 1.500,50: punto de miles
    v_limpio := replace(replace(v_limpio, '.', ''), ',', '.');
  elsif v_limpio ~ '^-?[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$' then
    -- 3,000,000: coma de miles
    v_limpio := replace(v_limpio, ',', '');
  elsif v_limpio ~ '^-?[0-9]+,[0-9]+$' then
    -- 3,5 (millones): coma decimal
    v_limpio := replace(v_limpio, ',', '.');
  elsif v_limpio !~ '^-?[0-9]+(\.[0-9]+)?$' then
    return null;
  end if;

  return (v_limpio::numeric * v_multiplo)::text;
end;
$$;

create or replace function public.eos_goal_fecha_v211(p_texto text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_partes text[];
begin
  if v_texto ~ '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}' then
    v_partes := regexp_match(v_texto, '^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})');
    return make_date(v_partes[1]::int, v_partes[2]::int, v_partes[3]::int)::text;
  elsif v_texto ~ '^[0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{4}$' then
    -- Día primero, como se escribe acá.
    v_partes := regexp_match(v_texto, '^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})$');
    return make_date(v_partes[3]::int, v_partes[2]::int, v_partes[1]::int)::text;
  end if;
  return null;
exception
  when others then
    -- 31/02/2026 y parecidos: sin fecha, antes que sin objetivo.
    return null;
end;
$$;

create or replace function public.eos_goal_normalizar_payload_v211()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_datos jsonb := coalesce(new.payload, '{}'::jsonb);
  v_clave text;
  v_valor text;
  v_hitos jsonb;
  v_hito jsonb;
  v_hitos_limpios jsonb := '[]'::jsonb;
begin
  foreach v_clave in array array[
    'valor_inicial', 'valor_actual', 'valor_objetivo', 'progreso', 'confianza',
    'prioridad', 'meses_cobertura'
  ] loop
    if v_datos ? v_clave and jsonb_typeof(v_datos -> v_clave) <> 'null' then
      v_valor := public.eos_goal_numero_v211(v_datos ->> v_clave);
      if v_clave in ('prioridad', 'meses_cobertura') and v_valor is not null then
        v_valor := round(v_valor::numeric)::text;
      end if;
      v_datos := case when v_valor is null then v_datos - v_clave
                      else jsonb_set(v_datos, array[v_clave], to_jsonb(v_valor)) end;
    end if;
  end loop;

  foreach v_clave in array array['fecha_inicio', 'fecha_limite'] loop
    if v_datos ? v_clave and jsonb_typeof(v_datos -> v_clave) <> 'null' then
      v_valor := public.eos_goal_fecha_v211(v_datos ->> v_clave);
      v_datos := case when v_valor is null then v_datos - v_clave
                      else jsonb_set(v_datos, array[v_clave], to_jsonb(v_valor)) end;
    end if;
  end loop;

  v_hitos := v_datos -> 'hitos';
  if jsonb_typeof(v_hitos) = 'array' then
    for v_hito in select value from jsonb_array_elements(v_hitos) loop
      if jsonb_typeof(v_hito) = 'object' then
        foreach v_clave in array array['peso', 'orden'] loop
          if v_hito ? v_clave and jsonb_typeof(v_hito -> v_clave) <> 'null' then
            v_valor := public.eos_goal_numero_v211(v_hito ->> v_clave);
            if v_clave = 'orden' and v_valor is not null then
              v_valor := round(v_valor::numeric)::text;
            end if;
            v_hito := case when v_valor is null then v_hito - v_clave
                           else jsonb_set(v_hito, array[v_clave], to_jsonb(v_valor)) end;
          end if;
        end loop;
        if v_hito ? 'fecha_limite' and jsonb_typeof(v_hito -> 'fecha_limite') <> 'null' then
          v_valor := public.eos_goal_fecha_v211(v_hito ->> 'fecha_limite');
          v_hito := case when v_valor is null then v_hito - 'fecha_limite'
                         else jsonb_set(v_hito, '{fecha_limite}', to_jsonb(v_valor)) end;
        end if;
      end if;
      v_hitos_limpios := v_hitos_limpios || jsonb_build_array(v_hito);
    end loop;
    v_datos := jsonb_set(v_datos, '{hitos}', v_hitos_limpios);
  end if;

  new.payload := v_datos;
  return new;
end;
$$;

-- BEFORE INSERT: corre antes que `eos_goal_command_process_after_insert`.
drop trigger if exists eos_goal_command_normalizar_v211 on public.eos_goal_commands;
create trigger eos_goal_command_normalizar_v211
  before insert on public.eos_goal_commands
  for each row
  execute function public.eos_goal_normalizar_payload_v211();

-- Nadie las llama por la API: son del trigger. Todo objeto nuevo nace con
-- EXECUTE para PUBLIC y para anon (default privileges de la v0).
revoke execute on function public.eos_goal_numero_v211(text) from public, anon, authenticated;
revoke execute on function public.eos_goal_fecha_v211(text) from public, anon, authenticated;
revoke execute on function public.eos_goal_normalizar_payload_v211() from public, anon, authenticated;
