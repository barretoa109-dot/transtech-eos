-- Los módulos son de la empresa, no de la persona (v115).
--
-- ============================================================
-- LA v114 ENTREGÓ UNA FUNCIÓN QUE NO FUNCIONABA
-- ============================================================
--
-- Con la v114 se puede invitar a alguien, que acepte y que elija trabajar en
-- la empresa. A nivel de datos queda perfecto: es miembro, y
-- `eos_empresa_alcanza_v112` confirma que alcanza las ventas del dueño.
--
-- Y después cada pantalla del ERP le devuelve 403.
--
-- Porque `eos_tiene_modulo` mira `eos_usuario_modulos` por `usuario_id`, y el
-- invitado no contrató nada. Comprobado contra la base antes de escribir esto:
--
--   dueño tiene erp = true
--   invitado, ya miembro y con la empresa activa, alcanza los datos = true
--   invitado tiene erp = FALSE
--
-- O sea: la invitación andaba y no servía para nada.
--
-- ============================================================
-- ESTO ES UNA DECISIÓN COMERCIAL, Y HAY QUE DECIRLO
-- ============================================================
--
-- Hay dos formas de cobrar esto y el código tiene que elegir una:
--
--   · Por empresa — el negocio contrata el ERP y lo usa todo su equipo.
--   · Por persona — cada quien paga su acceso.
--
-- Se elige POR EMPRESA, por tres razones y ninguna es técnica:
--
--   1. El catálogo de la v66 ya está escrito así: "erp 120.000", "crm 90.000",
--      con un tope de Gs. 500.000 para el armado. Son precios de negocio, no
--      de puesto.
--   2. No existe ningún concepto de asiento ni de cupo de usuarios en todo el
--      modelo. Cobrar por persona exigiría inventarlo entero.
--   3. Sin esto, invitar a alguien no sirve para nada, que es exactamente el
--      estado del que venimos.
--
-- Si algún día se cobra por puesto, el cambio vive acá adentro: esta función
-- es el único lugar que decide si alguien entra.
--
-- ============================================================
-- SE SUMA, NO SE REEMPLAZA
-- ============================================================
--
-- La condición vieja —tener el módulo uno mismo— se conserva. Alguien que
-- contrató el ERP para su propio negocio lo sigue teniendo aunque después lo
-- inviten a otra empresa y active esa. Quitárselo sería cobrarle algo que
-- deja de poder usar.

create or replace function public.eos_tiene_modulo(p_usuario_id uuid, p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- 1. Lo contrató la persona.
    exists (
      select 1
      from public.eos_usuario_modulos um
      join public.eos_modulos m on m.codigo = um.modulo_codigo
      where um.usuario_id = p_usuario_id
        and um.modulo_codigo = lower(btrim(p_modulo))
        and um.estado = 'activo'
        -- El vencimiento se compara acá y no con un cron que marque 'vencido':
        -- un cron que no corrió deja módulos activos gratis, y este chequeo es
        -- el que decide si alguien entra o no.
        and (um.vencimiento is null or um.vencimiento > now())
        -- Si el módulo se apagó globalmente, no importa qué diga la fila.
        and m.activo = true
    )
    -- 2. O lo contrató el DUEÑO de la empresa en la que está trabajando.
    --
    -- Se mira la empresa ACTIVA y no todas las que integra: si alguien es
    -- miembro de tres negocios, tener el ERP en uno no le da el ERP mientras
    -- trabaja en otro. Lo que se ve tiene que corresponder al negocio en el
    -- que está parado.
    or exists (
      select 1
      from public.eos_empresa_miembros yo
      join public.eos_empresa_miembros dueno
        on dueno.empresa_id = yo.empresa_id
       and dueno.rol = 'propietario'
      join public.eos_usuario_modulos um on um.usuario_id = dueno.usuario_id
      join public.eos_modulos m on m.codigo = um.modulo_codigo
      where yo.usuario_id = p_usuario_id
        and yo.activa
        and um.modulo_codigo = lower(btrim(p_modulo))
        and um.estado = 'activo'
        and (um.vencimiento is null or um.vencimiento > now())
        and m.activo = true
    );
$$;

comment on function public.eos_tiene_modulo(uuid, text) is
  'v115: si alguien puede usar un módulo. Lo tiene si lo contrató, o si lo contrató el dueño de la empresa en la que está trabajando. Los módulos son del negocio, no del puesto.';

-- ============================================================
-- La lista que ve el usuario tiene que decir lo mismo
-- ============================================================
--
-- `eos_mis_modulos` alimenta la pantalla "Mis módulos". Si siguiera mostrando
-- solo lo contratado por la persona, un invitado vería la lista vacía y las
-- pantallas del negocio funcionando: dos afirmaciones opuestas sobre lo mismo,
-- que es peor que cualquiera de las dos por separado.

-- La firma NO cambia: sigue devolviendo (codigo, nombre, estado, vencimiento,
-- origen). Agregar una columna obligaría a un `drop function`, y de esta
-- cuelga `eos_mis_modulos`, que es lo que lee la pantalla. Los módulos que
-- llegan por la empresa se marcan con `origen = 'empresa'`, que es
-- literalmente de dónde vienen.

create or replace function public.eos_modulos_de_usuario(p_usuario_id uuid)
returns table (
  codigo text,
  nombre text,
  estado text,
  vencimiento timestamptz,
  origen text
)
language sql
stable
security definer
set search_path = ''
as $$
  with propios as (
    select um.modulo_codigo as cod, um.estado as est, um.vencimiento as vto, um.origen as org
    from public.eos_usuario_modulos um
    where um.usuario_id = p_usuario_id
      and um.estado = 'activo'
      and (um.vencimiento is null or um.vencimiento > now())
  ),
  de_empresa as (
    select um.modulo_codigo, um.estado, um.vencimiento, 'empresa'::text
    from public.eos_empresa_miembros yo
    join public.eos_empresa_miembros dueno
      on dueno.empresa_id = yo.empresa_id and dueno.rol = 'propietario'
    join public.eos_usuario_modulos um on um.usuario_id = dueno.usuario_id
    where yo.usuario_id = p_usuario_id
      and yo.activa
      and dueno.usuario_id <> p_usuario_id
      and um.estado = 'activo'
      and (um.vencimiento is null or um.vencimiento > now())
      -- Lo que ya tiene propio no se repite: se mostraría dos veces el mismo
      -- módulo, una como suyo y otra como de la empresa.
      and not exists (select 1 from propios p where p.cod = um.modulo_codigo)
  )
  select m.codigo, m.nombre, t.est, t.vto, t.org
  from (
    select cod, est, vto, org from propios
    union all
    select * from de_empresa
  ) t
  join public.eos_modulos m on m.codigo = t.cod
  where m.activo = true
  order by m.orden, m.codigo;
$$;

comment on function public.eos_modulos_de_usuario(uuid) is
  'v115: los módulos que alguien puede usar, propios o de la empresa en la que trabaja. Los de la empresa vienen con origen = empresa.';
