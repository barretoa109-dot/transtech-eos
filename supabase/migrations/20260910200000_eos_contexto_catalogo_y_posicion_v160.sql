-- El catálogo Y la posición, después de que dos sesiones se pisaran.
--
-- ============================================================
-- QUÉ PASÓ, PORQUE VALE MÁS QUE EL ARREGLO
-- ============================================================
--
-- Dos sesiones trabajando sobre el mismo repositorio escribieron, sin
-- saberlo, dos migraciones distintas con el MISMO timestamp:
--
--   20260910180000_eos_contexto_con_catalogo_v158.sql   (la otra sesión)
--   20260910180000_eos_contexto_con_posicion_v158.sql   (ésta)
--
-- Las dos reescribían `eos_contexto_negocio` entera, cada una desde la v137
-- y sin el bloque de la otra.
--
-- La del catálogo se aplicó primero y anotó la versión en el historial
-- remoto. Entonces `supabase db push` empezó a contestar "Remote database is
-- up to date" a la otra: mismo número de versión, ya aplicada. El cuerpo con
-- la posición nunca llegó, y el CLI no dijo una palabra.
--
-- Se salió del paso con una v159 que volvía a declarar la función — y como
-- estaba generada desde el archivo SIN catálogo, borró el catálogo de
-- producción. Se detectó llamando a la función contra producción, que es la
-- única forma de saberlo: el historial de migraciones decía que todo estaba
-- bien.
--
-- `npm run migraciones` ya tenía escrito el control que encuentra esto y lo
-- gritó apenas los dos archivos convivieron en el mismo árbol. Existe desde
-- el 2 de septiembre, por dos choques del mismo día. Lo que falló no fue el
-- control: fue empujar a producción antes de traer lo del otro.
--
-- ============================================================
-- LO QUE ESTA MIGRACIÓN HACE
-- ============================================================
--
-- Se genera desde el archivo del CATÁLOGO y se le injerta el bloque de la
-- POSICIÓN. En ese orden a propósito: al revés se tira el catálogo, que es
-- exactamente lo que ya pasó una vez hoy.
--
-- El porqué de cada bloque está en su migración: el catálogo en la v158, la
-- posición en la v159.

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
  v_personal jsonb := '[]'::jsonb;
  v_posicion jsonb;
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
      and f.ambito = 'negocio'
    group by f.moneda
  ) m;

  -- Y la de la persona, aparte.
  --
  -- Hasta la v136 esto era una sola consulta sin filtro, así que el modelo
  -- recibía "entró X, salió Y" con la venta del negocio y el sueldo de la
  -- persona sumados en el mismo renglón. Cualquier respuesta sobre cómo venía
  -- el mes era sobre una mezcla que no le pasa a nadie.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'moneda', m.moneda,
        'ingresos_mes', round(m.ingresos),
        'gastos_mes', round(m.gastos),
        'neto_mes', round(m.ingresos - m.gastos)
      )
      order by m.moneda
    ),
    '[]'::jsonb
  )
  into v_personal
  from (
    select
      f.moneda,
      coalesce(sum(f.monto) filter (where f.tipo = 'ingreso'), 0) as ingresos,
      coalesce(sum(f.monto) filter (where f.tipo = 'gasto'), 0) as gastos
    from public.eos_movimientos_financieros f
    where f.usuario_id = p_usuario_id
      and f.fecha >= v_desde
      and f.ambito = 'personal'
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
        -- Clave vieja, con su valor viejo: la lee el código todavía desplegado.
        -- Se borra cuando ese código deje de existir.
        'total', (
          select coalesce(sum(v.total), 0)
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
      -- Escalar viejo (mezclado) y lista nueva (por moneda), una al lado de la
      -- otra. `por_cobrar` no puede ser un número y una lista a la vez.
      'por_cobrar', (
        select coalesce(sum(v2.total), 0)
        from public.eos_erp_ventas v2
        where v2.usuario_id = p_usuario_id
          and v2.estado not in ('anulada', 'cobrada')
          and v2.movimiento_id is null
      ),
      'por_cobrar_monedas', (
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
        select coalesce(sum(c.total), 0)
        from public.eos_erp_compras c
        where c.usuario_id = p_usuario_id
          and c.estado not in ('anulada', 'pagada')
          and c.movimiento_id is null
      ),
      'por_pagar_monedas', (
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
      /*
       * EL CATÁLOGO, QUE ES LO QUE EL MODELO NO PODÍA VER
       *
       * Hasta la v158, de todo el negocio el prompt llevaba tres nombres de
       * productos: los más vendidos. Con eso, la instrucción "NO ADIVINES
       * NOMBRES: si en su catálogo puede haber varios que empiecen así,
       * preguntá cuál" le pedía al modelo que razonara sobre una lista que
       * nunca había visto.
       *
       * El resultado eran las dos formas de equivocarse, las dos caras:
       * inventar un nombre que no existe —y que la venta muera al
       * resolverlo— o preguntar cuál es de una lista de uno.
       *
       * Con el catálogo adelante, el modelo escribe el nombre TAL CUAL está
       * guardado y la resolución deja de ser una apuesta.
       *
       * Cuarenta y no todos: el catálogo entra en CADA mensaje, y lo que
       * entra en cada mensaje se paga en cada mensaje. Cuarenta nombres son
       * unos 300 tokens; un catálogo de quinientos productos serían 4.000 y
       * media respuesta de latencia. Se eligen por lo que se vendió en el
       * mes —lo que la persona nombra es lo que vende— y se dice cuántos
       * quedaron afuera, para que el modelo sepa que la lista no es todo.
       */
      'catalogo', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'nombre', t.nombre,
              'precio', t.precio_venta,
              -- Sin costo no hay margen. Que el modelo lo sepa es lo que le
              -- permite pedir el costo UNA vez, en vez de calcular un margen
              -- que no puede calcular.
              'sin_costo', t.costo is null
            )
            order by t.unidades desc, t.nombre
          ),
          '[]'::jsonb
        )
        from (
          select
            p3.nombre,
            p3.precio_venta,
            p3.costo,
            coalesce((
              select sum(vi2.cantidad)
              from public.eos_erp_venta_items vi2
              join public.eos_erp_ventas v4 on v4.id = vi2.venta_id
              where vi2.producto_id = p3.id
                and v4.fecha >= v_desde
                and v4.estado <> 'anulada'
            ), 0) as unidades
          from public.eos_erp_productos p3
          where p3.usuario_id = p_usuario_id
            and p3.activo
          order by unidades desc, p3.nombre
          limit 40
        ) t
      ),
      'catalogo_total', (
        select count(*)
        from public.eos_erp_productos p4
        where p4.usuario_id = p_usuario_id and p4.activo
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
        -- Clave vieja, con su valor viejo. Ver la cabecera.
        'monto', (
          select coalesce(sum(o.monto), 0)
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

  /*
   * La posición de la persona: lo que tiene, lo que debe y lo que quiere.
   *
   * Cuatro consultas más en el camino crítico de una conversación. Las cuatro
   * van por índice de usuario_id y con tope, y el costo se paga una vez por
   * mensaje: sin ellas el modelo no puede contestar "cuánto tengo", que es la
   * pregunta más frecuente que le hacen a un asistente de finanzas.
   */
  v_posicion := jsonb_strip_nulls(jsonb_build_object(
    'cuentas', (
      select jsonb_agg(x order by x ->> 'nombre')
      from (
        select jsonb_build_object(
          'nombre', c.nombre,
          'moneda', c.moneda,
          'saldo', c.saldo_declarado,
          -- La fecha va SIEMPRE pegada al saldo. Un saldo de hace tres semanas
          -- no es el de hoy, y sin la fecha el modelo no tiene cómo saberlo.
          'al', c.saldo_declarado_el
        ) as x
        from public.eos_finanzas_cuentas c
        where c.usuario_id = p_usuario_id
          and c.ambito = 'personal'
          and c.activa
          and c.saldo_declarado is not null
        order by c.saldo_declarado desc
        limit 8
      ) t
    ),
    'tarjetas', (
      select jsonb_agg(x order by x ->> 'nombre')
      from (
        select jsonb_build_object(
          'nombre', coalesce(t.nombre, t.emisor),
          'moneda', t.moneda,
          'cierra', t.dia_cierre,
          'vence', t.dia_vencimiento,
          'resumen', t.pago_total,
          'minimo', t.pago_minimo,
          'resumen_al', t.resumen_al
        ) as x
        from public.eos_finanzas_tarjetas t
        where t.usuario_id = p_usuario_id
          and t.ambito = 'personal'
          and t.activa
        order by t.created_at
        limit 5
      ) t
    ),
    'deudas', (
      select jsonb_agg(x order by (x ->> 'saldo')::numeric desc)
      from (
        select jsonb_build_object(
          'acreedor', d.acreedor,
          'moneda', d.moneda,
          'saldo', d.saldo_declarado,
          'cuota', d.cuota_monto,
          'dia', d.cuota_dia
        ) as x
        from public.eos_finanzas_deudas d
        where d.usuario_id = p_usuario_id
          and d.ambito = 'personal'
          and coalesce(d.estado, 'activa') = 'activa'
          and d.saldo_declarado is not null
          and d.saldo_declarado > 0
        order by d.saldo_declarado desc
        limit 8
      ) t
    ),
    'objetivos', (
      select jsonb_agg(x order by x ->> 'para' nulls last)
      from (
        select jsonb_build_object(
          'titulo', g.titulo,
          'ambito', g.ambito,
          'moneda', g.moneda,
          'objetivo', g.valor_objetivo,
          'actual', g.valor_actual,
          'para', g.fecha_limite
        ) as x
        from public.eos_goals g
        where g.usuario_id = p_usuario_id
          and coalesce(g.estado, 'activo') in ('activo', 'en_progreso')
        order by g.fecha_limite nulls last
        limit 5
      ) t
    )
  ));

  if v_posicion = '{}'::jsonb then
    v_posicion := null;
  end if;

  return jsonb_strip_nulls(
    jsonb_build_object(
      'mes', to_char(v_desde, 'YYYY-MM'),
      'finanzas', v_finanzas,
      'personal', v_personal,
      'posicion', v_posicion,
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
