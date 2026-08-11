-- Generación de respaldo: garantiza un briefing diario aun cuando el Worker
-- de enriquecimiento esté temporalmente fuera de servicio.

create extension if not exists pg_cron;

create or replace function public.eos_generate_daily_briefings_fallback(
  p_briefing_date date default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_date date := coalesce(
    p_briefing_date,
    (now() at time zone 'America/Asuncion')::date
  );
  generated_count integer := 0;
begin
  with contexts as (
    select context.*
    from public.eos_daily_briefing_context_v5 as context
  ),
  upserted as (
    insert into public.eos_daily_briefings (
      usuario_id,
      briefing_date,
      estado,
      tipo_usuario,
      saludo,
      titulo_dia,
      resumen,
      enfoque_dia,
      prioridad_1,
      prioridad_2,
      prioridad_3,
      recomendacion_principal,
      logros,
      riesgos,
      proximos_pasos,
      fuentes,
      score,
      modelo_version,
      generated_at,
      created_at,
      updated_at
    )
    select
      context.usuario_id,
      target_date,
      'listo',
      context.tipo_usuario,
      'Buen día, ' || context.nombre || '.',
      coalesce(
        nullif(context.objetivos -> 0 ->> 'titulo', ''),
        nullif(context.tareas -> 0 ->> 'titulo', ''),
        'Tu foco para hoy'
      ),
      case
        when (context.metricas ->> 'objetivos_activos')::integer > 0 then
          format(
            'Tenés %s objetivo(s) activo(s), con un progreso promedio de %s%%. EOS priorizó las acciones con mayor impacto para mantener el avance.',
            context.metricas ->> 'objetivos_activos',
            context.metricas ->> 'progreso_promedio'
          )
        when (context.metricas ->> 'tareas_pendientes')::integer > 0 then
          format(
            'Tenés %s tarea(s) pendiente(s). El briefing ordena el trabajo para que hoy puedas cerrar primero lo más importante.',
            context.metricas ->> 'tareas_pendientes'
          )
        else
          'EOS no encontró compromisos urgentes. Es un buen momento para definir un resultado concreto y convertirlo en un objetivo medible.'
      end,
      coalesce(
        nullif(context.objetivos -> 0 ->> 'proximo_paso', ''),
        nullif(context.tareas -> 0 ->> 'titulo', ''),
        nullif(context.prioridad_actual, ''),
        'Definir el resultado más importante del día.'
      ),
      coalesce(
        nullif(context.objetivos -> 0 ->> 'proximo_paso', ''),
        nullif(context.objetivos -> 0 ->> 'titulo', ''),
        nullif(context.tareas -> 0 ->> 'titulo', ''),
        'Definir el resultado principal del día.'
      ),
      coalesce(
        nullif(context.tareas -> 0 ->> 'titulo', ''),
        nullif(context.objetivos -> 1 ->> 'proximo_paso', ''),
        nullif(context.objetivos -> 1 ->> 'titulo', ''),
        'Ordenar la información necesaria para ejecutar.'
      ),
      coalesce(
        nullif(context.seguimientos -> 0 ->> 'proximo_paso', ''),
        nullif(context.objetivos -> 2 ->> 'proximo_paso', ''),
        nullif(context.tareas -> 1 ->> 'titulo', ''),
        'Cerrar el día registrando el avance real.'
      ),
      coalesce(
        nullif(context.seguimientos -> 0 ->> 'mensaje', ''),
        nullif(context.diagnosticos_recientes -> 0 ->> 'recomendacion', ''),
        nullif(context.objetivos -> 0 ->> 'proximo_paso', ''),
        'Elegí una sola prioridad, definí el resultado esperado y pedile a EOS que ejecute o estructure el primer paso.'
      ),
      case
        when (context.metricas ->> 'progreso_promedio')::integer > 0 then
          jsonb_build_array(
            jsonb_build_object(
              'titulo', format(
                'Progreso promedio de %s%% en objetivos activos',
                context.metricas ->> 'progreso_promedio'
              ),
              'descripcion', 'EOS conservará este avance como referencia para el próximo briefing.'
            )
          )
        else '[]'::jsonb
      end,
      (
        case
          when (context.metricas ->> 'acciones_con_error')::integer > 0 then
            jsonb_build_array(
              jsonb_build_object(
                'titulo', 'Hay acciones que requieren revisión',
                'descripcion', format(
                  '%s ejecución(es) reciente(s) terminaron con error o no estaban disponibles.',
                  context.metricas ->> 'acciones_con_error'
                ),
                'nivel', 'alto'
              )
            )
          else '[]'::jsonb
        end
        ||
        case
          when (context.metricas ->> 'seguimientos_pendientes')::integer > 0 then
            jsonb_build_array(
              jsonb_build_object(
                'titulo', 'Seguimientos pendientes',
                'descripcion', format(
                  'EOS detectó %s seguimiento(s) que todavía requieren atención.',
                  context.metricas ->> 'seguimientos_pendientes'
                ),
                'nivel', 'medio'
              )
            )
          else '[]'::jsonb
        end
      ),
      jsonb_build_array(
        jsonb_build_object(
          'titulo', coalesce(
            nullif(context.objetivos -> 0 ->> 'proximo_paso', ''),
            nullif(context.objetivos -> 0 ->> 'titulo', ''),
            'Definir la prioridad principal'
          ),
          'descripcion', 'Empezá por el resultado de mayor impacto.'
        ),
        jsonb_build_object(
          'titulo', coalesce(
            nullif(context.tareas -> 0 ->> 'titulo', ''),
            'Convertir la prioridad en una acción concreta'
          ),
          'descripcion', 'Pedile a EOS que estructure o ejecute este paso.'
        ),
        jsonb_build_object(
          'titulo', 'Registrar el avance al terminar',
          'descripcion', 'Ese resultado alimentará automáticamente el briefing siguiente.'
        )
      ),
      context.metricas,
      greatest(0, least(100, coalesce(context.score_actual, 0))),
      'fallback-v5',
      now(),
      now(),
      now()
    from contexts as context
    on conflict (usuario_id, briefing_date)
      where briefing_date is not null
    do update set
      estado = excluded.estado,
      tipo_usuario = excluded.tipo_usuario,
      saludo = excluded.saludo,
      titulo_dia = excluded.titulo_dia,
      resumen = excluded.resumen,
      enfoque_dia = excluded.enfoque_dia,
      prioridad_1 = excluded.prioridad_1,
      prioridad_2 = excluded.prioridad_2,
      prioridad_3 = excluded.prioridad_3,
      recomendacion_principal = excluded.recomendacion_principal,
      logros = excluded.logros,
      riesgos = excluded.riesgos,
      proximos_pasos = excluded.proximos_pasos,
      fuentes = excluded.fuentes,
      score = excluded.score,
      modelo_version = excluded.modelo_version,
      generated_at = excluded.generated_at,
      updated_at = now()
    where public.eos_daily_briefings.modelo_version = 'fallback-v5'
       or public.eos_daily_briefings.estado = 'error'
    returning usuario_id
  ),
  run_upserts as (
    insert into public.eos_daily_briefing_runs (
      usuario_id,
      briefing_date,
      estado,
      started_at,
      completed_at,
      metadata
    )
    select
      context.usuario_id,
      target_date,
      'completado',
      now(),
      now(),
      jsonb_build_object(
        'generator', 'fallback-v5',
        'automatic', true
      )
    from contexts as context
    on conflict (usuario_id, briefing_date)
    do update set
      estado = 'completado',
      error_code = null,
      error_message = null,
      completed_at = now(),
      metadata = public.eos_daily_briefing_runs.metadata
        || excluded.metadata,
      updated_at = now()
    returning 1
  )
  select count(*) into generated_count from upserted;

  return generated_count;
end;
$$;

revoke all on function public.eos_generate_daily_briefings_fallback(date)
  from public, anon, authenticated;
grant execute on function public.eos_generate_daily_briefings_fallback(date)
  to service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'eos-daily-briefing-fallback-v5'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'eos-daily-briefing-fallback-v5',
    '0 23 * * *',
    $job$
      select public.eos_generate_daily_briefings_fallback(
        (now() at time zone 'America/Asuncion')::date + 1
      );
    $job$
  );
end;
$$;

-- Activa el briefing de hoy sin esperar a la primera ejecución nocturna.
select public.eos_generate_daily_briefings_fallback(
  (now() at time zone 'America/Asuncion')::date
);

comment on function public.eos_generate_daily_briefings_fallback(date) is
  'Genera un briefing diario determinista y seguro antes del enriquecimiento del Worker.';
