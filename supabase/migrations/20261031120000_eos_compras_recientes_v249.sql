-- ============================================================
-- Por qué existe (caso real, 31/10/2026)
-- ============================================================
--
-- Al armar un documento ("hacéme un Excel completo de mi negocio"), EOS le
-- preguntaba a la persona por datos que ya estaban cargados en Compras y
-- gastos: "¿cuánto pagaste por cada lechón?", "¿hubo flete?". El contexto que
-- recibe el modelo en CADA mensaje (`eos_contexto_negocio`) solo trae totales
-- del mes, nunca el detalle línea por línea de una compra — y a propósito: ese
-- contexto viaja en cada turno de cada conversación, y meterle el detalle de
-- compras ahí encarecería y alargaría cada mensaje, no solo los que arman un
-- documento.
--
-- Esta función es ese detalle, aparte, para pedirlo SOLO cuando se arma un
-- documento (`lib/eos/compras-recientes.ts`, llamada desde
-- `procesar-mensaje.ts` cuando `eleccion.motivo === "documento"`). Mismo
-- criterio que ya usa `eos_contexto_negocio`: filtra por `usuario_id`
-- directo, no por empresa — así se comporta hoy el resto del contexto del
-- negocio, y los dos tienen que decir lo mismo.

create or replace function public.eos_compras_recientes(p_usuario_id uuid, p_meses int default 6)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_meses int := greatest(1, least(coalesce(p_meses, 6), 24));
  v_desde date := (now() at time zone 'America/Asuncion')::date - (v_meses || ' months')::interval;
  v_resultado jsonb;
begin
  if p_usuario_id is null then
    raise exception 'EOS_COMPRAS_USUARIO_REQUERIDO';
  end if;

  select coalesce(jsonb_agg(fila), '[]'::jsonb)
  into v_resultado
  from (
    select
      c.fecha,
      ct.nombre as proveedor,
      c.moneda,
      c.total,
      c.estado,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'descripcion', i.descripcion,
              'cantidad', i.cantidad,
              'precio_unitario', i.precio_unitario,
              'total', i.total
            )
            order by i.orden
          ),
          '[]'::jsonb
        )
        from public.eos_erp_compra_items i
        where i.compra_id = c.id
      ) as items
    from public.eos_erp_compras c
    left join public.eos_crm_contactos ct on ct.id = c.contacto_id
    where c.usuario_id = p_usuario_id
      and c.estado <> 'anulada'
      and c.fecha >= v_desde
    order by c.fecha desc, c.creado_en desc
    -- Tope de 50: es contexto para un documento, no un reporte. Las últimas
    -- 50 compras cubren meses de un negocio chico sin inflar el prompt.
    limit 50
  ) fila;

  return v_resultado;
end;
$function$;

comment on function public.eos_compras_recientes(uuid, int) is
  'El detalle línea por línea de las últimas compras del negocio (hasta 50, dentro de la ventana pedida). Solo para armar un documento: eos_contexto_negocio ya da los totales del mes para cada turno.';

revoke all on function public.eos_compras_recientes(uuid, int) from public, anon, authenticated;
grant execute on function public.eos_compras_recientes(uuid, int) to service_role;
