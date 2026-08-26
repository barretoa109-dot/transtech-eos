-- EOS — El plan lo arma el usuario
--
-- ============================================================
-- POR QUÉ SE VAN LOS PLANES
-- ============================================================
--
-- Había cinco escalones —free, personal, pro, business, enterprise— y cada uno
-- era una apuesta sobre qué combinación de funciones quiere la gente. La
-- apuesta falla siempre en el mismo lugar: el que solo quiere conversar más
-- tiene que pagar un panel financiero que no usa, y el que solo quiere el panel
-- y el briefing tiene que pagar mensajes que no va a mandar.
--
-- El pedido fue explícito: "que el usuario pueda decidir qué funciones de EOS
-- quiere... así eliminamos las opciones de los demás planes y el usuario tendrá
-- una experiencia 100% personalizada".
--
-- Los módulos ya existían como anexos contratables (v63, ERP y CRM). Esto
-- extiende el mismo modelo al producto entero: cada función tiene precio, el
-- usuario prende las que quiere y paga la suma, con un techo de Gs. 500.000.
--
-- ============================================================
-- LO QUE ESTA MIGRACIÓN NO TOCA, Y POR QUÉ
-- ============================================================
--
-- No modifica NINGUNA función existente de cobro. Ni
-- `eos_create_or_reuse_transfer_request_v47`, ni `eos_bancard_confirmar_cobro`,
-- ni `asignar_plan_eos`. Hay otra sesión trabajando en la certificación de
-- Bancard sobre esas mismas funciones, y editarlas desde acá sería pisarle el
-- trabajo. Todo lo de acá es ADITIVO: una función nueva para crear la solicitud
-- con el monto armado, y un trigger que activa los módulos cuando el pago se
-- confirma. La cadena vieja sigue funcionando igual.
--
-- El truco que lo hace posible: la solicitud de pago sigue llevando un
-- `plan_codigo` de los de siempre —el que corresponde al tramo de
-- conversaciones elegido— así que `asignar_plan_eos` sigue asignando el plan y
-- el cupo de mensajes como siempre. Los módulos extra viajan en `metadata` y
-- los activa el trigger. Nada tuvo que enterarse.
--
-- TAMPOCO toca `planes.es_publico`. Apagarlos sacaría los planes de la vitrine,
-- que es lo que se quiere, pero rompería las compras de prueba de la
-- certificación en curso. La vitrine vieja desaparece por otro lado: la página
-- `/planes` ya no los muestra.

-- ============================================================
-- 1) El catálogo aprende tres cosas nuevas
-- ============================================================

alter table public.eos_modulos
  add column if not exists grupo text;

comment on column public.eos_modulos.grupo is
  'Módulos que son alternativas entre sí: se elige UNO. Lo usan los tramos de conversaciones.';

alter table public.eos_modulos
  add column if not exists limite_mensajes integer;

comment on column public.eos_modulos.limite_mensajes is
  'Mensajes por mes que habilita. NULL = no toca el cupo. -1 = sin tope.';

alter table public.eos_modulos
  add column if not exists requiere text[] not null default '{}';

comment on column public.eos_modulos.requiere is
  'Módulos sin los cuales éste no tiene dónde mostrarse. Se agregan solos al armar.';

-- El plan de siempre que corresponde a este módulo, para que la cadena de cobro
-- no se entere de nada. Solo lo llevan los tramos de conversaciones: son los
-- únicos que cambian el cupo de mensajes.
alter table public.eos_modulos
  add column if not exists plan_equivalente text;

comment on column public.eos_modulos.plan_equivalente is
  'Plan histórico equivalente, para que asignar_plan_eos siga fijando el cupo de mensajes sin cambios.';

-- ============================================================
-- 2) El catálogo
-- ============================================================
--
-- Los precios de las tres primeras líneas los fijó el usuario: Dashboard
-- Gs. 20.000, Briefing Gs. 25.000, conversaciones Gs. 45.000. El resto está
-- calibrado para que **prender absolutamente todo sume exactamente Gs. 500.000**,
-- que es el techo que prometió. Así el tope no es letra chica: es la última
-- fila de la cuenta.
--
--   conversaciones (tramo más alto)  150.000
--   erp                              120.000
--   crm                               90.000
--   lectura                           35.000
--   briefing                          25.000
--   documentos                        25.000
--   dashboard                         20.000
--   alertas                           20.000
--   decisiones                        15.000
--                                    --------
--                                     500.000
--
-- El anual se cobra por diez meses: el mismo descuento que tenían los planes.

insert into public.eos_modulos (
  codigo, nombre, descripcion, precio_mensual_pyg, precio_anual_pyg,
  grupo, limite_mensajes, requiere, plan_equivalente, activo, es_publico, orden
) values
  ('conversaciones', 'Conversaciones',
   'Hablar con EOS: 300 mensajes por mes, con toda tu memoria y tu contexto.',
   45000, 450000, 'conversaciones', 300, '{}', 'personal', true, true, 10),

  ('conversaciones_plus', 'Conversaciones sin freno',
   'Mil mensajes por mes. Para quien usa EOS todos los días y no quiere contar.',
   90000, 900000, 'conversaciones', 1000, '{}', 'pro', true, true, 11),

  ('conversaciones_full', 'Conversaciones ilimitadas',
   'Sin tope de mensajes.',
   150000, 1500000, 'conversaciones', -1, '{}', 'business', true, true, 12),

  ('dashboard', 'Panel financiero',
   'Tu disponible real, a dónde va tu plata y de dónde vino, en cada moneda que tengas.',
   20000, 200000, null, null, '{}', null, true, true, 20),

  ('briefing', 'Briefing diario',
   'El resumen del día en tu correo, antes de que abras nada.',
   25000, 250000, null, null, '{}', null, true, true, 30),

  ('documentos', 'Documentos a pedido',
   'Pedile un balance, un cuadro o un informe y te lo arma en Excel, PDF o Word.',
   25000, 250000, null, null, '{}', null, true, true, 40),

  ('lectura', 'Lectura automática',
   'EOS lee tus avisos bancarios por correo y carga los movimientos solo. Cero planilla.',
   35000, 350000, null, null, '{dashboard}', null, true, true, 50),

  ('alertas', 'Avisos antes de que pase',
   'Te avisa el 24 que el 28 no te va a alcanzar, y con cuánto.',
   20000, 200000, null, null, '{dashboard}', null, true, true, 60),

  ('decisiones', 'Decisiones y aprendizajes',
   'Lo que decidiste, cómo salió, y qué aprendió EOS de eso.',
   15000, 150000, null, null, '{}', null, true, true, 70)

on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  precio_mensual_pyg = excluded.precio_mensual_pyg,
  precio_anual_pyg = excluded.precio_anual_pyg,
  grupo = excluded.grupo,
  limite_mensajes = excluded.limite_mensajes,
  requiere = excluded.requiere,
  plan_equivalente = excluded.plan_equivalente,
  activo = excluded.activo,
  es_publico = excluded.es_publico,
  orden = excluded.orden;

-- ERP y CRM ya existían desde la v63, sin precio y fuera de la vitrine porque
-- todavía no había cómo cobrarlos. Ahora hay.
update public.eos_modulos
set precio_mensual_pyg = 120000,
    precio_anual_pyg = 1200000,
    orden = 80
where codigo = 'erp';

update public.eos_modulos
set precio_mensual_pyg = 90000,
    precio_anual_pyg = 900000,
    orden = 90
where codigo = 'crm';

-- ============================================================
-- 3) El cupo de mensajes de cada tramo
-- ============================================================
--
-- Los planes dejan de ser un producto y pasan a ser lo que siempre fueron por
-- dentro: el portador del cupo de mensajes que lee
-- `eos_reserve_message_quota_server_v75`. Se alinean con los tramos para que el
-- cupo que se cobra y el que se aplica sean el mismo número.

update public.planes set limite_mensajes = 300  where codigo = 'personal';
update public.planes set limite_mensajes = 1000 where codigo = 'pro';
update public.planes set limite_mensajes = -1   where codigo = 'business';

-- ============================================================
-- 4) El armado que eligió cada usuario
-- ============================================================
--
-- Se guarda aparte de `eos_usuario_modulos` porque son dos cosas distintas:
-- aquella dice QUÉ TIENE ACTIVO HOY, y ésta dice QUÉ CONTRATÓ Y POR CUÁNTO.
-- La renovación necesita la segunda: sin ella, el cobro del mes que viene
-- tendría que reconstruir el precio a partir de los módulos vigentes, y un
-- módulo vencido el día del cobro cambiaría el monto sin que nadie lo decida.

create table if not exists public.eos_planes_armados (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  modulos text[] not null check (cardinality(modulos) > 0),
  periodicidad text not null default 'mensual'
    check (periodicidad in ('mensual', 'anual')),

  -- Lo que se cobró, congelado. Si mañana sube el precio de un módulo, lo que
  -- este usuario ya contrató no cambia hasta que él lo cambie.
  monto bigint not null check (monto >= 0),
  moneda text not null default 'PYG',

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'vigente', 'reemplazado', 'cancelado')),

  referencia_pago text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists eos_planes_armados_usuario_idx
  on public.eos_planes_armados (usuario_id, creado_en desc);

-- Un solo armado vigente por usuario. Sin esto, dos compras seguidas dejarían
-- dos armados vigentes y la renovación no sabría cuál cobrar.
create unique index if not exists eos_planes_armados_vigente_idx
  on public.eos_planes_armados (usuario_id)
  where estado = 'vigente';

comment on table public.eos_planes_armados is
  'Lo que cada usuario armó y por cuánto. Distinto de eos_usuario_modulos, que dice qué tiene activo hoy.';

alter table public.eos_planes_armados enable row level security;

drop policy if exists planes_armados_select on public.eos_planes_armados;
create policy planes_armados_select on public.eos_planes_armados
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_planes_armados from anon, authenticated;
grant select on table public.eos_planes_armados to authenticated;
grant select, insert, update on table public.eos_planes_armados to service_role;

-- ============================================================
-- 5) El precio, calculado por la base
-- ============================================================
--
-- El navegador calcula el mismo total mientras el usuario elige, para que vea
-- el número cambiar sin ir y volver al servidor. Pero **el que cobra es éste**:
-- un total que llega del cliente no se usa jamás, ni para comparar.

create or replace function public.eos_precio_armado(
  p_modulos text[],
  p_periodicidad text default 'mensual'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_codigos text[];
  v_elegidos text[];
  v_agregados text[] := '{}';
  v_subtotal bigint := 0;
  v_total bigint;
  v_tope constant bigint := 500000;
  v_meses constant integer := 10;
  v_cambio boolean := true;
  v_codigo text;
  v_requerido text;
  v_plan text;
begin
  if p_modulos is null or cardinality(p_modulos) = 0 then
    raise exception 'EOS_ARMADO_VACIO';
  end if;

  -- Solo códigos que existen, están activos y se ofrecen.
  select coalesce(array_agg(distinct m.codigo), '{}')
    into v_codigos
  from public.eos_modulos m
  where m.activo = true
    and m.codigo in (select lower(btrim(pedido)) from unnest(p_modulos) as pedido);

  if cardinality(v_codigos) = 0 then
    raise exception 'EOS_ARMADO_VACIO';
  end if;

  -- De cada grupo de alternativas queda el MÁS CARO de los pedidos: es el que
  -- cubre a los otros. Quedarse con el más barato le daría al usuario menos de
  -- lo que pidió sin decírselo.
  select coalesce(array_agg(codigo), '{}')
    into v_elegidos
  from (
    select distinct on (coalesce(m.grupo, m.codigo)) m.codigo
    from public.eos_modulos m
    where m.codigo = any(v_codigos)
    order by coalesce(m.grupo, m.codigo), m.precio_mensual_pyg desc
  ) elegidos;

  -- Las dependencias se agregan solas.
  while v_cambio loop
    v_cambio := false;

    for v_codigo in select unnest(v_elegidos) loop
      for v_requerido in
        select unnest(m.requiere) from public.eos_modulos m where m.codigo = v_codigo
      loop
        if not (v_requerido = any(v_elegidos))
           and exists (select 1 from public.eos_modulos where codigo = v_requerido and activo) then
          v_elegidos := v_elegidos || v_requerido;
          v_agregados := v_agregados || v_requerido;
          v_cambio := true;
        end if;
      end loop;
    end loop;
  end loop;

  select coalesce(sum(m.precio_mensual_pyg), 0)
    into v_subtotal
  from public.eos_modulos m
  where m.codigo = any(v_elegidos);

  v_total := least(v_subtotal, v_tope);

  -- El tope es MENSUAL, así que el anual se calcula sobre el mensual ya
  -- topeado. Al revés, el anual pagaría por encima del techo prometido.
  if lower(coalesce(p_periodicidad, 'mensual')) = 'anual' then
    v_total := v_total * v_meses;
    v_subtotal := v_subtotal * v_meses;
  end if;

  -- Qué plan de los de siempre le corresponde: el del tramo de conversaciones
  -- elegido, o 'free' si no eligió ninguno — se puede tener EOS sin chatear.
  select m.plan_equivalente
    into v_plan
  from public.eos_modulos m
  where m.codigo = any(v_elegidos)
    and m.plan_equivalente is not null
  order by m.precio_mensual_pyg desc
  limit 1;

  return jsonb_build_object(
    'modulos', to_jsonb(v_elegidos),
    'agregados', to_jsonb(v_agregados),
    'subtotal', v_subtotal,
    'total', v_total,
    'tope_aplicado', v_subtotal > v_total,
    'periodicidad', lower(coalesce(p_periodicidad, 'mensual')),
    'plan_codigo', coalesce(v_plan, 'free')
  );
end;
$$;

comment on function public.eos_precio_armado(text[], text) is
  'El precio de un armado, calculado por la base. Un total que llega del cliente no se usa jamás.';

revoke all on function public.eos_precio_armado(text[], text) from public, anon;
grant execute on function public.eos_precio_armado(text[], text) to authenticated, service_role;

-- ============================================================
-- 6) Guardar el armado que el usuario está por pagar
-- ============================================================

create or replace function public.eos_guardar_armado(
  p_usuario_id uuid,
  p_modulos text[],
  p_periodicidad text default 'mensual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_precio jsonb;
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  v_precio := public.eos_precio_armado(p_modulos, p_periodicidad);

  -- Los armados pendientes viejos se descartan: si alguien vuelve a la
  -- pantalla y arma otra cosa, lo anterior no tiene que quedar dando vueltas
  -- listo para cobrarse.
  update public.eos_planes_armados
  set estado = 'reemplazado', actualizado_en = now()
  where usuario_id = p_usuario_id and estado = 'pendiente';

  insert into public.eos_planes_armados (usuario_id, modulos, periodicidad, monto)
  values (
    p_usuario_id,
    array(select jsonb_array_elements_text(v_precio -> 'modulos')),
    v_precio ->> 'periodicidad',
    (v_precio ->> 'total')::bigint
  )
  returning id into v_id;

  return v_precio || jsonb_build_object('armado_id', v_id);
end;
$$;

revoke all on function public.eos_guardar_armado(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.eos_guardar_armado(uuid, text[], text) to service_role;

-- ============================================================
-- 7) Activar los módulos cuando el pago se confirma
-- ============================================================
--
-- Un TRIGGER y no un cambio en las funciones de confirmación, a propósito: así
-- esta migración no toca una sola línea de la cadena de cobro que está en
-- certificación. Cuando cualquiera de los caminos —Bancard, transferencia,
-- alta manual— deje una solicitud en 'pagado', esto se despierta.

create or replace function public.eos_activar_armado_al_pagar_v66()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_armado public.eos_planes_armados%rowtype;
  v_dias integer;
  v_codigo text;
begin
  -- Solo el cruce a 'pagado', y solo si la solicitud lleva un armado.
  if new.estado is distinct from 'pagado' then return new; end if;
  if old.estado is not distinct from new.estado then return new; end if;
  if not (coalesce(new.metadata, '{}'::jsonb) ? 'armado_id') then return new; end if;

  select * into v_armado
  from public.eos_planes_armados
  where id = (new.metadata ->> 'armado_id')::uuid
    and usuario_id = new.usuario_id;

  if not found then
    raise warning 'EOS: la solicitud % dice tener un armado que no existe', new.id;
    return new;
  end if;

  v_dias := case when v_armado.periodicidad = 'anual' then 365 else 30 end;

  foreach v_codigo in array v_armado.modulos loop
    -- `eos_activar_modulo` ya sabe extender el vencimiento en vez de pisarlo:
    -- cobrarle a alguien la renovación y borrarle los días que le sobraban es
    -- la clase de detalle que termina en un reclamo, y con razón.
    perform public.eos_activar_modulo(
      new.usuario_id, v_codigo, v_dias, 'pago', new.referencia_interna
    );
  end loop;

  update public.eos_planes_armados
  set estado = 'reemplazado', actualizado_en = now()
  where usuario_id = new.usuario_id and estado = 'vigente' and id <> v_armado.id;

  update public.eos_planes_armados
  set estado = 'vigente',
      referencia_pago = new.referencia_interna,
      actualizado_en = now()
  where id = v_armado.id;

  return new;
end;
$$;

drop trigger if exists eos_activar_armado_al_pagar on public.solicitudes_pago;
create trigger eos_activar_armado_al_pagar
  after update on public.solicitudes_pago
  for each row
  execute function public.eos_activar_armado_al_pagar_v66();

-- ============================================================
-- 8) Que a nadie se le apague EOS en el camino
-- ============================================================
--
-- A partir de ahora las funciones se piden por módulo. Las cuentas que ya
-- existen nunca contrataron ninguno, así que sin esto abrirían EOS y no
-- tendrían nada. Se les regalan todos, sin vencimiento y marcados como
-- cortesía, para que las métricas de ingresos no los cuenten como ventas.

insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen, notas)
select u.id, m.codigo, 'activo', 'cortesia',
       'Cuenta anterior al plan armado (v66)'
from auth.users u
cross join public.eos_modulos m
where m.activo = true
on conflict (usuario_id, modulo_codigo) do nothing;

-- ============================================================
-- 9) Cobrar el armado por transferencia
-- ============================================================
--
-- Espeja a `eos_create_or_reuse_transfer_request_v47` en todo salvo en de dónde
-- sale el monto: allá lo dicta el precio del plan, acá el armado que el usuario
-- eligió. Es una función NUEVA y no un cambio en aquella, por lo mismo que el
-- trigger: la cadena de cobro está en certificación y no se toca desde acá.
--
-- La solicitud igual lleva un `plan_codigo` de los de siempre —el del tramo de
-- conversaciones— para que la confirmación siga asignando el plan y el cupo de
-- mensajes sin enterarse de nada. Los módulos van en `metadata.armado_id` y los
-- activa el trigger de la sección 7.

create or replace function public.eos_crear_solicitud_armado_v66(
  p_usuario_id uuid,
  p_armado_id uuid,
  p_comprador jsonb default '{}'::jsonb,
  p_cuenta_destino jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_armado public.eos_planes_armados%rowtype;
  v_plan text;
  v_request public.solicitudes_pago%rowtype;
  v_reference text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_armado
  from public.eos_planes_armados
  where id = p_armado_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_ARMADO_NO_EXISTE';
  end if;

  if v_armado.monto <= 0 then
    raise exception 'EOS_ARMADO_MONTO_INVALIDO';
  end if;

  -- El plan que le corresponde por su tramo de conversaciones. Sin tramo, el
  -- de entrada: se puede tener EOS sin chatear.
  select coalesce(m.plan_equivalente, 'free')
    into v_plan
  from public.eos_modulos m
  where m.codigo = any(v_armado.modulos)
    and m.plan_equivalente is not null
  order by m.precio_mensual_pyg desc
  limit 1;

  v_plan := coalesce(v_plan, 'free');

  -- Una solicitud pendiente para el MISMO armado se reutiliza. Sin esto, quien
  -- vuelve a la pantalla de pago genera una referencia nueva cada vez y termina
  -- con cinco transferencias pendientes por la misma compra.
  select s.* into v_request
  from public.solicitudes_pago s
  where s.usuario_id = p_usuario_id
    and lower(coalesce(s.proveedor, '')) = 'transferencia'
    and s.estado = 'pendiente_transferencia'
    and (s.vencimiento_pago is null or s.vencimiento_pago >= now())
    and coalesce(s.metadata, '{}'::jsonb) ->> 'armado_id' = p_armado_id::text
    and not (coalesce(s.metadata, '{}'::jsonb) ? 'comprobante')
  order by s.created_at desc
  limit 1
  for update;

  if found then
    update public.solicitudes_pago
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'comprador', p_comprador,
          'cuenta_destino', p_cuenta_destino,
          'last_reused_at', now()
        ),
        updated_at = now()
    where id = v_request.id
    returning * into v_request;

    return jsonb_build_object(
      'ok', true, 'reused', true,
      'solicitud_id', v_request.id,
      'referencia', v_request.referencia_interna,
      'monto', v_request.monto,
      'estado', v_request.estado,
      'vencimiento_pago', v_request.vencimiento_pago,
      'plan_codigo', v_request.plan_codigo,
      'periodicidad', v_request.periodicidad
    );
  end if;

  v_reference := 'EOSAR' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 18));

  insert into public.solicitudes_pago (
    usuario_id, plan_codigo, periodicidad, moneda, monto,
    proveedor, estado, referencia_interna, vencimiento_pago, metadata
  ) values (
    p_usuario_id, v_plan, v_armado.periodicidad, v_armado.moneda, v_armado.monto,
    'transferencia', 'pendiente_transferencia', v_reference,
    now() + interval '48 hours',
    jsonb_build_object(
      'comprador', p_comprador,
      'cuenta_destino', p_cuenta_destino,
      'armado_id', p_armado_id,
      'armado_modulos', to_jsonb(v_armado.modulos),
      'request_creation_version', 'v66'
    )
  )
  returning * into v_request;

  return jsonb_build_object(
    'ok', true, 'reused', false,
    'solicitud_id', v_request.id,
    'referencia', v_request.referencia_interna,
    'monto', v_request.monto,
    'estado', v_request.estado,
    'vencimiento_pago', v_request.vencimiento_pago,
    'plan_codigo', v_request.plan_codigo,
    'periodicidad', v_request.periodicidad
  );
end;
$$;

revoke all on function public.eos_crear_solicitud_armado_v66(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.eos_crear_solicitud_armado_v66(uuid, uuid, jsonb, jsonb)
  to service_role;
