-- v263: cuatro planes cerrados en lugar del armador.
--
-- ============================================================
-- QUÉ DECIDIÓ EL DUEÑO (20/11/2026)
-- ============================================================
--
-- Se terminan "armá tu EOS" y los atajos de la v193. Se venden cuatro planes:
--
--   Gratis               Gs.       0   10 mensajes por día y el panel financiero.
--   Finanzas Personales  Gs.  50.000   todo lo de la plata personal.
--   Emprendedor/Empresas Gs. 100.000   todo lo del negocio.
--   Full                 Gs. 130.000   los dos.
--
-- El anual sigue saliendo diez meses, como desde la v66.
--
-- Y una regla: **el plan personal no puede cargar gastos de negocio**.
--
-- ============================================================
-- POR QUÉ NO SE TOCA LA CADENA DE COBRO
-- ============================================================
--
-- Un plan es una lista fija de módulos con un precio fijo. La cadena de cobro
-- ya cobra lo que dice `eos_planes_armados.monto` (transferencia v66, Bancard
-- v71, renovación, reversión v95/v261) y activa los módulos de esa fila al
-- pagarse (trigger de la v66). Alcanza con que comprar un plan guarde una fila
-- de armado con los módulos del plan y el precio del plan: lo demás no se
-- entera. Los armados que ya están vigentes conservan su monto congelado.
--
-- `eos_guardar_paquete_v263` es la única forma nueva de guardar una compra, y
-- `/api/modulos/armado` deja de aceptar listas sueltas de módulos.
--
-- ============================================================
-- EL CANDADO DEL ÁMBITO NEGOCIO
-- ============================================================
--
-- Ventas, compras y stock ya exigen el ERP (`EOS_ACCION_SIN_MODULO_ERP`). Lo
-- que no lo exigía son los movimientos y los gastos fijos con
-- `ambito = 'negocio'`: alguien sin ERP los podía cargar por chat o desde la
-- pantalla de fijos. Un trigger en las dos tablas lo cierra en un solo lugar,
-- con el mismo código de error que ya traduce el chat. Solo mira altas y
-- cambios HACIA negocio: corregir o borrar una fila vieja de alguien cuyo ERP
-- venció sigue funcionando.
--
-- ============================================================
-- ROLLBACK
-- ============================================================
--
--   drop trigger if exists eos_negocio_exige_erp_trg on public.eos_movimientos_financieros;
--   drop trigger if exists eos_negocio_exige_erp_trg on public.eos_finanzas_fijos;
--   drop function if exists public.eos_negocio_exige_erp_v263();
--   drop function if exists public.eos_guardar_paquete_v263(uuid, text, text);
--   update public.planes set limite_mensajes = 7 where codigo = 'free';
--   (la tabla y la columna nuevas pueden quedar: nadie más las lee)

-- ============================================================
-- 1) Los planes
-- ============================================================

create table if not exists public.eos_paquetes (
  codigo text primary key,
  nombre text not null,
  descripcion text,
  modulos text[] not null check (cardinality(modulos) > 0),
  precio_mensual_pyg bigint not null check (precio_mensual_pyg > 0),
  precio_anual_pyg bigint not null check (precio_anual_pyg > 0),
  orden integer not null default 0,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

comment on table public.eos_paquetes is
  'Los planes que se venden (v263): una lista fija de módulos con un precio fijo. El monto que se cobra lo copia eos_guardar_paquete_v263 a eos_planes_armados.';

alter table public.eos_paquetes enable row level security;

drop policy if exists eos_paquetes_select on public.eos_paquetes;
create policy eos_paquetes_select on public.eos_paquetes
  for select to anon, authenticated using (activo);

revoke all on table public.eos_paquetes from anon, authenticated;
grant select on table public.eos_paquetes to anon, authenticated;
grant select, insert, update on table public.eos_paquetes to service_role;

-- Los módulos de la plata personal y los del negocio. Conversaciones, panel,
-- briefing, decisiones y documentos van en los dos: sirven igual a una persona
-- que a un negocio. El tramo de conversaciones es el mismo en los tres planes
-- y tiene el aviso interno de consumo de siempre; al cliente no se le promete
-- ni se le muestra un número.
insert into public.eos_paquetes
  (codigo, nombre, descripcion, modulos, precio_mensual_pyg, precio_anual_pyg, orden)
values
  ('finanzas_personales', 'Finanzas Personales',
   'Tu plata personal: panel, lectura de avisos del banco, alertas, resumen diario y decisiones.',
   array['conversaciones_full', 'dashboard', 'lectura', 'alertas', 'briefing', 'decisiones', 'documentos'],
   50000, 500000, 10),

  ('emprendedor', 'Emprendedor / Empresas',
   'Tu negocio: ventas, compras, stock, clientes, comprobantes, documentos y resumen diario.',
   array['conversaciones_full', 'dashboard', 'erp', 'crm', 'facturacion', 'briefing', 'decisiones', 'documentos'],
   100000, 1000000, 20),

  ('full', 'Full',
   'Finanzas Personales y Emprendedor / Empresas juntos.',
   array['conversaciones_full', 'dashboard', 'lectura', 'alertas', 'erp', 'crm', 'facturacion',
         'briefing', 'decisiones', 'documentos'],
   130000, 1300000, 30)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  modulos = excluded.modulos,
  precio_mensual_pyg = excluded.precio_mensual_pyg,
  precio_anual_pyg = excluded.precio_anual_pyg,
  orden = excluded.orden,
  activo = true;

-- Qué plan se compró, para medir y para mostrar "tu plan actual".
alter table public.eos_planes_armados
  add column if not exists paquete text;

alter table public.eos_planes_armados
  drop constraint if exists eos_planes_armados_paquete_chk;

alter table public.eos_planes_armados
  add constraint eos_planes_armados_paquete_chk
  check (paquete is null or paquete in ('finanzas_personales', 'emprendedor', 'full'));

comment on column public.eos_planes_armados.paquete is
  'Plan comprado (v263). Null = armado anterior, módulo por módulo.';

-- ============================================================
-- 2) Guardar la compra de un plan
-- ============================================================
--
-- Mismo contrato que `eos_guardar_armado` (v66): descarta lo pendiente, guarda
-- una fila `pendiente` y devuelve el precio con `armado_id`. El precio sale de
-- `eos_paquetes`; nada de lo que mande el navegador.

create or replace function public.eos_guardar_paquete_v263(
  p_usuario_id uuid,
  p_paquete text,
  p_periodicidad text default 'mensual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paquete public.eos_paquetes%rowtype;
  v_periodicidad text := case when lower(coalesce(p_periodicidad, '')) = 'anual' then 'anual' else 'mensual' end;
  v_faltan text[];
  v_monto bigint;
  v_plan text;
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_paquete
  from public.eos_paquetes
  where codigo = lower(btrim(coalesce(p_paquete, '')))
    and activo;

  if not found then
    raise exception 'EOS_PAQUETE_NO_EXISTE';
  end if;

  -- Un plan que nombra un módulo apagado o inexistente se cobraría completo y
  -- entregaría menos. Mejor no venderlo hasta corregirlo.
  select coalesce(array_agg(c), '{}')
    into v_faltan
  from unnest(v_paquete.modulos) as c
  where not exists (select 1 from public.eos_modulos m where m.codigo = c and m.activo);

  if cardinality(v_faltan) > 0 then
    raise exception 'EOS_PAQUETE_MODULO_INACTIVO: %', array_to_string(v_faltan, ', ');
  end if;

  v_monto := case when v_periodicidad = 'anual'
                  then v_paquete.precio_anual_pyg
                  else v_paquete.precio_mensual_pyg end;

  select m.plan_equivalente
    into v_plan
  from public.eos_modulos m
  where m.codigo = any(v_paquete.modulos)
    and m.plan_equivalente is not null
  order by m.precio_mensual_pyg desc
  limit 1;

  update public.eos_planes_armados
  set estado = 'reemplazado', actualizado_en = now()
  where usuario_id = p_usuario_id and estado = 'pendiente';

  insert into public.eos_planes_armados (usuario_id, modulos, periodicidad, monto, paquete)
  values (p_usuario_id, v_paquete.modulos, v_periodicidad, v_monto, v_paquete.codigo)
  returning id into v_id;

  return jsonb_build_object(
    'armado_id', v_id,
    'paquete', v_paquete.codigo,
    'nombre', v_paquete.nombre,
    'modulos', to_jsonb(v_paquete.modulos),
    'agregados', '[]'::jsonb,
    'subtotal', v_monto,
    'total', v_monto,
    'tope_aplicado', false,
    'periodicidad', v_periodicidad,
    'plan_codigo', coalesce(v_plan, 'free')
  );
end;
$$;

comment on function public.eos_guardar_paquete_v263(uuid, text, text) is
  'Guarda la compra pendiente de un plan (v263) con el precio de eos_paquetes. Solo service_role.';

revoke all on function public.eos_guardar_paquete_v263(uuid, text, text) from public;
revoke all on function public.eos_guardar_paquete_v263(uuid, text, text) from anon, authenticated;
grant execute on function public.eos_guardar_paquete_v263(uuid, text, text) to service_role;

-- ============================================================
-- 3) Gratis: 10 mensajes por día
-- ============================================================

update public.planes
set limite_mensajes = 10
where codigo = 'free'
  and limite_mensajes is distinct from 10;

-- ============================================================
-- 4) Sin ERP no se carga nada del negocio
-- ============================================================

create or replace function public.eos_negocio_exige_erp_v263()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ambito is distinct from 'negocio' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.ambito is not distinct from 'negocio' then
    return new;
  end if;

  if not public.eos_tiene_modulo(new.usuario_id, 'erp') then
    raise exception 'EOS_ACCION_SIN_MODULO_ERP';
  end if;

  return new;
end;
$$;

comment on function public.eos_negocio_exige_erp_v263() is
  'Trigger (v263): una fila con ambito negocio solo entra si la cuenta tiene el ERP. El plan Finanzas Personales no carga gastos de negocio.';

revoke all on function public.eos_negocio_exige_erp_v263() from public;
revoke all on function public.eos_negocio_exige_erp_v263() from anon, authenticated;

drop trigger if exists eos_negocio_exige_erp_trg on public.eos_movimientos_financieros;
create trigger eos_negocio_exige_erp_trg
  before insert or update of ambito on public.eos_movimientos_financieros
  for each row
  execute function public.eos_negocio_exige_erp_v263();

drop trigger if exists eos_negocio_exige_erp_trg on public.eos_finanzas_fijos;
create trigger eos_negocio_exige_erp_trg
  before insert or update of ambito on public.eos_finanzas_fijos
  for each row
  execute function public.eos_negocio_exige_erp_v263();
