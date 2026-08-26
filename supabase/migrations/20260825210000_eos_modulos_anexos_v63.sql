-- EOS — Módulos anexos (ERP, CRM y lo que venga)
--
-- ============================================================
-- POR QUÉ ESTO NO PUEDE SER OTRO PLAN
-- ============================================================
--
-- Hoy un usuario tiene UN plan: `usuarios.plan` es una columna de texto, y
-- toda la cadena de cobro —`solicitudes_pago.plan_codigo`, `asignar_plan_eos`,
-- la renovación de Bancard— asume esa unicidad.
--
-- El pedido es otro: "si el usuario quiere implementar ERP solo paga esa
-- funcionalidad, que ya viene conectada a EOS". Eso es un ANEXO, no un plan.
-- Modelarlo como plan obligaría a crear un plan por cada combinación posible
-- —"pro", "pro con ERP", "pro con CRM", "pro con ERP y CRM"— y esa lista se
-- duplica con cada módulo nuevo. Con cuatro módulos son dieciséis planes.
--
-- Por eso: el plan sigue siendo uno, y los módulos son filas aparte que se
-- suman. Contratar el ERP no toca `usuarios.plan`, y cancelarlo tampoco.
--
-- ============================================================
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO
-- ============================================================
--
--  * NO toca `solicitudes_pago` ni `historial_pagos`. El cobro de un módulo se
--    conecta después, coordinado con la certificación de Bancard que está en
--    curso. Acá se define QUIÉN TIENE QUÉ; cómo se paga viene después, y una
--    activación por cortesía o interna ya funciona sin ninguna pasarela.
--  * NO asume empresas con varios usuarios. EOS entero es por `usuario_id`
--    —hasta `eos_business_twins_v14` tiene el negocio como clave del usuario—,
--    así que un módulo se activa por usuario. El día que existan cuentas de
--    empresa con equipo, eso es una migración del producto entero, no de esta
--    tabla.

-- ============================================================
-- 1) Catálogo de módulos
-- ============================================================

create table if not exists public.eos_modulos (
  codigo text primary key check (codigo = lower(codigo) and length(codigo) between 2 and 40),
  nombre text not null,
  descripcion text,

  precio_mensual_pyg bigint not null default 0 check (precio_mensual_pyg >= 0),
  precio_anual_pyg bigint not null default 0 check (precio_anual_pyg >= 0),

  -- Plan mínimo requerido para poder contratarlo, o null si se puede contratar
  -- suelto. Es un DATO y no una regla en código a propósito: si mañana se
  -- decide que el ERP exige plan "pro", se cambia una fila, no un deploy.
  plan_minimo text,

  -- `activo` apaga el módulo entero (deja de funcionar para todos);
  -- `es_publico` solo lo saca de la vitrina. Un módulo interno del ecosistema
  -- TransTech es activo pero no público: existe, funciona, no se vende.
  activo boolean not null default true,
  es_publico boolean not null default false,

  orden smallint not null default 100,
  creado_en timestamptz not null default now()
);

comment on table public.eos_modulos is
  'Catálogo de anexos contratables (ERP, CRM). Se suman al plan del usuario, no lo reemplazan.';
comment on column public.eos_modulos.plan_minimo is
  'Plan mínimo para contratarlo. NULL = se puede contratar suelto. Es dato para poder cambiarlo sin deploy.';
comment on column public.eos_modulos.es_publico is
  'false = existe y funciona pero no se ofrece. Es el modo de los módulos internos del ecosistema.';

-- ============================================================
-- 2) Qué módulos tiene cada usuario
-- ============================================================

create table if not exists public.eos_usuario_modulos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  modulo_codigo text not null references public.eos_modulos(codigo) on delete restrict,

  estado text not null default 'activo'
    check (estado in ('activo', 'vencido', 'cancelado', 'suspendido')),

  inicio timestamptz not null default now(),

  -- NULL = sin vencimiento. Es el caso de los módulos internos y las
  -- cortesías: no dependen de que alguien se acuerde de renovarlos.
  vencimiento timestamptz,

  -- De dónde salió esta activación. `interno` es el uso del propio ecosistema
  -- TransTech; sin esta columna, un módulo regalado y uno pagado se ven igual
  -- y las métricas de ingresos mienten.
  origen text not null default 'pago'
    check (origen in ('pago', 'cortesia', 'interno', 'prueba')),

  -- Trazabilidad del cobro cuando lo hubo. Sin FK dura a propósito: el módulo
  -- tiene que poder activarse sin pasar por la pasarela.
  referencia_pago text,

  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Un usuario tiene una sola fila por módulo. Renovar EXTIENDE el
  -- vencimiento de esta fila; no apila filas nuevas que después haya que
  -- sumar para saber hasta cuándo llega.
  constraint eos_usuario_modulos_uniq unique (usuario_id, modulo_codigo)
);

create index if not exists eos_usuario_modulos_activos_idx
  on public.eos_usuario_modulos (usuario_id, estado)
  where estado = 'activo';

comment on table public.eos_usuario_modulos is
  'Anexos activos por usuario. Una fila por usuario y módulo: renovar extiende el vencimiento, no apila filas.';

-- ============================================================
-- 3) La única pregunta que importa: ¿este usuario tiene este módulo?
-- ============================================================
--
-- Vive en la base y no en TypeScript porque la respuesta tiene que ser la
-- misma para la app, para un cron y para cualquier consulta futura. Una regla
-- de acceso duplicada en dos lenguajes se desincroniza, y cuando se
-- desincroniza alguien accede a lo que no pagó o deja de acceder a lo que sí.

create or replace function public.eos_tiene_modulo(
  p_usuario_id uuid,
  p_modulo text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
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
  );
$$;

comment on function public.eos_tiene_modulo(uuid, text) is
  'Única fuente de verdad para el acceso a un anexo. El vencimiento se evalúa acá, no por cron. SOLO service_role: recibe un uuid arbitrario.';

-- ------------------------------------------------------------
-- La versión que puede llamar el usuario: SIN parámetro de uuid.
-- ------------------------------------------------------------
--
-- Las de arriba son `security definer` y reciben el id como argumento, así que
-- otorgárselas a `authenticated` dejaría que cualquiera pregunte por la cuenta
-- de otro y aprenda qué contrató. No es un dato catastrófico, pero es un dato
-- ajeno, y no hay ninguna razón para entregarlo.
--
-- Estas toman el usuario de `auth.uid()`: no hay uuid que elegir.

create or replace function public.eos_tengo_modulo(p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.eos_tiene_modulo((select auth.uid()), p_modulo);
$$;

comment on function public.eos_tengo_modulo(text) is
  'Igual que eos_tiene_modulo pero sobre la sesión actual. Es la que se le da al usuario.';

-- Lista de los módulos vigentes de un usuario, para pintar la interfaz de una
-- sola consulta en vez de una por módulo. Solo service_role, por lo mismo.
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
  select
    m.codigo,
    m.nombre,
    um.estado,
    um.vencimiento,
    um.origen
  from public.eos_usuario_modulos um
  join public.eos_modulos m on m.codigo = um.modulo_codigo
  where um.usuario_id = p_usuario_id
    and um.estado = 'activo'
    and (um.vencimiento is null or um.vencimiento > now())
    and m.activo = true
  order by m.orden, m.codigo;
$$;

create or replace function public.eos_mis_modulos()
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
  select * from public.eos_modulos_de_usuario((select auth.uid()));
$$;

comment on function public.eos_mis_modulos() is
  'Los módulos de la sesión actual. Es la que se le da al usuario; la variante con uuid es solo del servidor.';

-- ============================================================
-- 4) Activar o renovar un módulo, de forma idempotente
-- ============================================================
--
-- La regla de renovación es la misma que ya usa el plan en
-- `eos_bancard_confirmar_cobro_v51`: si el módulo está vigente, los días
-- nuevos se suman a lo que quedaba. Cobrarle a alguien una renovación y
-- borrarle los doce días que le sobraban es la clase de detalle que termina
-- en un reclamo, y con razón.

create or replace function public.eos_activar_modulo(
  p_usuario_id uuid,
  p_modulo text,
  p_dias integer default null,
  p_origen text default 'pago',
  p_referencia_pago text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modulo text := lower(btrim(coalesce(p_modulo, '')));
  v_catalogo public.eos_modulos%rowtype;
  v_previo public.eos_usuario_modulos%rowtype;
  v_base timestamptz;
  v_vencimiento timestamptz;
begin
  if v_modulo = '' then
    raise exception 'EOS_MODULO_REQUERIDO';
  end if;

  if p_dias is not null and p_dias <= 0 then
    raise exception 'EOS_MODULO_DIAS_INVALIDOS';
  end if;

  select * into v_catalogo from public.eos_modulos where codigo = v_modulo;

  if not found then
    raise exception 'EOS_MODULO_NO_EXISTE';
  end if;

  if not v_catalogo.activo then
    raise exception 'EOS_MODULO_INACTIVO';
  end if;

  select * into v_previo
  from public.eos_usuario_modulos
  where usuario_id = p_usuario_id and modulo_codigo = v_modulo
  for update;

  -- Sin días, el módulo no vence: cortesías y uso interno del ecosistema.
  if p_dias is null then
    v_vencimiento := null;
  else
    -- Si lo que tenía sigue vigente, se parte de ahí. Si venció, de ahora.
    v_base := case
      when found and v_previo.vencimiento is not null and v_previo.vencimiento > now()
        then v_previo.vencimiento
      else now()
    end;
    v_vencimiento := v_base + make_interval(days => p_dias);
  end if;

  insert into public.eos_usuario_modulos (
    usuario_id, modulo_codigo, estado, inicio, vencimiento, origen, referencia_pago
  ) values (
    p_usuario_id, v_modulo, 'activo',
    coalesce(v_previo.inicio, now()), v_vencimiento, p_origen, p_referencia_pago
  )
  on conflict (usuario_id, modulo_codigo) do update set
    estado = 'activo',
    vencimiento = excluded.vencimiento,
    origen = excluded.origen,
    -- Sin el prefijo de esquema: en el SET de un ON CONFLICT, la fila
    -- existente se referencia por el nombre del rango, que es el de la tabla.
    referencia_pago = coalesce(excluded.referencia_pago, eos_usuario_modulos.referencia_pago),
    actualizado_en = now();

  return jsonb_build_object(
    'ok', true,
    'modulo', v_modulo,
    'vencimiento', v_vencimiento,
    'renovacion', v_previo.id is not null
  );
end;
$$;

create or replace function public.eos_cancelar_modulo(
  p_usuario_id uuid,
  p_modulo text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Cancelar NO borra la fila: se pierde la historia de que alguna vez lo
  -- tuvo, y con ella la posibilidad de reactivarlo sin volver a preguntar
  -- todo. Tampoco corta el acceso al instante — lo pagado, pagado está.
  update public.eos_usuario_modulos
  set estado = 'cancelado', actualizado_en = now()
  where usuario_id = p_usuario_id
    and modulo_codigo = lower(btrim(p_modulo));

  return jsonb_build_object('ok', true, 'modulo', lower(btrim(p_modulo)));
end;
$$;

-- ============================================================
-- 5) RLS y permisos
-- ============================================================
--
-- El catálogo público lo puede leer cualquiera autenticado: es la vitrina.
-- Las activaciones las lee solo su dueño, y las escribe SOLO el servidor —
-- si `authenticated` pudiera insertar en `eos_usuario_modulos`, cualquiera se
-- regala el ERP con una llamada desde la consola del navegador.

alter table public.eos_modulos enable row level security;

drop policy if exists modulos_select_publico on public.eos_modulos;
create policy modulos_select_publico on public.eos_modulos
  for select to authenticated using (activo = true and es_publico = true);

revoke all on table public.eos_modulos from anon, authenticated;
grant select on table public.eos_modulos to authenticated;
grant select, insert, update on table public.eos_modulos to service_role;

alter table public.eos_usuario_modulos enable row level security;

drop policy if exists usuario_modulos_select on public.eos_usuario_modulos;
create policy usuario_modulos_select on public.eos_usuario_modulos
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_usuario_modulos from anon, authenticated;
grant select on table public.eos_usuario_modulos to authenticated;
grant select, insert, update on table public.eos_usuario_modulos to service_role;

-- Las de escritura, solo el servidor.
revoke all on function public.eos_activar_modulo(uuid, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_activar_modulo(uuid, text, integer, text, text)
  to service_role;

revoke all on function public.eos_cancelar_modulo(uuid, text) from public, anon, authenticated;
grant execute on function public.eos_cancelar_modulo(uuid, text) to service_role;

-- Las de lectura CON uuid, también solo el servidor: son `security definer` y
-- el que llama elige de quién pregunta.
revoke all on function public.eos_tiene_modulo(uuid, text) from public, anon, authenticated;
grant execute on function public.eos_tiene_modulo(uuid, text) to service_role;

revoke all on function public.eos_modulos_de_usuario(uuid) from public, anon, authenticated;
grant execute on function public.eos_modulos_de_usuario(uuid) to service_role;

-- Al usuario se le dan solo las que hablan de sí mismo.
grant execute on function public.eos_tengo_modulo(text) to authenticated, service_role;
grant execute on function public.eos_mis_modulos() to authenticated, service_role;

-- ============================================================
-- 6) Los dos primeros anexos
-- ============================================================
--
-- Entran como NO públicos: existen, se pueden activar a mano para el uso
-- interno del ecosistema y para probar, pero no aparecen en la vitrina hasta
-- que tengan precio decidido y el cobro conectado. Un módulo visible que no se
-- puede comprar es una promesa incumplida en la pantalla de planes.

insert into public.eos_modulos (codigo, nombre, descripcion, es_publico, orden)
values
  ('erp', 'ERP', 'Gestión de operaciones, inventario y compras, conectada a lo que EOS ya sabe del negocio.', false, 10),
  ('crm', 'CRM', 'Clientes, oportunidades y seguimiento comercial, sobre el mismo contexto de EOS.', false, 20)
on conflict (codigo) do nothing;
