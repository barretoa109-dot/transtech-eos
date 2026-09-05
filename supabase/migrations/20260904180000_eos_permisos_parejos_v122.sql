-- Los permisos que sobraban, parejos en todo el esquema (v122).
--
-- ============================================================
-- QUÉ SE ENCONTRÓ
-- ============================================================
--
-- La v121 arregló la tabla de cajas: Supabase le había dado `all` a
-- `authenticated` por `alter default privileges`, y un `grant` de cuatro
-- permisos no quita los otros tres. Buscando si pasaba en otras tablas
-- apareció que sí, en VEINTINUEVE — no diecinueve: la primera búsqueda
-- filtraba por `eos_%` y se perdió las tablas heredadas, que no llevan ese
-- prefijo.
--
-- Y apareció algo peor de paso: DIECISÉIS de esas veintinueve también le
-- otorgan permisos a `anon`, catorce de ellas con `usuario_id` adentro.
--
-- ============================================================
-- POR QUÉ TRUNCATE ES EL QUE IMPORTA
-- ============================================================
--
-- **TRUNCATE no pasa por RLS.** Un `delete` que la policy no permite no borra
-- nada; un `truncate` vacía la tabla entera, de todos los usuarios, sin que
-- ninguna policy lo mire. Con el grant a `anon` encima —y la clave pública
-- está en el JavaScript del navegador, no es un secreto— el permiso que
-- sobraba dejaba de ser teórico.
--
-- `TRIGGER` y `REFERENCES` son menos graves: crear triggers y claves foráneas
-- sobre la tabla. Nadie los necesita desde el cliente, y un permiso que sobra
-- es superficie que hay que explicar cada vez que alguien audita.
--
-- ============================================================
-- SE REVOCA LO QUE SOBRA, NO SE REESCRIBE LO QUE HAY
-- ============================================================
--
-- Un `revoke all` + `grant select, insert, update, delete` habría sido más
-- corto y más peligroso: le habría AGREGADO permisos a cualquier tabla que
-- hoy tenga menos de esos cuatro. `eos_empresa_miembros`, por ejemplo, tiene
-- solo SELECT a propósito.
--
-- Acá se revocan únicamente los tres que sobran. Es estrictamente una
-- reducción: ninguna tabla puede terminar pudiendo más de lo que podía.
--
-- ============================================================
-- QUÉ SE COMPROBÓ ANTES DE TOCAR `anon`
-- ============================================================
--
--   · Las catorce con `usuario_id` tienen RLS activa. De las catorce, diez no
--     se usan desde ningún lado del código; las cuatro que sí
--     —`eos_correos_entrantes`, `eos_kpis`, `eos_tendencias`,
--     `recomendaciones`— se leen con el cliente de SESIÓN y detrás de un
--     guarda de autenticación, así que corren como `authenticated` y nunca
--     como `anon`.
--   · Las dos sin `usuario_id` —`funciones_eos` y `permisos_plan`— son
--     catálogos heredados con RLS activa y CERO policies: nadie puede leerlos
--     igual, y ninguna línea del repositorio los nombra. Revocarles `anon` no
--     cambia nada observable.

-- ============================================================
-- 1. Los tres que no necesita nadie
-- ============================================================
--
-- Se descubren en vez de listarse: una lista escrita a mano se desactualiza el
-- día que alguien agrega una tabla y no se acuerda de venir hasta acá, y ese
-- es justamente el día en que esto tendría que actuar. La condición es la
-- misma que se usó para encontrarlas.

do $$
declare
  t record;
  v_n int := 0;
begin
  for t in
    select distinct table_name
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
    order by table_name
  loop
    execute format(
      'revoke truncate, trigger, references on table public.%I from authenticated',
      t.table_name
    );
    v_n := v_n + 1;
  end loop;

  raise notice 'v122: % tabla(s) dejaron de darle truncate/trigger/references a authenticated', v_n;
end $$;

-- ============================================================
-- 2. Y `anon` no toca ninguna de estas
-- ============================================================
--
-- Acá SÍ va la lista escrita: quitarle permisos a `anon` es una decisión por
-- tabla —un catálogo público legítimo los necesitaría— y descubrirlas sola
-- convertiría un juicio en un automatismo. Estas dieciséis se miraron una por
-- una; ver arriba.

do $$
declare
  t text;
  tablas text[] := array[
    -- Catorce con datos de una persona.
    'diagnosticos',
    'eos_correos_entrantes',
    'eos_documents',
    'eos_intelligence',
    'eos_kpis',
    'eos_tasks',
    'eos_tendencias',
    'eos_workspace_items',
    'memorias',
    'notificaciones',
    'recomendaciones',
    'score_historico',
    'score_usuario',
    'uso_mensual',
    -- Dos catálogos heredados sin policies y sin uso.
    'funciones_eos',
    'permisos_plan'
  ];
begin
  foreach t in array tablas loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'v122: % no existe en esta base, se saltea', t;
      continue;
    end if;

    execute format('revoke all on table public.%I from anon', t);
  end loop;

  raise notice 'v122: anon ya no alcanza ninguna de las % tablas', array_length(tablas, 1);
end $$;

-- ============================================================
-- 3. Comprobar, no suponer
-- ============================================================

do $$
declare
  v_sobra int;
  v_anon int;
begin
  select count(distinct table_name) into v_sobra
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee = 'authenticated'
    and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');

  if v_sobra > 0 then
    raise exception 'v122: todavía quedan % tabla(s) dándole truncate/trigger/references a authenticated', v_sobra;
  end if;

  select count(distinct table_name) into v_anon
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee = 'anon'
    and table_name in (
      'diagnosticos','eos_correos_entrantes','eos_documents','eos_intelligence',
      'eos_kpis','eos_tasks','eos_tendencias','eos_workspace_items','memorias',
      'notificaciones','recomendaciones','score_historico','score_usuario',
      'uso_mensual','funciones_eos','permisos_plan'
    );

  if v_anon > 0 then
    raise exception 'v122: anon todavía alcanza % tabla(s) de la lista', v_anon;
  end if;

  raise notice 'v122: ninguna tabla le da de más a authenticated, y anon no alcanza las dieciséis.';
end $$;

-- ============================================================
-- 4. La función que lo vuelve a medir
-- ============================================================
--
-- Existe para que esto no dependa de que alguien se acuerde de correr la
-- consulta. Tiene que dar cero filas siempre; si devuelve algo, una tabla
-- nueva heredó el `grant` por defecto y nadie se lo quitó.

create or replace function public.eos_permisos_de_mas_v122()
returns table (tabla text, rol text, permiso text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.table_name::text, g.grantee::text, g.privilege_type::text
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.grantee = 'authenticated'
    and g.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
  order by 1, 3;
$$;

comment on function public.eos_permisos_de_mas_v122() is
  'v122: tablas donde authenticated tiene permisos que no necesita. TRUNCATE no pasa por RLS. Tiene que devolver cero filas.';

revoke all on function public.eos_permisos_de_mas_v122() from public, anon, authenticated;
grant execute on function public.eos_permisos_de_mas_v122() to service_role;
