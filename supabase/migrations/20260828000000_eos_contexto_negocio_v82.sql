-- Que EOS sepa cómo va el negocio antes de contestar (v82).
--
-- ============================================================
-- EL PROBLEMA
-- ============================================================
--
-- El asistente recibía cuatro cosas: el nombre, el plan, el historial y el
-- mensaje. Nada más. Ni una cifra del negocio.
--
-- Así, "¿cómo venimos este mes?" sólo se puede contestar con generalidades, y
-- "¿me alcanza para comprar la heladera?" no se puede contestar en absoluto.
-- Con el ERP y el CRM cargados eso deja de ser una limitación razonable y pasa
-- a ser la diferencia entre EOS y una pantalla más para llenar a mano.
--
-- ============================================================
-- POR QUÉ UNA SOLA FUNCIÓN
-- ============================================================
--
-- Esto corre en CADA mensaje, antes de contestar. Ocho consultas sueltas son
-- ocho viajes a la base en el camino crítico de una conversación; una función
-- es uno. Y devuelve jsonb chico —números, no filas— porque lo que sigue es
-- meterlo en un prompt y cada dato de más se paga en tokens y en latencia.
--
-- ============================================================
-- LO QUE NO SE INCLUYE, Y POR QUÉ
-- ============================================================
--
-- Nombres de clientes, detalles de operaciones, textos libres. El contexto va a
-- un modelo de lenguaje de un tercero en cada mensaje: mandar la agenda entera
-- de alguien para que pueda decir "vendiste bien" es un precio desproporcionado.
-- Van agregados. Si el usuario pregunta por un cliente puntual, para eso están
-- las acciones de lectura, que se piden cuando hacen falta.
--
-- Y sólo va lo de los módulos contratados. Quien no tiene ERP no tiene ventas
-- que contar, y quien no tiene CRM no tiene embudo: incluirlo sería pagarle
-- tokens a OpenAI para mandar ceros.

create or replace function public.eos_contexto_negocio(p_usuario_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_desde date := date_trunc('month', v_hoy)::date;
  v_tiene_erp boolean;
  v_tiene_crm boolean;
  v_finanzas jsonb := '[]'::jsonb;
  v_erp jsonb;
  v_crm jsonb;
begin
  if p_usuario_id is null then
    raise exception 'EOS_CONTEXTO_USUARIO_REQUERIDO';
  end if;

  v_tiene_erp := public.eos_tiene_modulo(p_usuario_id, 'erp');
  v_tiene_crm := public.eos_tiene_modulo(p_usuario_id, 'crm');

  /*
   * Finanzas, por moneda y SIN convertir.
   *
   * Un total en guaraníes que suma dólares a una cotización inventada es peor
   * que no tener el dato: se ve preciso y está mal. La misma regla que sostiene
   * el panel multimoneda vale acá, porque el modelo va a repetir lo que le
   * demos.
   */
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'moneda', m.moneda,
        'ingresos_mes', m.ingresos,
        'gastos_mes', m.gastos,
        'neto_mes', m.ingresos - m.gastos
      )
      order by (m.ingresos + m.gastos) desc
    ),
    '[]'::jsonb
  )
  into v_finanzas
  from (
    select
      f.moneda,
      coalesce(sum(f.monto) filter (where f.tipo = 'ingreso'), 0) as ingresos,
      coalesce(sum(f.monto) filter (where f.tipo = 'gasto'), 0) as gastos
    from public.eos_movimientos_financieros f
    where f.usuario_id = p_usuario_id
      and f.fecha >= v_desde
    group by f.moneda
  ) m;

  if v_tiene_erp then
    select jsonb_build_object(
      'ventas_mes', jsonb_build_object(
        'cantidad', coalesce(count(*), 0),
        'total', coalesce(sum(v.total), 0)
      ),
      'por_cobrar', (
        -- Ventas a crédito que todavía no entraron: es la plata que le deben.
        select coalesce(sum(v2.total), 0)
        from public.eos_erp_ventas v2
        where v2.usuario_id = p_usuario_id
          and v2.estado not in ('anulada', 'cobrada')
          and v2.movimiento_id is null
      ),
      'por_pagar', (
        select coalesce(sum(c.total), 0)
        from public.eos_erp_compras c
        where c.usuario_id = p_usuario_id
          and c.estado not in ('anulada', 'pagada')
          and c.movimiento_id is null
      ),
      'bajo_minimo', (
        -- Lo que está por faltar. Se nombra el producto porque sin el nombre
        -- el aviso no sirve para nada.
        select coalesce(
          jsonb_agg(
            jsonb_build_object('nombre', p.nombre, 'stock', p.stock_actual)
            order by p.stock_actual
          ),
          '[]'::jsonb
        )
        from (
          select p2.nombre, p2.stock_actual
          from public.eos_erp_productos p2
          where p2.usuario_id = p_usuario_id
            and p2.activo
            and p2.controla_stock
            and p2.stock_actual <= p2.stock_minimo
          order by p2.stock_actual
          limit 5
        ) p
      ),
      'mas_vendidos', (
        select coalesce(
          jsonb_agg(t.nombre order by t.unidades desc),
          '[]'::jsonb
        )
        from (
          select vi.descripcion as nombre, sum(vi.cantidad) as unidades
          from public.eos_erp_venta_items vi
          join public.eos_erp_ventas v3 on v3.id = vi.venta_id
          where v3.usuario_id = p_usuario_id
            and v3.fecha >= v_desde
            and v3.estado <> 'anulada'
          group by vi.descripcion
          order by sum(vi.cantidad) desc
          limit 3
        ) t
      )
    )
    into v_erp
    from public.eos_erp_ventas v
    where v.usuario_id = p_usuario_id
      and v.fecha >= v_desde
      and v.estado <> 'anulada';
  end if;

  if v_tiene_crm then
    select jsonb_build_object(
      'oportunidades_abiertas', jsonb_build_object(
        'cantidad', coalesce(count(*) filter (where o.etapa not in ('ganada', 'perdida')), 0),
        'monto', coalesce(sum(o.monto) filter (where o.etapa not in ('ganada', 'perdida')), 0)
      ),
      'ganadas_mes', coalesce(count(*) filter (
        where o.etapa = 'ganada' and o.cerrada_en >= v_desde
      ), 0),
      'actividades_pendientes', (
        -- Vencidas y de hoy. Lo de la semana que viene no es urgente y ocupa
        -- lugar en el prompt.
        select count(*)
        from public.eos_crm_actividades a
        where a.usuario_id = p_usuario_id
          and not a.hecha
          and a.fecha <= v_hoy
      )
    )
    into v_crm
    from public.eos_crm_oportunidades o
    where o.usuario_id = p_usuario_id;
  end if;

  return jsonb_strip_nulls(
    jsonb_build_object(
      'mes', to_char(v_desde, 'YYYY-MM'),
      'finanzas', v_finanzas,
      'erp', v_erp,
      'crm', v_crm
    )
  );
end;
$function$;

-- La llama el servidor con el rol de servicio, pasando el usuario de la sesión
-- ya verificada. Nadie más tiene por qué poder preguntarle por un tercero.
revoke all on function public.eos_contexto_negocio(uuid) from public, anon, authenticated;
