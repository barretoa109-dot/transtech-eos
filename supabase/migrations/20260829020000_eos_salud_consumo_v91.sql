-- Mostrar cuánto cuesta atender a la gente (v91).
--
-- La v89 empezó a medir los tokens de cada mensaje. Quedaban guardados y no se
-- veían en ningún lado, que es media solución: un dato que nadie mira no
-- cambia ninguna decisión.
--
-- Se agregan al chequeo de salud, donde ya se mira todo lo demás.
--
-- ============================================================
-- EL PROMEDIO MIENTE
-- ============================================================
--
-- Por eso además del total va `el_mas_caro`. Con veinte clientes tranquilos y
-- uno que manda fotos todo el día, el promedio se ve sano y el margen no lo
-- está. El plan de conversaciones ilimitadas no tiene techo de consumo, así que
-- el usuario más pesado es exactamente el que hay que poder ver.
--
-- Sigue sin juzgar: devuelve números. Qué cantidad es "demasiado" lo decide
-- quien mire, porque depende de la tarifa de OpenAI del momento y del precio
-- que se esté cobrando.

CREATE OR REPLACE FUNCTION public.eos_salud_operativa()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    /*
     * Lo que cuesta atender a la gente, del mes en curso.
     *
     * Los tokens se miden desde la v89. Antes de eso todo esto era cero y EOS
     * cobraba una suscripción sin saber cuánto gastaba en atenderla.
     *
     * El dato que decide es `el_mas_caro`: el promedio esconde justamente al
     * usuario que rompe la cuenta. Con veinte clientes tranquilos y uno que
     * manda fotos todo el día, el promedio se ve sano y el margen no lo está.
     */
    'consumo', jsonb_build_object(
      'periodo', public.eos_periodo_actual(),
      'usuarios', (
        select count(*) from public.uso_mensual u
        where u.periodo = public.eos_periodo_actual() and u.mensajes_usados > 0
      ),
      'mensajes', (
        select coalesce(sum(u.mensajes_usados), 0) from public.uso_mensual u
        where u.periodo = public.eos_periodo_actual()
      ),
      'tokens_entrada', (
        select coalesce(sum(u.tokens_entrada), 0) from public.uso_mensual u
        where u.periodo = public.eos_periodo_actual()
      ),
      'tokens_salida', (
        select coalesce(sum(u.tokens_salida), 0) from public.uso_mensual u
        where u.periodo = public.eos_periodo_actual()
      ),
      'costo_usd', (
        select round(coalesce(sum(u.costo_estimado_usd), 0)::numeric, 4)
        from public.uso_mensual u
        where u.periodo = public.eos_periodo_actual()
      ),
      'el_mas_caro', (
        select jsonb_build_object(
          'tokens', u.tokens_entrada + u.tokens_salida,
          'mensajes', u.mensajes_usados,
          'costo_usd', round(u.costo_estimado_usd::numeric, 4),
          'plan', coalesce(p.plan, 'free')
        )
        from public.uso_mensual u
        left join public.usuarios p on p.id = u.usuario_id
        where u.periodo = public.eos_periodo_actual()
        order by (u.tokens_entrada + u.tokens_salida) desc
        limit 1
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
$function$
;

revoke all on function public.eos_salud_operativa() from public, anon, authenticated;
