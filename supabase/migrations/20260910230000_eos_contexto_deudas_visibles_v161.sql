-- Las deudas nunca iban a aparecer en el contexto del modelo.
--
-- ============================================================
-- UN VALOR INVENTADO EN UN FILTRO NO FALLA: FILTRA TODO
-- ============================================================
--
-- El bloque de posición que entró hoy filtraba las deudas así:
--
--     and coalesce(d.estado, 'activa') = 'activa'
--
-- Y 'activa' no existe. Los estados de `eos_finanzas_deudas` son 'al_dia',
-- 'atrasada', 'en_negociacion' y 'saldada' — están en el check desde la v61.
-- La consulta no fallaba: devolvía cero filas, siempre, para todo el mundo.
--
-- Es la peor forma de estar mal. Una COLUMNA que no existe rompe y se arregla
-- en el acto; un VALOR que no existe pasa la sintaxis, pasa la revisión, y
-- deja una lista vacía que el modelo lee como "esta persona no debe nada".
--
-- ============================================================
-- CÓMO APARECIÓ
-- ============================================================
--
-- Midiendo. `scripts/medir-contexto.mts` desglosa el contexto bloque por
-- bloque para ver cuánto ocupa cada uno, y con deudas cargadas a mano el
-- bloque de deudas no estaba. Nadie lo habría visto leyendo el SQL: se ve
-- contando.
--
-- De paso se corrige el filtro de objetivos, que tenía el mismo problema a
-- medias: pedía 'activo' o 'en_progreso', y 'en_progreso' tampoco existe. Ese
-- acertaba de casualidad por el otro valor.
--
-- ============================================================
-- UNA DEUDA ATRASADA PESA MÁS, NO MENOS
-- ============================================================
--
-- El filtro nuevo es "todo lo que no esté saldado". Escribirlo como
-- `= 'al_dia'` —que era lo que el autor creía estar escribiendo— habría hecho
-- desaparecer justo la deuda atrasada, que es la única que urge.
--
-- ============================================================
-- POR QUÉ SE PARCHEA EN SU LUGAR Y NO SE REGENERA
-- ============================================================
--
-- Hay otra sesión trabajando sobre esta misma base. Hoy ya se chocó una vez:
-- dos migraciones con el mismo timestamp, y al salir del paso regenerando la
-- función desde un archivo local se borró de producción el catálogo que la
-- otra sesión acababa de agregar.
--
-- Regenerar desde un archivo asume que ese archivo es lo que está corriendo.
-- Cuando hay dos manos, esa suposición es falsa y se paga caro.
--
-- Esto en cambio lee `pg_get_functiondef` —lo que REALMENTE está vivo—, le
-- cambia dos expresiones y lo vuelve a declarar. Si el texto no está donde se
-- espera, levanta excepción y no toca nada.

do $$
declare
  v_oid oid;
  v_def text;
  v_nuevo text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'eos_contexto_negocio'
    and p.prokind = 'f'
  limit 1;

  if v_oid is null then
    raise exception 'No existe public.eos_contexto_negocio()';
  end if;

  v_def := pg_get_functiondef(v_oid);
  v_nuevo := v_def;

  /*
   * Si ya está corregido, no hay nada que hacer.
   *
   * Esto se aplicó primero fuera del historial de migraciones —había dos
   * sesiones empujando a la misma base y el CLI no dejaba pasar— así que el
   * archivo tiene que poder correr sobre una base que ya lo tiene. Un
   * `raise exception` acá dejaría una instalación desde cero rota.
   */
  if position('coalesce(d.estado, ''al_dia'') <> ''saldada''' in v_nuevo) > 0 then
    raise notice 'eos_contexto_negocio: el filtro de deudas ya estaba corregido.';
    return;
  end if;

  -- 1) Las deudas: todo lo que no esté saldado.
  if position('coalesce(d.estado, ''activa'') = ''activa''' in v_nuevo) = 0 then
    raise exception
      'No encontré el filtro de deudas en eos_contexto_negocio(). No se cambió nada.';
  end if;

  v_nuevo := replace(
    v_nuevo,
    'coalesce(d.estado, ''activa'') = ''activa''',
    'coalesce(d.estado, ''al_dia'') <> ''saldada'''
  );

  -- 2) Los objetivos: el estado que de verdad existe.
  if position('coalesce(g.estado, ''activo'') in (''activo'', ''en_progreso'')' in v_nuevo) > 0 then
    v_nuevo := replace(
      v_nuevo,
      'coalesce(g.estado, ''activo'') in (''activo'', ''en_progreso'')',
      'coalesce(g.estado, ''activo'') = ''activo'''
    );
  end if;

  execute v_nuevo;

  -- Y la comprobación de que quedó como se quería.
  if position('<> ''saldada''' in pg_get_functiondef(v_oid)) = 0 then
    raise exception 'El filtro de deudas no quedó aplicado.';
  end if;

  raise notice 'eos_contexto_negocio: el filtro de deudas ya no descarta todo.';
end;
$$;
