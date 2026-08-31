-- Que el contexto del negocio tampoco sume guaraníes con dólares (v94).
--
-- ============================================================
-- LA REGLA YA ESTABA ESCRITA EN ESTA MISMA FUNCIÓN
-- ============================================================
--
-- La v82 dice, arriba del bloque de finanzas y con todas las letras:
--
--   "Un total en guaraníes que suma dólares a una cotización inventada es peor
--    que no tener el dato: se ve preciso y está mal. La misma regla que
--    sostiene el panel multimoneda vale acá, porque el modelo va a repetir lo
--    que le demos."
--
-- Y treinta líneas más abajo, el bloque del ERP y el del CRM hacían exactamente
-- eso: `sum(v.total)` sobre las ventas, `sum(c.total)` sobre las compras y
-- `sum(o.monto)` sobre las oportunidades, sin mirar `moneda` en ninguno de los
-- tres. Del lado del servidor, `lib/eos/contexto-negocio.ts` remataba
-- imprimiendo el resultado con "PYG" escrito a mano.
--
-- ============================================================
-- POR QUÉ ESTE ERA EL PEOR DE LA FAMILIA
-- ============================================================
--
-- El mismo error en una pantalla es un número mal etiquetado. Acá el número
-- entra en el prompt y sale por la boca de EOS: el usuario pregunta "¿cómo
-- venimos este mes?" y recibe una cifra falsa, redactada con la seguridad de
-- una respuesta y sin ninguna etiqueta que lo delate.
--
-- Un asistente que informa mal con confianza es peor que uno que no informa.
--
-- ============================================================
-- QUÉ CAMBIA EN LA FORMA
-- ============================================================
--
-- `ventas_mes.total`, `por_cobrar`, `por_pagar` y
-- `oportunidades_abiertas.monto` dejan de ser un número suelto y pasan a ser
-- una lista `[{ moneda, total }]`, igual que ya lo era el bloque de finanzas.
--
-- Con una sola moneda —el caso de casi todos— la lista trae un elemento y el
-- prompt queda prácticamente igual de corto. Con dos, el modelo recibe las dos
-- y no tiene forma de mezclarlas.
--
-- Lo que NO cambia: `cantidad`, `ganadas_mes`, `actividades_pendientes`,
-- `bajo_minimo` y `mas_vendidos`. Contar operaciones o unidades entre monedas
-- es legítimo; lo que no se puede sumar es la plata.
--
-- ============================================================
-- ACÁ EL ORDEN SE INVIERTE: PRIMERO EL CÓDIGO, DESPUÉS ESTO
-- ============================================================
--
-- La regla del proyecto es aplicar la migración ANTES de desplegar
-- (`docs/puesta-en-marcha-migraciones.md`), y existe porque desplegar primero
-- deja código esperando algo que la base todavía no tiene.
--
-- Esta vez es al revés, y hay que verlo antes de correrla. El código
-- desplegado hoy lee `ventas_mes.total`, `por_cobrar` y
-- `oportunidades_abiertas.monto` como NÚMEROS. Si esta migración corre antes
-- del deploy, esas claves desaparecen, `formatearMonto` recibe `undefined` y
-- el prompt de cada conversación se llena de "₲ NaN".
--
-- Al revés no pasa nada: el código nuevo con la base vieja no encuentra
-- `por_moneda`, y entonces dice "8 ventas" sin monto. Pierde un dato; no
-- inventa ninguno.
--
-- **Entonces: mergear y desplegar la rama primero, y correr esta migración
-- después.** Que la regla tenga una excepción no la invalida — lo que la
-- invalida es aplicarla sin mirar en qué dirección rompe.

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

  -- Finanzas, por moneda y SIN convertir. Igual que en la v82.
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
    v_erp := jsonb_build_object(
      'ventas_mes', jsonb_build_object(
        'cantidad', (
          select count(*)
          from public.eos_erp_ventas v
          where v.usuario_id = p_usuario_id
            and v.fecha >= v_desde
            and v.estado <> 'anulada'
        ),
        'por_moneda', (
          select coalesce(
            jsonb_agg(jsonb_build_object('moneda', t.moneda, 'total', t.total) order by t.total desc),
            '[]'::jsonb
          )
          from (
            select v.moneda, sum(v.total) as total
            from public.eos_erp_ventas v
            where v.usuario_id = p_usuario_id
              and v.fecha >= v_desde
              and v.estado <> 'anulada'
            group by v.moneda
          ) t
        )
      ),
      -- Ventas a crédito que todavía no entraron: es la plata que le deben.
      'por_cobrar', (
        select coalesce(
          jsonb_agg(jsonb_build_object('moneda', t.moneda, 'total', t.total) order by t.total desc),
          '[]'::jsonb
        )
        from (
          select v2.moneda, sum(v2.total) as total
          from public.eos_erp_ventas v2
          where v2.usuario_id = p_usuario_id
            and v2.estado not in ('anulada', 'cobrada')
            and v2.movimiento_id is null
          group by v2.moneda
        ) t
      ),
      'por_pagar', (
        select coalesce(
          jsonb_agg(jsonb_build_object('moneda', t.moneda, 'total', t.total) order by t.total desc),
          '[]'::jsonb
        )
        from (
          select c.moneda, sum(c.total) as total
          from public.eos_erp_compras c
          where c.usuario_id = p_usuario_id
            and c.estado not in ('anulada', 'pagada')
            and c.movimiento_id is null
          group by c.moneda
        ) t
      ),
      -- Lo que está por faltar. Se nombra el producto porque sin el nombre
      -- el aviso no sirve para nada. Unidades, no plata: no se agrupa.
      'bajo_minimo', (
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
    );
  end if;

  if v_tiene_crm then
    v_crm := jsonb_build_object(
      'oportunidades_abiertas', jsonb_build_object(
        'cantidad', (
          select count(*)
          from public.eos_crm_oportunidades o
          where o.usuario_id = p_usuario_id
            and o.etapa not in ('ganada', 'perdida')
        ),
        'por_moneda', (
          select coalesce(
            jsonb_agg(jsonb_build_object('moneda', t.moneda, 'monto', t.monto) order by t.monto desc),
            '[]'::jsonb
          )
          from (
            select o.moneda, sum(o.monto) as monto
            from public.eos_crm_oportunidades o
            where o.usuario_id = p_usuario_id
              and o.etapa not in ('ganada', 'perdida')
            group by o.moneda
          ) t
        )
      ),
      'ganadas_mes', (
        select count(*)
        from public.eos_crm_oportunidades o
        where o.usuario_id = p_usuario_id
          and o.etapa = 'ganada'
          and o.cerrada_en >= v_desde
      ),
      -- Vencidas y de hoy. Lo de la semana que viene no es urgente y ocupa
      -- lugar en el prompt.
      'actividades_pendientes', (
        select count(*)
        from public.eos_crm_actividades a
        where a.usuario_id = p_usuario_id
          and not a.hecha
          and a.fecha <= v_hoy
      )
    );
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
grant execute on function public.eos_contexto_negocio(uuid) to service_role;
