-- v191: el Calendario se repite, avisa, y el chat entiende "todos los meses".
--
-- ============================================================
-- QUÉ TRAE
-- ============================================================
--
--   1. Repetición: "el 25 de cada mes", "todos los lunes". Una regla en la fila
--      (`repite`, `repite_hasta`) y la lista de días ya cumplidos
--      (`repite_hechas`), en las DOS tablas que alimentan el calendario:
--      `eos_calendario_eventos` (lo que se anota a mano) y `eos_tasks` (lo que EOS
--      anota desde el chat). Las ocurrencias NO se guardan: se calculan al leer.
--   2. `eos_agenda_avisos`: un renglón por persona y día, para que el aviso de la
--      mañana salga UNA vez aunque el cron corra dos.
--   3. `eos_followup_preferences.avisos_agenda`: el interruptor de esos avisos.
--   4. `eos_repite_desde_datos_v191(datos)`: traduce lo que el chat manda
--      ("mensual", "cada mes", "todos los meses") a los cuatro valores que la base
--      acepta.
--   5. Parche EN SU LUGAR de la rama CREAR_TAREA del ejecutor: si la persona dijo
--      que se repite, la tarea guarda su regla y el resultado la devuelve, para que
--      el worker diga "todos los meses" y no solo "el 25".
--
-- ============================================================
-- POR QUÉ LA REPETICIÓN VA EN `eos_tasks` TAMBIÉN
-- ============================================================
--
-- CREAR_TAREA ya escribe en `eos_tasks`, con su idempotencia por comando. Mandar lo
-- que se repite a otra tabla obligaría a duplicar esa idempotencia y a parchear el
-- ejecutor por segunda vez con una rama entera. Con dos columnas más, el ejecutor
-- solo tiene que anotar la regla sobre la fila que ya crea.
--
-- ORDEN: requiere la v189 (el parche se ancla en su texto). Se aplica ANTES de que
-- el prompt de n8n empiece a mandar `repite`; al revés, el ejecutor lo ignoraría.
--
-- Sin `begin;`/`commit;` de nivel superior: `db push` ya envuelve el archivo.

-- ------------------------------------------------------------
-- 1. La repetición, en las dos tablas
-- ------------------------------------------------------------

alter table public.eos_calendario_eventos
  add column if not exists repite text,
  add column if not exists repite_hasta date,
  add column if not exists repite_hechas date[] not null default '{}';

alter table public.eos_tasks
  add column if not exists repite text,
  add column if not exists repite_hasta date,
  add column if not exists repite_hechas date[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_calendario_repite_check'
      and conrelid = 'public.eos_calendario_eventos'::regclass
  ) then
    alter table public.eos_calendario_eventos
      add constraint eos_calendario_repite_check
      check (repite is null or repite in ('diaria', 'semanal', 'mensual', 'anual'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'eos_tasks_repite_check'
      and conrelid = 'public.eos_tasks'::regclass
  ) then
    alter table public.eos_tasks
      add constraint eos_tasks_repite_check
      check (repite is null or repite in ('diaria', 'semanal', 'mensual', 'anual'));
  end if;
end;
$$;

-- Lo que tiene regla es poco y se consulta siempre (al mirar cualquier mes).
create index if not exists eos_calendario_con_regla_idx
  on public.eos_calendario_eventos (usuario_id)
  where repite is not null;

create index if not exists eos_tasks_con_regla_idx
  on public.eos_tasks (usuario_id)
  where repite is not null;

comment on column public.eos_calendario_eventos.repite is
  'Cada cuánto se repite: diaria, semanal, mensual o anual. Nulo = de una sola vez. Las ocurrencias se calculan al leer.';
comment on column public.eos_calendario_eventos.repite_hechas is
  'Los días de la serie que la persona ya marcó como hechos. Una serie no tiene un solo estado: cada ocurrencia tiene el suyo.';
comment on column public.eos_tasks.repite is
  'Cada cuánto se repite la tarea (v191). Nulo = de una sola vez. Las ocurrencias se calculan al leer, desde fecha_limite.';
comment on column public.eos_tasks.repite_hechas is
  'Los días de la serie ya cumplidos (v191).';

-- ------------------------------------------------------------
-- 2. Un aviso por persona y por día
-- ------------------------------------------------------------

create table if not exists public.eos_agenda_avisos (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  canal text not null check (canal in ('push', 'correo')),
  resumen text,
  enviado_en timestamptz not null default now(),
  primary key (usuario_id, fecha)
);

comment on table public.eos_agenda_avisos is
  'v191: el aviso de agenda de cada mañana. La clave (persona, día) es la idempotencia: aunque el cron corra dos veces, sale uno.';

alter table public.eos_agenda_avisos enable row level security;

-- Solo lo toca el cron, con el cliente de servicio. Nadie más lee ni escribe.
revoke all on table public.eos_agenda_avisos from public, anon, authenticated;
grant select, insert, update, delete on table public.eos_agenda_avisos to service_role;

-- ------------------------------------------------------------
-- 3. El interruptor
-- ------------------------------------------------------------

alter table public.eos_followup_preferences
  add column if not exists avisos_agenda boolean not null default true;

comment on column public.eos_followup_preferences.avisos_agenda is
  'Si EOS avisa cada mañana lo que la persona tiene en su agenda ese día (v191). Arranca en true: son recordatorios que ella misma pidió. Se apaga desde el Calendario.';

-- ------------------------------------------------------------
-- 4. "Cada mes" → mensual
-- ------------------------------------------------------------

create or replace function public.eos_repite_desde_datos_v191(p_datos jsonb)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_texto text;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    return null;
  end if;

  -- Sin tildes ni eñes, en minúscula y con guiones bajos por espacios: el modelo
  -- puede mandar "mensual", "cada mes" o "todos los meses".
  v_texto := replace(
    lower(translate(btrim(coalesce(p_datos ->> 'repite', '')), 'áéíóúÁÉÍÓÚñÑ', 'aeiouaeiounn')),
    ' ', '_'
  );

  return case
    when v_texto in ('diaria', 'diario', 'cada_dia', 'todos_los_dias') then 'diaria'
    when v_texto in ('semanal', 'cada_semana', 'todas_las_semanas') then 'semanal'
    when v_texto in ('mensual', 'cada_mes', 'todos_los_meses') then 'mensual'
    when v_texto in ('anual', 'cada_ano', 'todos_los_anos') then 'anual'
    else null
  end;
end;
$function$;

comment on function public.eos_repite_desde_datos_v191(jsonb) is
  'v191: traduce lo que la persona dijo por el chat sobre repetir (mensual, cada mes, todos los meses...) a diaria/semanal/mensual/anual, o nulo.';

revoke all on function public.eos_repite_desde_datos_v191(jsonb) from public, anon, authenticated;
grant execute on function public.eos_repite_desde_datos_v191(jsonb) to service_role;

-- ------------------------------------------------------------
-- 5. Parche en su lugar de la rama CREAR_TAREA del ejecutor
-- ------------------------------------------------------------

do $parche$
declare
  v_oid oid;
  v_def text;
  v_nueva text;
  v_veces integer;
  -- La primera línea del bloque de resultado que puso la v189: es un ancla propia,
  -- de una sola línea, que aparece una vez.
  v_ancla constant text :=
    $a$v_result := coalesce(v_result, '{}'::jsonb) || coalesce($a$;
begin
  select p.oid into v_oid
  from pg_proc p
  where p.proname = 'eos_execute_internal_effect_v64'
    and p.pronamespace = 'public'::regnamespace;

  if v_oid is null then
    raise exception 'v191: no existe eos_execute_internal_effect_v64';
  end if;

  v_def := pg_get_functiondef(v_oid);

  -- Idempotente.
  if position('eos_repite_desde_datos_v191' in v_def) > 0 then
    raise notice 'v191: el ejecutor ya guarda la repetición; no se toca.';
    return;
  end if;

  if position('eos_tarea_fecha_desde_datos_v189' in v_def) = 0 then
    raise exception 'v191: falta la v189 (el ejecutor todavía no resuelve fechas de tareas). No se cambió nada.';
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);

  if v_veces <> 1 then
    raise exception 'v191: el ancla aparece % veces, no 1. No se cambió nada.', v_veces;
  end if;

  -- Antes del bloque de resultado de la v189, todavía dentro de la rama CREAR_TAREA:
  -- si dijo que se repite (y la tarea tiene fecha, que es de donde se ancla la
  -- regla), se anota sobre la fila que la rama ya creó y se devuelve en el resultado.
  v_nueva := replace(v_def, v_ancla,
    $n$if v_effect_id is not null and public.eos_repite_desde_datos_v191(v_data) is not null then
      update public.eos_tasks
      set repite = public.eos_repite_desde_datos_v191(v_data)
      where id = v_effect_id
        and fecha_limite is not null
        and repite is null;

      v_result := coalesce(v_result, '{}'::jsonb) || coalesce((
        select jsonb_build_object('repite', t.repite)
        from public.eos_tasks t
        where t.id = v_effect_id
          and t.repite is not null
      ), '{}'::jsonb);
    end if;

    $n$ || v_ancla);

  execute v_nueva;

  raise notice 'v191: la rama CREAR_TAREA del ejecutor guarda la repetición.';
end;
$parche$;
