-- ============================================================
-- v104 · El embudo con el monto de verdad
-- ============================================================
--
-- La v103 colgaba del `after insert` de la venta, y ahí el total todavía es
-- cero: la venta se inserta primero y sus ítems después, así que el total se
-- calcula un instante más tarde. El embudo quedaba con oportunidades ganadas
-- de cero guaraníes.
--
-- Lo agarró la prueba de punta a punta antes de que lo viera nadie. Es
-- exactamente el tipo de error que no se nota mirando el código —la lógica de
-- etapas y de anulación estaba bien— y que en pantalla habría dicho que un
-- cliente compró nada.
--
-- Ahora el disparador también escucha el momento en que el total se escribe, y
-- la función es idempotente: si ya vinculó esta venta a una oportunidad, sólo
-- refresca el monto en vez de crear otra.

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
   * Si esta venta ya cerró una oportunidad, no se hace de nuevo: se corrige el
   * monto y listo.
   *
   * Es lo que permite que el disparador se ejecute dos veces —una al insertar
   * la venta y otra cuando se escribe su total— sin duplicar nada.
   */
  update public.eos_crm_oportunidades
  set monto = new.total,
      actualizado_en = now()
  where venta_id = new.id;

  if found then
    return new;
  end if;

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
  after insert or update of total on public.eos_erp_ventas
  for each row
  execute function public.eos_crm_ganar_por_venta_v103();

-- Y las que ya quedaron en cero, si hubiera alguna.
update public.eos_crm_oportunidades o
set monto = v.total,
    actualizado_en = now()
from public.eos_erp_ventas v
where o.venta_id = v.id
  and o.monto is distinct from v.total;
