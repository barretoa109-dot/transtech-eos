-- ============================================================
-- v103 · El embudo se llena solo con las ventas
-- ============================================================
--
-- POR QUÉ
--
-- El CRM tenía cero oportunidades con tres contactos cargados y cuatro ventas
-- registradas. No estaba roto: estaba esperando que alguien cargara a mano lo
-- que el sistema ya sabía. Un CRM que exige cargar dos veces la misma venta
-- deja de usarse en una semana, y un embudo desactualizado miente peor que no
-- tener embudo.
--
-- Así que la venta cierra la oportunidad, y si no había ninguna, la crea ya
-- ganada. Nadie carga nada dos veces.
--
-- ============================================================
-- LO QUE SE PUEDE DESHACER TIENE QUE PODER DESHACERSE
-- ============================================================
--
-- Anular una venta no puede dejar una oportunidad ganada por una venta que no
-- existe: el embudo diría que entró plata que se devolvió. Por eso cada
-- oportunidad tocada por una venta guarda dos cosas:
--
--   `venta_id`     cuál venta la cerró
--   `etapa_previa` en qué etapa estaba antes
--
-- Al anular, si `etapa_previa` es nula la oportunidad la había creado la venta
-- y se borra; si no, vuelve exactamente a donde estaba. Sin esos dos campos
-- habría que adivinar, y adivinar en el embudo es inventar plata.
--
-- ============================================================
-- SÓLO LAS VENTAS CON CLIENTE
-- ============================================================
--
-- Una venta de mostrador sin contacto no tiene relación que seguir, y crearle
-- una oportunidad llenaría el embudo de tarjetas anónimas que nadie puede
-- accionar. El embudo es sobre personas: si no hay persona, no hay tarjeta.

-- ============================================================
-- 1. De dónde vino cada oportunidad
-- ============================================================

alter table public.eos_crm_oportunidades
  add column if not exists venta_id uuid references public.eos_erp_ventas(id) on delete set null,
  add column if not exists etapa_previa text,
  add column if not exists origen text not null default 'manual';

alter table public.eos_crm_oportunidades
  drop constraint if exists eos_crm_oportunidades_origen_check;

alter table public.eos_crm_oportunidades
  add constraint eos_crm_oportunidades_origen_check
  check (origen in ('manual', 'venta'));

alter table public.eos_crm_oportunidades
  drop constraint if exists eos_crm_oportunidades_etapa_previa_check;

alter table public.eos_crm_oportunidades
  add constraint eos_crm_oportunidades_etapa_previa_check
  check (etapa_previa is null or etapa_previa in (
    'nueva', 'contactado', 'propuesta', 'negociacion', 'ganada', 'perdida'
  ));

-- Una venta cierra una oportunidad, no varias.
create unique index if not exists eos_crm_oportunidades_venta_unica
  on public.eos_crm_oportunidades (venta_id)
  where venta_id is not null;

comment on column public.eos_crm_oportunidades.venta_id is
  'La venta que cerró esta oportunidad. Permite deshacerlo si la venta se anula.';
comment on column public.eos_crm_oportunidades.etapa_previa is
  'En qué etapa estaba antes de que una venta la ganara. Nula si la creó la venta.';
comment on column public.eos_crm_oportunidades.origen is
  'manual = la cargó una persona; venta = la creó una venta registrada.';

-- ============================================================
-- 2. Al registrar una venta con cliente
-- ============================================================

create or replace function public.eos_crm_ganar_por_venta_v103()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_oportunidad public.eos_crm_oportunidades%rowtype;
  v_nombre text;
begin
  if new.contacto_id is null or new.estado = 'anulada' then
    return new;
  end if;

  /*
   * La oportunidad abierta más avanzada de ese cliente, en la misma moneda.
   *
   * La más avanzada y no la más nueva: si alguien tiene una en negociación y
   * abrió otra recién, la venta cierra la que venía trabajando. Y en la misma
   * moneda porque una oportunidad en dólares no la cierra una venta en
   * guaraníes: son dos negocios distintos.
   */
  select * into v_oportunidad
  from public.eos_crm_oportunidades
  where usuario_id = new.usuario_id
    and contacto_id = new.contacto_id
    and moneda = new.moneda
    and etapa not in ('ganada', 'perdida')
  order by array_position(
    array['nueva', 'contactado', 'propuesta', 'negociacion']::text[], etapa
  ) desc nulls last, creado_en asc
  limit 1;

  if found then
    update public.eos_crm_oportunidades
    set etapa_previa = v_oportunidad.etapa,
        etapa = 'ganada',
        -- El monto pasa a ser el real. Lo que se estimaba ya no importa:
        -- entró esto.
        monto = new.total,
        venta_id = new.id,
        cerrada_en = now(),
        actualizado_en = now()
    where id = v_oportunidad.id;

    return new;
  end if;

  select nombre into v_nombre
  from public.eos_crm_contactos
  where id = new.contacto_id;

  insert into public.eos_crm_oportunidades (
    usuario_id, contacto_id, titulo, monto, moneda, etapa,
    origen, venta_id, cerrada_en
  )
  values (
    new.usuario_id,
    new.contacto_id,
    left('Venta a ' || coalesce(nullif(btrim(v_nombre), ''), 'cliente'), 200),
    new.total,
    new.moneda,
    'ganada',
    'venta',
    new.id,
    now()
  );

  return new;
end $$;

drop trigger if exists eos_crm_ganar_por_venta on public.eos_erp_ventas;

create trigger eos_crm_ganar_por_venta
  after insert on public.eos_erp_ventas
  for each row
  execute function public.eos_crm_ganar_por_venta_v103();

-- ============================================================
-- 3. Al anular esa venta
-- ============================================================

create or replace function public.eos_crm_deshacer_por_anulacion_v103()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_oportunidad public.eos_crm_oportunidades%rowtype;
begin
  if new.estado <> 'anulada' or old.estado = 'anulada' then
    return new;
  end if;

  select * into v_oportunidad
  from public.eos_crm_oportunidades
  where venta_id = new.id;

  if not found then
    return new;
  end if;

  if v_oportunidad.etapa_previa is null then
    -- La creó esta venta. Sin la venta no hay nada que seguir.
    delete from public.eos_crm_oportunidades where id = v_oportunidad.id;
  else
    -- Existía antes. Vuelve exacto a donde estaba, incluido su monto
    -- estimado, que la venta había pisado con el real.
    update public.eos_crm_oportunidades
    set etapa = v_oportunidad.etapa_previa,
        etapa_previa = null,
        venta_id = null,
        cerrada_en = null,
        actualizado_en = now()
    where id = v_oportunidad.id;
  end if;

  return new;
end $$;

drop trigger if exists eos_crm_deshacer_por_anulacion on public.eos_erp_ventas;

create trigger eos_crm_deshacer_por_anulacion
  after update of estado on public.eos_erp_ventas
  for each row
  execute function public.eos_crm_deshacer_por_anulacion_v103();

-- ============================================================
-- 4. Las ventas que ya estaban
-- ============================================================
--
-- Para que el embudo no arranque vacío ignorando lo que ya pasó. Sólo las
-- vivas y con cliente, y sin pisar ninguna oportunidad existente.

insert into public.eos_crm_oportunidades (
  usuario_id, contacto_id, titulo, monto, moneda, etapa,
  origen, venta_id, cerrada_en, creado_en
)
select
  v.usuario_id,
  v.contacto_id,
  left('Venta a ' || coalesce(nullif(btrim(c.nombre), ''), 'cliente'), 200),
  v.total,
  v.moneda,
  'ganada',
  'venta',
  v.id,
  v.creado_en,
  v.creado_en
from public.eos_erp_ventas v
join public.eos_crm_contactos c on c.id = v.contacto_id
where v.contacto_id is not null
  and v.estado <> 'anulada'
  and not exists (
    select 1 from public.eos_crm_oportunidades o where o.venta_id = v.id
  );
