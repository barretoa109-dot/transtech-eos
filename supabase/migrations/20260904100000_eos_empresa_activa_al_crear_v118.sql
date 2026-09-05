-- La empresa del usuario nuevo nace activa (v118).
--
-- ============================================================
-- TODO USUARIO CREADO DESPUÉS DE LA v114 NACIÓ SIN EMPRESA ACTIVA
-- ============================================================
--
-- La v114 agregó `activa` con `default false` y rellenó a los que ya
-- existían. Lo que no hizo fue tocar el trigger que crea la empresa de cada
-- usuario nuevo, que sigue insertando la membresía sin esa columna:
--
--     insert into public.eos_empresa_miembros (empresa_id, usuario_id, rol)
--     values (v_empresa, new.id, 'propietario');
--
-- O sea que el arreglo duró exactamente hasta el siguiente registro.
-- Comprobado contra producción antes de escribir esto: 3 de los 10 usuarios
-- tienen su única membresía con `activa = false`, los tres `propietario`, los
-- tres creados después de la v114.
--
-- ============================================================
-- POR QUÉ NO SE NOTÓ
-- ============================================================
--
-- Porque `eos_empresa_de_v109` tiene un respaldo escrito para este caso: si
-- ninguna fila está marcada, desempata por propietario. Nadie perdió acceso a
-- sus datos, y por eso el bug pasó inadvertido.
--
-- Lo que sí rompía es todo lo que pregunta por `activa` directamente:
--
--   · `MiEmpresa` decide qué mostrar con `empresas.find(e => e.activa)`, así
--     que a esos usuarios les decía "Todavía no elegiste una empresa" cuando
--     tenían una y estaban trabajando en ella.
--   · `eos_tiene_modulo` (v115) exige `yo.activa` para los módulos que llegan
--     por la empresa. Un invitado en ese estado no habría heredado nada.
--
-- ============================================================
-- Y ES PRERREQUISITO DE LA ETAPA 4
-- ============================================================
--
-- Mientras las policies acepten `usuario_id`, el respaldo alcanza. Cuando
-- queden solo con `empresa_id` —la migración que sigue a esta— el valor de
-- `activa` pasa a decidir qué ve cada persona, y una columna que miente para
-- todos los usuarios nuevos no puede ser el eje de eso.

-- ============================================================
-- 1. El trigger, con la columna que le faltaba
-- ============================================================

create or replace function public.eos_crear_empresa_inicial_v109()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  insert into public.eos_empresas (nombre)
  values ('Mi negocio')
  returning id into v_empresa;

  -- `activa = true` desde el arranque: es la única empresa que tiene, así que
  -- es en la que está trabajando. Dejarla en false obliga a que algo la active
  -- después, y ese "algo" no existía.
  insert into public.eos_empresa_miembros (empresa_id, usuario_id, rol, activa)
  values (v_empresa, new.id, 'propietario', true);

  return new;
end;
$$;

comment on function public.eos_crear_empresa_inicial_v109() is
  'v118: crea la empresa propia del usuario y la deja ACTIVA. Antes nacía inactiva y solo el respaldo de eos_empresa_de_v109 evitaba que se notara.';

-- ============================================================
-- 2. Los que ya nacieron mal
-- ============================================================
--
-- El mismo relleno de la v114. Se repite en vez de darlo por hecho: es
-- idempotente —solo toca a quien no tiene ninguna activa— y es la única forma
-- de arreglar a los que se registraron en el medio.

update public.eos_empresa_miembros m
set activa = true
where m.rol = 'propietario'
  and not exists (
    select 1 from public.eos_empresa_miembros otra
    where otra.usuario_id = m.usuario_id and otra.activa
  );

-- ============================================================
-- 3. Que no vuelva a pasar en silencio
-- ============================================================
--
-- El índice único de la v114 garantiza "como mucho una activa". Lo que
-- faltaba era comprobar la otra mitad: "al menos una". Esta función la mide, y
-- la etapa 4 no se aplica hasta que dé cero.

create or replace function public.eos_empresa_sin_activa_v118()
returns table (usuario_id uuid, membresias bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.usuario_id, count(*)
  from public.eos_empresa_miembros m
  where not exists (
    select 1 from public.eos_empresa_miembros o
    where o.usuario_id = m.usuario_id and o.activa
  )
  group by m.usuario_id;
$$;

comment on function public.eos_empresa_sin_activa_v118() is
  'v118: usuarios con membresías pero ninguna activa. Tiene que dar cero filas: si devuelve algo, alguien está trabajando sin empresa elegida.';

revoke all on function public.eos_empresa_sin_activa_v118() from public, anon, authenticated;
grant execute on function public.eos_empresa_sin_activa_v118() to service_role;
