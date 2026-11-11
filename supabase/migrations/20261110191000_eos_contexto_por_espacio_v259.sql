-- El chat contesta con lo del espacio en el que está parado (v259).
--
-- ============================================================
-- LO QUE REPORTÓ EL DUEÑO
-- ============================================================
--
-- 11/11/2026, parado en "Mi negocio", preguntó "dame un resumen de mis
-- objetivos actuales". EOS contestó con los ₲ 3.000.000 de su American
-- Express del Itaú, cuánto quiere mantener de consumo mensual de esa tarjeta
-- y, en el mismo párrafo, con la ampliación de la granja.
--
-- La tarjeta es de la persona. La granja es del negocio. Son dos espacios
-- que el producto separa desde la v136 en la base y desde el 05/10/2026 en
-- el menú, y el chat —que es la parte que más se usa— los seguía mezclando en cada
-- respuesta, porque nunca supo en cuál de los dos estaba.
--
-- ============================================================
-- POR QUÉ PASABA
-- ============================================================
--
-- `eos_contexto_negocio(uuid)` arma de una sola vez TODO lo que el modelo
-- recibe en cada mensaje, sin mirar ningún espacio:
--
--   * los movimientos del mes del negocio Y los de la persona;
--   * la posición —cuentas, tarjetas y deudas— SIEMPRE `ambito = 'personal'`,
--     también cuando quien pregunta está en el negocio (de ahí la Amex);
--   * los objetivos SIN filtro de ámbito, los de los dos lados juntos;
--   * el ERP y el CRM, también cuando quien pregunta está en Personal.
--
-- Rotular no alcanzó. La v137 puso "NEGOCIO" y "VOS" a los dos bloques de
-- movimientos y el contexto marca "[negocio]" en cada objetivo desde que
-- existe el ámbito (v144): con eso el modelo
-- PUEDE distinguirlos, pero sigue teniendo las dos cosas adelante, y a una
-- pregunta abierta ("mis objetivos") contesta con todo lo que ve. La única
-- forma de que no mezcle lo que no tiene que mezclar es no mandárselo.
--
-- ============================================================
-- LA FORMA: UNA FUNCIÓN CON NOMBRE PROPIO
-- ============================================================
--
-- `eos_contexto_del_espacio(usuario, ambito)` es el contexto de siempre con
-- `p_ambito` adentro, que dice desde qué espacio se escribe:
--
--   'negocio'  → el negocio y nada más: sus movimientos, su ERP, su CRM, sus
--                cuentas y tarjetas, sus deudas y sus objetivos.
--   'personal' → la persona y nada más: sus movimientos, su posición y sus
--                objetivos. Sin catálogo, sin ventas, sin cartera.
--   null       → todo junto, exactamente como hasta hoy.
--
-- El null no es pereza: WhatsApp no tiene espacios (v256 dejó sus
-- conversaciones en 'personal' como lado seguro, no como clasificación), así
-- que ahí seguir mandando las dos cosas es lo correcto. El día que WhatsApp
-- sepa de espacios, pasa el suyo y listo.
--
-- Nombre nuevo y no un parámetro más en `eos_contexto_negocio`, por la
-- lección de la v90 y la v242: `create or replace` con un parámetro de más NO
-- reemplaza la función, crea una segunda firma viva al lado de la primera —y
-- la elección de cuál corre pasa a depender de cuántos argumentos manda cada
-- llamador—. `npm run migraciones` lo bloquea desde entonces.
--
-- `eos_contexto_negocio(uuid)` se queda, con su nombre y su comportamiento, y
-- ahora delega con null. No es herencia muerta: esta migración se aplica
-- DESPUÉS del merge (ver CLAUDE.md), así que hay una ventana en la que el
-- código nuevo corre contra la base vieja. En esa ventana el TypeScript
-- reintenta con la función de siempre y el chat no se queda sin contexto;
-- mezclado, como hasta hoy, pero contestando.
--
-- ============================================================
-- Y LA MEMORIA, QUE NO TENÍA ESPACIO
-- ============================================================
--
-- `eos_memory` guarda en texto libre lo que la persona le contó ("quiero
-- saldar los 3 millones de la Amex") y viaja entero en cada mensaje. Desde
-- acá nace con el ámbito de la conversación donde se guardó, que ya lo tiene
-- (v256), y el chat le pide solo las de su espacio.
--
-- Las que ya están quedan en NULL a propósito, y en NULL se ven en los dos
-- lados. Rellenarlas desde `conversaciones.ambito` sería tomar por
-- clasificación un default: toda conversación anterior a la v256 quedó en
-- 'personal' sin que nadie lo eligiera, y la memoria de un negocio
-- desaparecería de su propio espacio. Lo ya guardado se sigue viendo en los
-- dos; lo nuevo nace separado.

-- ============================================================
-- 1) La memoria sabe de qué espacio es
-- ============================================================

alter table public.eos_memory
  add column if not exists ambito text;

alter table public.eos_memory
  drop constraint if exists eos_memory_ambito_check;

alter table public.eos_memory
  add constraint eos_memory_ambito_check
  check (ambito is null or ambito in ('negocio', 'personal'));

-- El chat pide "las de este usuario, de este espacio o sin espacio", activas
-- y por importancia: el índice va por ahí.
create index if not exists eos_memory_ambito_idx
  on public.eos_memory (usuario_id, ambito, importancia desc)
  where estado = 'activo';

comment on column public.eos_memory.ambito is
  'v259: de qué espacio es lo que se recordó. NULL = de antes de la v259 o guardado sin conversación: se sigue viendo en los dos espacios.';

/*
 * El ámbito se hereda de la conversación, en un trigger y no en cada función.
 *
 * GUARDAR_MEMORIA se escribe desde el ejecutor de acciones, y ese insert está
 * copiado en veinte migraciones distintas (una por cada versión del ejecutor).
 * Tocarlas todas para agregar una columna es exactamente el error que el
 * propio repo tiene anotado: "una acción nueva se da de alta en cuatro
 * lugares, y la cuarta es la que se olvida, y no da error visible". Acá la
 * regla se escribe una vez y vale para el ejecutor que venga después.
 */
create or replace function public.eos_ambito_de_la_memoria()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- Solo cuando no se declaró. Si alguien lo manda explícito, manda él.
  if new.ambito is null and new.conversacion_id is not null then
    select c.ambito
    into new.ambito
    from public.conversaciones c
    where c.id = new.conversacion_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists eos_ambito_de_la_memoria_trg on public.eos_memory;

create trigger eos_ambito_de_la_memoria_trg
  before insert on public.eos_memory
  for each row
  execute function public.eos_ambito_de_la_memoria();

comment on function public.eos_ambito_de_la_memoria() is
  'v259: una memoria nace con el ámbito de la conversación donde se guardó. Sin conversación queda NULL, que se ve en los dos espacios.';

-- ============================================================
-- 2) El mensaje que quedó esperando vuelve a su espacio
-- ============================================================
--
-- Cuando la IA no responde, el mensaje se guarda y se reintenta solo cada
-- cinco minutos (v214). El reintento rehace el turno desde la fila, así que
-- la fila tiene que guardar el espacio igual que ya guarda `app_nativa`: sin
-- esto, un mensaje escrito en "Mi negocio" se contesta, media hora después,
-- con la plata de los dos lados.
--
-- NULL es "este canal no tiene espacios" (WhatsApp) o "la fila es anterior a
-- la v259": las dos se reintentan como hasta hoy.

alter table public.eos_mensajes_en_espera_v214
  add column if not exists ambito text;

alter table public.eos_mensajes_en_espera_v214
  drop constraint if exists eos_mensajes_en_espera_v214_ambito_check;

alter table public.eos_mensajes_en_espera_v214
  add constraint eos_mensajes_en_espera_v214_ambito_check
  check (ambito is null or ambito in ('negocio', 'personal'));

comment on column public.eos_mensajes_en_espera_v214.ambito is
  'v259: el espacio desde el que se escribió, para que el reintento arme el mismo contexto. NULL = canal sin espacios.';

-- ============================================================
-- 3) El contexto del mensaje, acotado al espacio
-- ============================================================
--
-- Copia de la v204 —la última definición en el repositorio— con el ámbito
-- adentro. Lo que no cambió no se tocó, para que el diff se lea.

create or replace function public.eos_contexto_del_espacio(p_usuario_id uuid, p_ambito text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_desde date := date_trunc('month', v_hoy)::date;
  /*
   * Un ámbito que no es ninguno de los dos se trata como null: todo junto,
   * como antes de esta migración. Es la degradación segura — el TypeScript ya
   * valida lo que manda, así que acá solo puede llegar por un error nuestro, y
   * ante un error nuestro es mejor que EOS conteste de más y no que se quede
   * sin una sola cifra del negocio de quien le escribe.
   */
  v_ambito text := case when p_ambito in ('negocio', 'personal') then p_ambito else null end;
  v_del_negocio boolean := v_ambito is null or v_ambito = 'negocio';
  v_de_la_persona boolean := v_ambito is null or v_ambito = 'personal';
  /*
   * De quién es la posición —cuentas, tarjetas, deudas—. Hasta la v204 era
   * SIEMPRE 'personal', también parado en el negocio: por eso la tarjeta de
   * la persona aparecía en una pregunta del negocio. Sin espacio se mantiene
   * 'personal', que es lo que hacía hasta hoy.
   */
  v_ambito_posicion text := coalesce(v_ambito, 'personal');
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

  -- El ERP y el CRM son del negocio: en Personal no se preguntan siquiera.
  v_tiene_erp := v_del_negocio and public.eos_tiene_modulo(p_usuario_id, 'erp');
  v_tiene_crm := v_del_negocio and public.eos_tiene_modulo(p_usuario_id, 'crm');

  -- Finanzas, por moneda y SIN convertir. Igual que en la v82.
  if v_del_negocio then
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
  end if;

  -- Y la de la persona, aparte.
  --
  -- Hasta la v136 esto era una sola consulta sin filtro, así que el modelo
  -- recibía "entró X, salió Y" con la venta del negocio y el sueldo de la
  -- persona sumados en el mismo renglón. Cualquier respuesta sobre cómo venía
  -- el mes era sobre una mezcla que no le pasa a nadie.
  if v_de_la_persona then
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
  end if;

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
       *
       * `stock`, desde la v166: solo para el producto que CONTROLA stock. El
       * que no lo controla no tiene una cantidad de la que EOS pueda estar
       * seguro, y afirmar un número ahí sería peor que no decir nada.
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
              'sin_costo', t.costo is null,
              'stock', case when t.controla_stock then t.stock_actual else null end,
              -- La moneda del precio (v204). Sin ella, un producto a USD 120
              -- le llegaba al modelo como "Gs. 120".
              'moneda', t.moneda
            )
            order by t.unidades desc, t.nombre
          ),
          '[]'::jsonb
        )
        from (
          select
            p3.nombre,
            p3.precio_venta,
            p3.moneda,
            p3.costo,
            p3.controla_stock,
            p3.stock_actual,
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
   *
   * Desde la v259 son las del espacio en el que se está parado: en el negocio,
   * las cuentas y las tarjetas del negocio; en Personal, las suyas.
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
          and c.ambito = v_ambito_posicion
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
          and t.ambito = v_ambito_posicion
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
          and d.ambito = v_ambito_posicion
          and coalesce(d.estado, 'al_dia') <> 'saldada'
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
          and (v_ambito is null or g.ambito = v_ambito)
          and coalesce(g.estado, 'activo') = 'activo'
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
      -- El espacio viaja en el contexto: el TypeScript escribe con él el
      -- encabezado que le dice al modelo dónde está parado.
      'ambito', v_ambito,
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
revoke all on function public.eos_contexto_del_espacio(uuid, text) from public, anon, authenticated;
grant execute on function public.eos_contexto_del_espacio(uuid, text) to service_role;

comment on function public.eos_contexto_del_espacio(uuid, text) is
  'v259: el contexto del chat acotado al espacio (negocio / personal). Con p_ambito null devuelve los dos, como antes de la v259.';

-- ============================================================
-- 4) La firma de siempre, que ahora delega
-- ============================================================
--
-- No se borra: la llama el código desplegado, y WhatsApp —que no tiene
-- espacios— la va a seguir llamando. Null adentro = todo junto, que es lo que
-- devolvía hasta hoy.

create or replace function public.eos_contexto_negocio(p_usuario_id uuid)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select public.eos_contexto_del_espacio(p_usuario_id, null::text);
$function$;

revoke all on function public.eos_contexto_negocio(uuid) from public, anon, authenticated;
grant execute on function public.eos_contexto_negocio(uuid) to service_role;

comment on function public.eos_contexto_negocio(uuid) is
  'v259: la firma de siempre, para quien no tiene espacio que declarar (WhatsApp, código desplegado). Delega en la de dos argumentos con ámbito null.';
