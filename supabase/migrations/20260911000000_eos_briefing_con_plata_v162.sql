-- El briefing diario no sabía una sola cifra de plata.
--
-- ============================================================
-- QUÉ SABÍA, Y QUÉ NO
-- ============================================================
--
-- `eos_daily_briefing_context_v5` es todo lo que el modelo ve para escribir
-- el briefing de la mañana. Traía objetivos, tareas, seguimientos, acciones
-- recientes, memorias, diagnósticos, la actividad de la semana y seis
-- contadores.
--
-- Ni un guaraní. Ni del negocio ni de la persona.
--
-- Así que el resumen diario de un producto de finanzas podía hablar de todo
-- menos de si el mes cierra, de cuánto le deben, de cuándo vence la tarjeta
-- o de qué cuota cae la semana que viene. El encargo lo pedía con esas
-- palabras: un briefing genuinamente útil, que incluya Personal.
--
-- ============================================================
-- UN RESUMEN, NO EL CONTEXTO DEL CHAT
-- ============================================================
--
-- Se pensó en llamar a `eos_contexto_negocio` desde la vista para no
-- duplicar nada. No se hizo: esa función son diez subconsultas y la vista se
-- lee de a 500 filas de una, así que serían cinco mil consultas en el cron
-- de la mañana.
--
-- Y además el briefing necesita otra cosa. El chat necesita el DETALLE —qué
-- cuenta, qué producto, qué nombre exacto— para poder ejecutar. El briefing
-- necesita el TITULAR: cuánto entró, cuánto salió, cuánto hay, cuánto se
-- debe y qué vence. Son cinco agregados con índice, no un volcado.
--
-- ============================================================
-- CADA NÚMERO CON SU FECHA, TAMBIÉN ACÁ
-- ============================================================
--
-- `tiene` viaja con `al`, que es la fecha del saldo declarado MÁS VIEJO de
-- esa moneda. Es a propósito el más viejo y no el más nuevo: si una de las
-- cuentas se declaró hace tres semanas, el total de hoy vale lo que vale la
-- peor de sus partes, y el briefing tiene que poder decirlo.
--
-- Se parte de la definición VIVA de la vista, no del archivo de agosto: hay
-- otra sesión trabajando sobre esta base y regenerar desde un archivo local
-- ya borró algo de producción una vez hoy.

create or replace view public.eos_daily_briefing_context_v5
with (security_invoker = true)
as
SELECT usuario.id AS usuario_id,
    (now() AT TIME ZONE 'America/Asuncion'::text)::date AS briefing_date,
    COALESCE(NULLIF(btrim(profile.nombre_visible), ''::text), NULLIF(btrim(usuario.nombre), ''::text), 'Usuario'::text) AS nombre,
    COALESCE(NULLIF(btrim(profile.tipo_usuario), ''::text), 'indefinido'::text) AS tipo_usuario,
    COALESCE(NULLIF(btrim(profile.rubro), ''::text), ''::text) AS rubro,
    COALESCE(NULLIF(btrim(profile.etapa_actual), ''::text), 'inicial'::text) AS etapa_actual,
    COALESCE(profile.score_general, latest_intelligence.score, 0) AS score_actual,
    COALESCE(profile.prioridad_actual, ''::text) AS prioridad_actual,
    COALESCE(profile.resumen_actual, ''::text) AS resumen_actual,
    COALESCE(goals.items, '[]'::jsonb) AS objetivos,
    COALESCE(tasks.items, '[]'::jsonb) AS tareas,
    COALESCE(followups.items, '[]'::jsonb) AS seguimientos,
    COALESCE(actions.items, '[]'::jsonb) AS acciones_recientes,
    COALESCE(memory.items, '[]'::jsonb) AS memorias_relevantes,
    COALESCE(intelligence.items, '[]'::jsonb) AS diagnosticos_recientes,
    COALESCE(activity.items, '[]'::jsonb) AS actividad_reciente,
    jsonb_build_object('objetivos_activos', COALESCE(goals.total, 0), 'progreso_promedio', COALESCE(goals.average_progress, 0), 'tareas_pendientes', COALESCE(tasks.total, 0), 'seguimientos_pendientes', COALESCE(followups.total, 0), 'acciones_con_error', COALESCE(actions.issue_total, 0), 'mensajes_ultimos_7_dias', COALESCE(activity.total, 0)) AS metricas,
    NOT (EXISTS ( SELECT 1
           FROM eos_daily_briefings existing
          WHERE existing.usuario_id = usuario.id AND existing.briefing_date = (now() AT TIME ZONE 'America/Asuncion'::text)::date AND existing.estado = 'listo'::text)) AS necesita_generacion,
    dinero.resumen AS finanzas
   FROM usuarios usuario
     LEFT JOIN LATERAL ( SELECT source.id,
            source.usuario_id,
            source.tipo_usuario,
            source.nombre_visible,
            source.rubro,
            source.etapa_actual,
            source.score_general,
            source.prioridad_actual,
            source.resumen_actual,
            source.created_at,
            source.updated_at
           FROM eos_profiles source
          WHERE source.usuario_id = usuario.id
          ORDER BY source.updated_at DESC NULLS LAST, source.created_at DESC NULLS LAST
         LIMIT 1) profile ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS total,
            round(COALESCE(avg(source.progreso), 0::numeric))::integer AS average_progress,
            jsonb_agg(jsonb_build_object('id', source.id, 'titulo', source.titulo, 'progreso', source.progreso, 'prioridad', source.prioridad, 'proximo_paso', source.proximo_paso, 'fecha_limite', source.fecha_limite, 'estado', source.estado) ORDER BY source.prioridad, source.fecha_limite, source.updated_at DESC) AS items
           FROM ( SELECT goal.id,
                    goal.usuario_id,
                    goal.proyecto_id,
                    goal.titulo,
                    goal.descripcion,
                    goal.progreso,
                    goal.estado,
                    goal.created_at,
                    goal.tipo_medicion,
                    goal.valor_inicial,
                    goal.valor_actual,
                    goal.valor_objetivo,
                    goal.unidad,
                    goal.prioridad,
                    goal.criterio_exito,
                    goal.proximo_paso,
                    goal.fecha_inicio,
                    goal.fecha_limite,
                    goal.request_id,
                    goal.conversacion_id,
                    goal.mensaje_id,
                    goal.progreso_confianza,
                    goal.ultima_actualizacion_at,
                    goal.completado_at,
                    goal.updated_at,
                    goal.metadata
                   FROM eos_goals goal
                  WHERE goal.usuario_id = usuario.id AND (goal.estado = ANY (ARRAY['activo'::text, 'pausado'::text]))
                  ORDER BY goal.prioridad, goal.fecha_limite, goal.updated_at DESC
                 LIMIT 6) source) goals ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS total,
            jsonb_agg(jsonb_build_object('id', source.id, 'titulo', source.titulo, 'descripcion', source.descripcion, 'prioridad', source.prioridad, 'fecha_limite', source.fecha_limite, 'estado', source.estado) ORDER BY source.prioridad, source.fecha_limite, source.created_at DESC) AS items
           FROM ( SELECT task.id,
                    task.usuario_id,
                    task.proyecto_id,
                    task.titulo,
                    task.descripcion,
                    task.estado,
                    task.prioridad,
                    task.fecha_limite,
                    task.created_at,
                    task.action_command_id
                   FROM eos_tasks task
                  WHERE task.usuario_id = usuario.id AND (COALESCE(task.estado, 'pendiente'::text) <> ALL (ARRAY['completada'::text, 'completado'::text, 'cancelada'::text]))
                  ORDER BY task.prioridad, task.fecha_limite, task.created_at DESC
                 LIMIT 8) source) tasks ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS total,
            jsonb_agg(jsonb_build_object('tipo', source.tipo, 'severidad', source.severidad, 'titulo', source.titulo, 'mensaje', source.mensaje, 'progreso', source.progreso_snapshot, 'fecha_limite', source.fecha_limite_snapshot, 'proximo_paso', source.proximo_paso_snapshot) ORDER BY source.programado_para, source.generado_at DESC) AS items
           FROM ( SELECT followup.id,
                    followup.usuario_id,
                    followup.objetivo_id,
                    followup.tipo,
                    followup.severidad,
                    followup.titulo,
                    followup.mensaje,
                    followup.progreso_snapshot,
                    followup.fecha_limite_snapshot,
                    followup.proximo_paso_snapshot,
                    followup.estado,
                    followup.dedupe_key,
                    followup.programado_para,
                    followup.generado_at,
                    followup.visto_at,
                    followup.resuelto_at,
                    followup.updated_at,
                    followup.metadata
                   FROM eos_proactive_followups followup
                  WHERE followup.usuario_id = usuario.id AND (followup.estado = ANY (ARRAY['pendiente'::text, 'visto'::text]))
                  ORDER BY followup.programado_para, followup.generado_at DESC
                 LIMIT 6) source) followups ON true
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE source.estado = ANY (ARRAY['error'::text, 'no_disponible'::text]))::integer AS issue_total,
            jsonb_agg(jsonb_build_object('accion', source.accion, 'estado', source.estado, 'resultado', source.resultado, 'error', source.error_message, 'created_at', source.created_at) ORDER BY source.created_at DESC) AS items
           FROM ( SELECT command.id,
                    command.usuario_id,
                    command.request_id,
                    command.accion,
                    command.estado,
                    command.conversacion_id,
                    command.mensaje_id,
                    command.origen,
                    command.payload,
                    command.resultado,
                    command.error_code,
                    command.error_message,
                    command.input_fingerprint,
                    command.retry_of,
                    command.attempt_count,
                    command.max_attempts,
                    command.started_at,
                    command.lease_expires_at,
                    command.completed_at,
                    command.created_at,
                    command.updated_at
                   FROM eos_action_commands command
                  WHERE command.usuario_id = usuario.id
                  ORDER BY command.created_at DESC
                 LIMIT 10) source) actions ON true
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('categoria', source.categoria, 'titulo', source.titulo, 'contenido', source.contenido, 'importancia', source.importancia, 'confianza', source.confianza, 'confirmada', source.confirmada) ORDER BY source.importancia DESC, source.ultima_observacion_at DESC) AS items
           FROM ( SELECT memory_item.id,
                    memory_item.usuario_id,
                    memory_item.categoria,
                    memory_item.titulo,
                    memory_item.contenido,
                    memory_item.importancia,
                    memory_item.origen,
                    memory_item.estado,
                    memory_item.created_at,
                    memory_item.updated_at,
                    memory_item.clave,
                    memory_item.entidad,
                    memory_item.valor,
                    memory_item.confianza,
                    memory_item.confirmada,
                    memory_item.conversacion_id,
                    memory_item.mensaje_id,
                    memory_item.metadata,
                    memory_item.ultima_observacion_at,
                    memory_item.observaciones
                   FROM eos_memory memory_item
                  WHERE memory_item.usuario_id = usuario.id AND COALESCE(memory_item.estado, 'activo'::text) = 'activo'::text
                  ORDER BY memory_item.importancia DESC, memory_item.ultima_observacion_at DESC
                 LIMIT 12) source) memory ON true
     LEFT JOIN LATERAL ( SELECT max(source.score) FILTER (WHERE source.row_number = 1) AS score,
            jsonb_agg(jsonb_build_object('area', source.area_detectada, 'prioridad', source.prioridad, 'diagnostico', source.diagnostico, 'recomendacion', source.recomendacion, 'accion_sugerida', source.accion_sugerida, 'score', source.score, 'created_at', source.created_at) ORDER BY source.created_at DESC) AS items
           FROM ( SELECT intelligence_item.id,
                    intelligence_item.usuario_id,
                    intelligence_item.tipo_usuario,
                    intelligence_item.area_detectada,
                    intelligence_item.prioridad,
                    intelligence_item.diagnostico,
                    intelligence_item.recomendacion,
                    intelligence_item.accion_sugerida,
                    intelligence_item.score,
                    intelligence_item.estado,
                    intelligence_item.created_at,
                    intelligence_item.conversacion_id,
                    row_number() OVER (ORDER BY intelligence_item.created_at DESC) AS row_number
                   FROM eos_intelligence intelligence_item
                  WHERE intelligence_item.usuario_id = usuario.id AND COALESCE(intelligence_item.estado, 'activo'::text) = 'activo'::text
                  ORDER BY intelligence_item.created_at DESC
                 LIMIT 6) source) intelligence ON true
     LEFT JOIN LATERAL ( SELECT source.score
           FROM eos_intelligence source
          WHERE source.usuario_id = usuario.id AND COALESCE(source.estado, 'activo'::text) = 'activo'::text
          ORDER BY source.created_at DESC
         LIMIT 1) latest_intelligence ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS total,
            jsonb_agg(jsonb_build_object('rol', source.rol, 'texto', "left"(source.texto, 1200), 'created_at', source.created_at) ORDER BY source.created_at DESC) AS items
           FROM ( SELECT message.id,
                    message.conversacion_id,
                    message.rol,
                    message.texto,
                    message.created_at,
                    message.usuario_id,
                    message.request_id,
                    message.origen,
                    message.metadata
                   FROM mensajes message
                  WHERE message.usuario_id = usuario.id AND message.created_at >= (now() - '7 days'::interval)
                  ORDER BY message.created_at DESC
                 LIMIT 14) source) activity ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_strip_nulls(jsonb_build_object(
        'mes', jsonb_build_object(
          'negocio', (
            select jsonb_agg(jsonb_build_object(
              'moneda', x.moneda, 'entro', x.entro, 'salio', x.salio
            ) order by x.moneda)
            from (
              select f.moneda,
                     round(coalesce(sum(f.monto) filter (where f.tipo = 'ingreso'), 0)) as entro,
                     round(coalesce(sum(f.monto) filter (where f.tipo = 'gasto'), 0)) as salio
              from public.eos_movimientos_financieros f
              where f.usuario_id = usuario.id
                and f.ambito = 'negocio'
                and f.fecha >= date_trunc('month', (now() at time zone 'America/Asuncion')::date)::date
              group by f.moneda
            ) x
          ),
          'personal', (
            select jsonb_agg(jsonb_build_object(
              'moneda', x.moneda, 'entro', x.entro, 'salio', x.salio
            ) order by x.moneda)
            from (
              select f.moneda,
                     round(coalesce(sum(f.monto) filter (where f.tipo = 'ingreso'), 0)) as entro,
                     round(coalesce(sum(f.monto) filter (where f.tipo = 'gasto'), 0)) as salio
              from public.eos_movimientos_financieros f
              where f.usuario_id = usuario.id
                and f.ambito = 'personal'
                and f.fecha >= date_trunc('month', (now() at time zone 'America/Asuncion')::date)::date
              group by f.moneda
            ) x
          )
        ),
        'tiene', (
          select jsonb_agg(jsonb_build_object(
            'moneda', x.moneda, 'total', x.total, 'al', x.al
          ) order by x.moneda)
          from (
            select c.moneda, sum(c.saldo_declarado) as total, min(c.saldo_declarado_el) as al
            from public.eos_finanzas_cuentas c
            where c.usuario_id = usuario.id
              and c.ambito = 'personal'
              and c.activa
              and c.saldo_declarado is not null
            group by c.moneda
          ) x
        ),
        'debe', (
          select jsonb_agg(jsonb_build_object(
            'acreedor', x.acreedor, 'saldo', x.saldo, 'cuota', x.cuota, 'dia', x.dia
          ) order by x.saldo desc)
          from (
            select d.acreedor, d.saldo_declarado as saldo, d.cuota_monto as cuota, d.cuota_dia as dia
            from public.eos_finanzas_deudas d
            where d.usuario_id = usuario.id
              and d.ambito = 'personal'
              and coalesce(d.estado, 'al_dia') <> 'saldada'
              and coalesce(d.saldo_declarado, 0) > 0
            order by d.saldo_declarado desc
            limit 5
          ) x
        ),
        'tarjetas', (
          select jsonb_agg(jsonb_build_object(
            'nombre', x.nombre, 'vence', x.vence, 'resumen', x.resumen
          ) order by x.vence nulls last)
          from (
            select coalesce(t.nombre, t.emisor) as nombre, t.dia_vencimiento as vence,
                   t.pago_total as resumen
            from public.eos_finanzas_tarjetas t
            where t.usuario_id = usuario.id
              and t.ambito = 'personal'
              and t.activa
            limit 5
          ) x
        ),
        'por_cobrar', (
          select coalesce(sum(v.total), 0)
          from public.eos_erp_ventas v
          where v.usuario_id = usuario.id
            and v.estado not in ('anulada', 'cobrada')
            and v.movimiento_id is null
        )
      )) AS resumen
    ) dinero ON true
  WHERE lower(COALESCE(usuario.estado_suscripcion, 'active'::text)) <> ALL (ARRAY['cancelled'::text, 'canceled'::text, 'inactive'::text, 'suspended'::text]);
