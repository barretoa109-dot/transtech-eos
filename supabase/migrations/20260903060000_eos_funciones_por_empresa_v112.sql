-- La frontera de empresa, etapa 3c: las funciones del ERP (v112).
--
-- ============================================================
-- EL PASO MÁS DELICADO DE TODOS
-- ============================================================
--
-- Las rutas de lectura ya migraron. Las de escritura no podían: delegan en
-- funciones que filtran internamente por `usuario_id = p_usuario_id`, así que
-- ampliar solo el chequeo de la ruta no ganaba nada —el RPC igual rechazaba— y
-- dejaba las dos capas diciendo cosas distintas.
--
-- Acá se migran esas funciones. Y acá un error no muestra datos ajenos: los
-- MODIFICA. Por eso todo lo que sigue está pensado para que sea imposible
-- ampliar de más sin darse cuenta.
--
-- ============================================================
-- POR QUÉ UNA FUNCIÓN Y NO `empresa_id` DIRECTO
-- ============================================================
--
-- La tentación es reemplazar `usuario_id = p_usuario_id` por
-- `empresa_id = eos_empresa_de_v109(p_usuario_id)`. No sirve, por dos motivos
-- comprobados antes de escribir esto:
--
--   1. El predicado se usa también sobre `eos_movimientos_financieros`, que NO
--      tiene `empresa_id` — es una tabla de finanzas personales. El reemplazo
--      no compilaría.
--   2. Hay ocurrencias con alias de tabla (`p.usuario_id`, `c.usuario_id`,
--      `m.usuario_id`, `d.usuario_id`). Un reemplazo ingenuo produciría
--      `p.public.eos_...`, que es sintaxis rota.
--
-- `eos_empresa_alcanza_v112` compara DOS USUARIOS y nunca menciona
-- `empresa_id`. Funciona sobre cualquier tabla que tenga dueño, y el mismo
-- reemplazo sirve con alias y sin alias.
--
-- ============================================================
-- CORTOCIRCUITO, QUE ADEMÁS ES LO RÁPIDO
-- ============================================================
--
-- `p_actor = p_dueno or ...` evalúa la comparación barata primero. Hoy todas
-- las filas son del propio actor, así que la consulta a la tabla de miembros
-- casi nunca llega a correr. Sin eso, `eos_erp_valor_inventario_v108`
-- resolvería la empresa dos veces POR PRODUCTO.

create or replace function public.eos_empresa_alcanza_v112(p_actor uuid, p_dueno uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_actor = p_dueno
    or (
      p_actor is not null
      and p_dueno is not null
      and public.eos_empresa_de_v109(p_actor) is not null
      and public.eos_empresa_de_v109(p_actor) = public.eos_empresa_de_v109(p_dueno)
    );
$$;

comment on function public.eos_empresa_alcanza_v112(uuid, uuid) is
  'v112: si un actor puede tocar una fila cuyo dueño es otro usuario. True cuando son el mismo o comparten empresa. Nunca true si alguna empresa es null.';

-- Si el actor no tiene empresa, la segunda rama es falsa y solo alcanza sus
-- propias filas. Falla cerrado: sin empresa resuelta nadie gana acceso.

revoke all on function public.eos_empresa_alcanza_v112(uuid, uuid) from public, anon, authenticated;
grant execute on function public.eos_empresa_alcanza_v112(uuid, uuid) to service_role;

-- ============================================================
-- Reescribir las funciones de ERP y CRM
-- ============================================================
--
-- Misma técnica que usó la v102 para pasar `current_date` a `eos_hoy_py()`:
-- leer la definición con `pg_get_functiondef`, sustituir y volver a ejecutar.
-- Es lo que evita transcribir a mano quince cuerpos de función, que es donde
-- de verdad se cuelan los errores.
--
-- El regex captura el alias opcional y lo vuelve a poner adentro:
--
--   `where c.usuario_id = p_usuario_id`
--     -> `where public.eos_empresa_alcanza_v112(p_usuario_id, c.usuario_id)`
--
-- Solo se tocan `eos_erp_*` y `eos_crm_*`. Bancard, módulos y transferencias
-- usan el mismo predicado sobre tablas que NO son del negocio y quedan como
-- están: la empresa no es la frontera de un cobro con tarjeta.

do $$
declare
  f record;
  definicion text;
  nueva text;
  cambiadas int := 0;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'eos\_erp\_%' or p.proname like 'eos\_crm\_%')
      and p.prosrc like '%usuario_id = p_usuario_id%'
      -- La propia función auxiliar no se toca a sí misma.
      and p.proname <> 'eos_empresa_alcanza_v112'
  loop
    definicion := pg_get_functiondef(f.oid);

    nueva := regexp_replace(
      definicion,
      '(\m[a-z_]+\.)?usuario_id = p_usuario_id',
      'public.eos_empresa_alcanza_v112(p_usuario_id, \1usuario_id)',
      'g'
    );

    if nueva is distinct from definicion then
      execute nueva;
      cambiadas := cambiadas + 1;
      raise notice 'v112: % ahora alcanza a su empresa', f.proname;
    end if;
  end loop;

  raise notice 'v112: % función(es) migrada(s)', cambiadas;
end $$;

-- ============================================================
-- Comprobar que no quedó ninguna a medias
-- ============================================================

create or replace function public.eos_empresa_funciones_pendientes_v112()
returns table (funcion text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.proname::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'eos\_erp\_%' or p.proname like 'eos\_crm\_%')
    and p.prosrc like '%usuario_id = p_usuario_id%'
  order by 1;
$$;

comment on function public.eos_empresa_funciones_pendientes_v112() is
  'v112: funciones de ERP/CRM que todavía filtran solo por usuario. Tiene que devolver cero filas.';

revoke all on function public.eos_empresa_funciones_pendientes_v112() from public, anon, authenticated;
grant execute on function public.eos_empresa_funciones_pendientes_v112() to service_role;
