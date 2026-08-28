-- Cómo viene funcionando EOS, no cómo está configurado (v88).
--
-- ============================================================
-- LO QUE FALTABA MIRAR
-- ============================================================
--
-- El chequeo de salud que ya existe mira configuración: que estén las variables,
-- que Bancard apunte donde debe, que las páginas legales respondan. Todo eso
-- puede estar perfecto mientras un webhook de pago lleva seis horas sin
-- procesarse y nadie se entera.
--
-- Esta función mira lo otro: qué pasó de verdad en las últimas horas.
--
--   · Pagos que Bancard confirmó y nosotros no procesamos. Es el peor de todos:
--     la persona pagó y no tiene lo que compró.
--   · Acciones que el asistente dejó a medias, o que quedaron tomadas por un
--     worker que nunca volvió.
--   · Briefings del día que fallaron.
--
-- ============================================================
-- CONTAR, NO JUZGAR
-- ============================================================
--
-- Devuelve números y nada más. Qué cantidad es "roto" lo decide
-- `lib/monitoreo/salud.ts`, porque ahí es donde se puede explicar el umbral en
-- castellano y cambiarlo sin una migración.
--
-- Y no toca nada: sólo lee. Un chequeo de salud que escribe puede convertir un
-- problema chico en uno grande justo cuando alguien lo está mirando.

create or replace function public.eos_salud_operativa()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  return jsonb_build_object(
    'momento', now(),

    'pagos', jsonb_build_object(
      /*
       * Avisos de Bancard sin procesar.
       *
       * Se da un margen de quince minutos: la confirmación se procesa en
       * segundo plano y a veces reintenta. Más que eso ya no es lentitud.
       */
      'avisos_sin_procesar', (
        select count(*)
        from public.eventos_pago e
        where not e.procesado
          and e.created_at < now() - interval '15 minutes'
      ),
      'avisos_con_error', (
        select count(*)
        from public.eventos_pago e
        where e.error is not null
          and e.created_at > now() - interval '24 hours'
      ),
      'pagados_hoy', (
        select count(*)
        from public.solicitudes_pago s
        where s.estado = 'pagado'
          and s.created_at > now() - interval '24 hours'
      ),
      'rechazados_hoy', (
        select count(*)
        from public.solicitudes_pago s
        where s.estado = 'rechazado'
          and s.created_at > now() - interval '24 hours'
      )
    ),

    'acciones', jsonb_build_object(
      'con_error_24h', (
        select count(*)
        from public.eos_action_commands c
        where c.estado = 'error'
          and c.updated_at > now() - interval '24 hours'
      ),
      /*
       * Tomadas por un worker que nunca volvió.
       *
       * El lease existe para que otro worker pueda retomarlas; si venció y
       * siguen en 'ejecutando', nadie las retomó y quedaron colgadas.
       */
      'trabadas', (
        select count(*)
        from public.eos_action_commands c
        where c.estado = 'ejecutando'
          and c.lease_expires_at is not null
          and c.lease_expires_at < now() - interval '10 minutes'
      ),
      'completadas_24h', (
        select count(*)
        from public.eos_action_commands c
        where c.estado = 'completada'
          and c.updated_at > now() - interval '24 hours'
      )
    ),

    'briefing', jsonb_build_object(
      'con_error_hoy', (
        select count(*)
        from public.eos_daily_briefing_runs r
        where r.briefing_date = v_hoy
          and r.estado = 'error'
      ),
      'enviados_hoy', (
        select count(*)
        from public.eos_daily_briefing_runs r
        where r.briefing_date = v_hoy
          and r.estado = 'completado'
      )
    ),

    'documentos', jsonb_build_object(
      'generados_24h', (
        select count(*)
        from public.documentos_generados d
        where d.created_at > now() - interval '24 hours'
      )
    ),

    'uso', jsonb_build_object(
      'usuarios_activos_24h', (
        select count(distinct c.usuario_id)
        from public.eos_action_commands c
        where c.created_at > now() - interval '24 hours'
      )
    )
  );
end;
$function$;

revoke all on function public.eos_salud_operativa() from public, anon, authenticated;
