-- Los objetivos dejan de ser una fila con un porcentaje.
--
-- ============================================================
-- QUÉ HAY HOY
-- ============================================================
--
-- `eos_goals` ya guarda `tipo_medicion = 'monetario'`, `valor_objetivo`,
-- `valor_actual`, `unidad` y `fecha_limite`, y `CREAR_OBJETIVO` los escribe
-- desde el chat a través de `eos_process_goal_command()`. O sea: "quiero tener
-- 30.000.000 para diciembre" ya se puede guardar.
--
-- Lo que no existe es la conexión con la plata. Hoy nadie calcula cuánto hay
-- que apartar por mes para llegar, ni si el ritmo real alcanza, ni qué pasa
-- con el ahorro que la persona ya comprometió en su Constitución. El panel
-- personal lee de esta tabla exactamente dos columnas —`estado` y `progreso`—
-- y con eso decide un booleano llamado `objetivos_en_ritmo` que es verdadero
-- siempre que el progreso sea mayor que cero.
--
-- Esta migración no crea una tabla nueva de objetivos. Le agrega a la que
-- existe las cuatro cosas que le faltan para que un objetivo sea financiero.
--
-- ============================================================
-- POR QUÉ SE VINCULA POR NOMBRE Y NO POR id
-- ============================================================
--
-- `cuenta_nombre` y no `cuenta_id`. La pantalla de cuentas guarda con
-- borrado-y-alta —el usuario piensa "estas son mis cuentas", no "quiero editar
-- la número 3"— así que los uuid cambian cada vez que alguien toca esa
-- pantalla. Un FK con `on delete set null` haría desaparecer el vínculo en
-- silencio, y el objetivo volvería a decir que tiene cero ahorrado.
--
-- El nombre sobrevive a ese guardado, y es además como ya resuelve las cuentas
-- `eos_finanzas_registrar_transferencia_v138`.
--
-- ============================================================
-- EL FONDO DE EMERGENCIA ES UN OBJETIVO, NO OTRA TABLA
-- ============================================================
--
-- Tiene monto meta, monto actual, aporte necesario y progreso: es un objetivo
-- de ahorro con un nombre propio. Lo único distinto es de dónde sale su meta
-- —de multiplicar el gasto esencial por los meses que la persona elija— y eso
-- vive en `lib/finanzas/fondoEmergencia.ts`, no en el esquema.
--
-- `meses_cobertura` guarda esa elección. No hay default de 3 ni de 6: son
-- recomendaciones de otros países repetidas hasta parecer leyes, y ninguna
-- sabe si esta persona tiene ingreso fijo o vive de changas.

-- ============================================================
-- 1) Las columnas
-- ============================================================

alter table public.eos_goals
  add column if not exists ambito text not null default 'personal',
  add column if not exists clase text not null default 'general',
  add column if not exists moneda text,
  add column if not exists cuenta_nombre text,
  add column if not exists meses_cobertura smallint;

alter table public.eos_goals
  drop constraint if exists eos_goals_ambito_check;

alter table public.eos_goals
  add constraint eos_goals_ambito_check
  check (ambito in ('negocio', 'personal'));

alter table public.eos_goals
  drop constraint if exists eos_goals_clase_check;

alter table public.eos_goals
  add constraint eos_goals_clase_check
  check (clase in ('general', 'fondo_emergencia'));

alter table public.eos_goals
  drop constraint if exists eos_goals_meses_cobertura_check;

alter table public.eos_goals
  add constraint eos_goals_meses_cobertura_check
  check (meses_cobertura is null or (meses_cobertura between 1 and 24));

comment on column public.eos_goals.ambito is
  'De quién es el objetivo. El panel personal solo muestra los suyos; nunca se suman con los del negocio.';

comment on column public.eos_goals.clase is
  'general o fondo_emergencia. El fondo es un objetivo de ahorro cuya meta la calcula EOS desde el gasto esencial.';

comment on column public.eos_goals.cuenta_nombre is
  'Dónde vive la plata de este objetivo. Por NOMBRE y no por id: la pantalla de cuentas guarda con borrado y alta, así que los uuid cambian.';

comment on column public.eos_goals.meses_cobertura is
  'Meses de gasto esencial que la persona eligió cubrir. Sin default: 3 y 6 son recomendaciones ajenas, no verdades.';

-- Un solo fondo de emergencia vivo por ámbito. Es un invariante real —nadie
-- tiene dos— y sin él la pantalla tendría que elegir uno y no sabría cuál.
create unique index if not exists eos_goals_fondo_unico_idx
  on public.eos_goals (usuario_id, ambito)
  where clase = 'fondo_emergencia' and estado in ('borrador', 'activo', 'pausado');

-- El panel personal lista objetivos monetarios activos de un ámbito.
create index if not exists eos_goals_ambito_idx
  on public.eos_goals (usuario_id, ambito, estado);

-- ============================================================
-- 2) Que el chat pueda escribirlas
-- ============================================================
--
-- Se parchea la función viva en vez de transcribirla: son 250 líneas y
-- copiarlas a mano es la forma más segura de perder un cambio anterior. Es la
-- misma técnica que usó la v25 con esta misma función, y falla ruidosamente si
-- el patrón no está en vez de aplicarse a medias.

do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
  v_old text;
  v_replacement text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'eos_process_goal_command'
    and p.pronargs = 0;

  if v_oid is null then
    raise exception 'eos_process_goal_command() no existe';
  end if;

  select pg_get_functiondef(v_oid) into v_def;
  v_new := v_def;

  -- --- La lista de columnas del insert ---
  v_old := '      valor_objetivo,
      unidad,
      prioridad,';
  v_replacement := '      valor_objetivo,
      unidad,
      ambito,
      clase,
      moneda,
      cuenta_nombre,
      meses_cobertura,
      prioridad,';

  if position(v_old in v_new) = 0 then
    raise exception 'No se encontró la lista de columnas del insert en eos_process_goal_command()';
  end if;

  v_new := replace(v_new, v_old, v_replacement);

  -- --- Los valores, en el mismo orden ---
  --
  -- El ámbito por default es 'personal', igual que en la v136: un objetivo del
  -- negocio que aparece en Personal se ve y se corrige; uno personal que no
  -- aparece en ningún lado no se ve nunca.
  v_old := '      nullif(btrim(datos ->> ''unidad''), ''''),
      prioridad_nueva,';
  v_replacement := '      nullif(btrim(datos ->> ''unidad''), ''''),
      case when lower(coalesce(datos ->> ''ambito'', '''')) = ''negocio''
           then ''negocio'' else ''personal'' end,
      case when lower(coalesce(datos ->> ''clase'', '''')) = ''fondo_emergencia''
           then ''fondo_emergencia'' else ''general'' end,
      nullif(btrim(datos ->> ''moneda''), ''''),
      nullif(btrim(datos ->> ''cuenta_nombre''), ''''),
      nullif(datos ->> ''meses_cobertura'', '''')::smallint,
      prioridad_nueva,';

  if position(v_old in v_new) = 0 then
    raise exception 'No se encontró la lista de valores del insert en eos_process_goal_command()';
  end if;

  v_new := replace(v_new, v_old, v_replacement);

  -- --- Y que una actualización pueda corregirlos ---
  --
  -- Sin esto, un objetivo que nació en el ámbito equivocado se quedaría ahí
  -- para siempre y habría que borrarlo para volver a crearlo.
  v_old := '        unidad = coalesce(nullif(btrim(datos ->> ''unidad''), ''''), objetivo_actual.unidad),';
  v_replacement := '        unidad = coalesce(nullif(btrim(datos ->> ''unidad''), ''''), objetivo_actual.unidad),
        ambito = case when lower(coalesce(datos ->> ''ambito'', '''')) in (''negocio'', ''personal'')
                      then lower(datos ->> ''ambito'') else objetivo_actual.ambito end,
        moneda = coalesce(nullif(btrim(datos ->> ''moneda''), ''''), objetivo_actual.moneda),
        cuenta_nombre = coalesce(
          nullif(btrim(datos ->> ''cuenta_nombre''), ''''),
          objetivo_actual.cuenta_nombre
        ),
        meses_cobertura = coalesce(
          nullif(datos ->> ''meses_cobertura'', '''')::smallint,
          objetivo_actual.meses_cobertura
        ),';

  if position(v_old in v_new) = 0 then
    raise exception 'No se encontró el update de unidad en eos_process_goal_command()';
  end if;

  v_new := replace(v_new, v_old, v_replacement);

  execute v_new;
end $$;

comment on function public.eos_process_goal_command() is
  'Procesa comandos idempotentes de objetivos. Desde la v144 acepta ambito, clase, moneda, cuenta_nombre y meses_cobertura.';
