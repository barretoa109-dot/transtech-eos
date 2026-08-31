-- Que el usuario pueda corregir lo que EOS creyó aprender de él (v96).
--
-- ============================================================
-- HOY SON SOLO LECTURA
-- ============================================================
--
-- `eos_learnings` guarda lo que EOS dedujo mirando cómo le fue al usuario con
-- sus decisiones. La RLS le da `select` y nada más: puede VER lo que EOS cree
-- de él, y no puede hacer absolutamente nada al respecto.
--
-- Eso está mal por dos motivos distintos, y el segundo importa más que el
-- primero.
--
-- El primero es obvio: EOS se equivoca. Deduce "le va mal cuando decide de
-- apuro" de tres casos que no tenían nada que ver, y después usa esa
-- conclusión en cada respuesta. El usuario la lee, sabe que es falsa, y no
-- tiene un botón.
--
-- El segundo es peor: un sistema que saca conclusiones sobre una persona y no
-- le deja discutirlas no es un asistente, es un expediente. Y la persona que
-- descubre que no puede corregir su expediente deja de contarle cosas — que es
-- justo lo que hace que EOS sirva.
--
-- ============================================================
-- CUATRO COSAS, NO UNA
-- ============================================================
--
--   CORREGIR   "Está cerca pero no es así": el usuario reescribe la
--              recomendación con sus palabras. La original se guarda al lado,
--              porque borrar de dónde salió una conclusión rompe el rastro de
--              evidencia que la sostiene.
--
--   DESCARTAR  "Esto ya no me representa": deja de llegarle a EOS —la vista
--              `eos_learning_context_v7` filtra por `estado = 'activo'`— pero
--              la fila queda. Es reversible, y es lo que hay que ofrecer
--              primero: casi nadie quiere borrar, quiere que deje de aplicarse.
--
--   RESTAURAR  Porque descartar sin poder deshacer es una trampa.
--
--   ELIMINAR   Borrado de verdad. Existe porque es SU dato y tiene derecho a
--              que no exista, aunque no sea lo que le conviene.
--
-- La evidencia (`eos_learning_evidence`) no se toca en ninguna de las cuatro:
-- son los resultados de sus propias decisiones, hechos que pasaron. Lo que se
-- edita acá es la CONCLUSIÓN que EOS sacó de ellos, que es otra cosa.

alter table public.eos_learnings
  add column if not exists recomendacion_original text,
  add column if not exists corregido_en timestamptz,
  add column if not exists descartado_en timestamptz,
  add column if not exists descartado_motivo text;

comment on column public.eos_learnings.recomendacion_original is
  'La redacción de EOS antes de que el usuario la corrigiera. Se conserva para no perder el rastro entre la evidencia y la conclusión.';

-- ============================================================
-- Una sola función, con la acción declarada
-- ============================================================
--
-- Cuatro funciones separadas serían más del estilo del resto del proyecto,
-- pero acá las cuatro comparten la misma verificación de dueño, el mismo lock
-- y el mismo formato de respuesta. Partirlas repetiría eso cuatro veces, y una
-- verificación de dueño repetida cuatro veces es una que algún día va a estar
-- escrita distinto en una de ellas.

create or replace function public.eos_gestionar_aprendizaje_v96(
  p_usuario_id uuid,
  p_learning_id uuid,
  p_accion text,
  p_texto text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_learning public.eos_learnings%rowtype;
  v_accion text := lower(btrim(coalesce(p_accion, '')));
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if p_usuario_id is null then
    raise exception 'EOS_ACTOR_REQUERIDO';
  end if;

  if v_accion not in ('corregir', 'descartar', 'restaurar', 'eliminar') then
    raise exception 'EOS_APRENDIZAJE_ACCION_INVALIDA';
  end if;

  -- El filtro por usuario va acá y no en la ruta: esta función es
  -- `security definer`, así que la RLS no la cubre. Un id adivinado de otra
  -- persona tiene que no encontrar nada, no encontrar su aprendizaje.
  select * into v_learning
  from public.eos_learnings
  where id = p_learning_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_APRENDIZAJE_NO_EXISTE';
  end if;

  if v_accion = 'eliminar' then
    delete from public.eos_learnings where id = v_learning.id;

    return jsonb_build_object('ok', true, 'accion', 'eliminar', 'id', v_learning.id);
  end if;

  if v_accion = 'corregir' then
    if v_texto is null then
      raise exception 'EOS_APRENDIZAJE_TEXTO_REQUERIDO';
    end if;

    update public.eos_learnings
    set recomendacion_original = coalesce(recomendacion_original, recomendacion),
        recomendacion = left(v_texto, 1000),
        corregido_en = now(),
        updated_at = now()
    where id = v_learning.id
    returning * into v_learning;

  elsif v_accion = 'descartar' then
    update public.eos_learnings
    set estado = 'descartado',
        descartado_en = now(),
        descartado_motivo = left(coalesce(v_texto, ''), 500),
        updated_at = now()
    where id = v_learning.id
    returning * into v_learning;

  else -- restaurar
    update public.eos_learnings
    set estado = 'activo',
        descartado_en = null,
        descartado_motivo = null,
        updated_at = now()
    where id = v_learning.id
    returning * into v_learning;
  end if;

  return jsonb_build_object(
    'ok', true,
    'accion', v_accion,
    'id', v_learning.id,
    'estado', v_learning.estado,
    'recomendacion', v_learning.recomendacion,
    'recomendacion_original', v_learning.recomendacion_original,
    'corregido', v_learning.corregido_en is not null
  );
end;
$$;

revoke all on function public.eos_gestionar_aprendizaje_v96(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_gestionar_aprendizaje_v96(uuid, uuid, text, text)
  to service_role;

comment on function public.eos_gestionar_aprendizaje_v96(uuid, uuid, text, text) is
  'v96: el usuario corrige, descarta, restaura o elimina un aprendizaje suyo. Filtra por dueño adentro porque es security definer.';

-- ============================================================
-- Rehacer el onboarding (punto 13)
-- ============================================================
--
-- `eos_onboarding.completado_en` se pone una vez y no se limpia nunca. La ruta
-- PATCH deja cambiar las respuestas, pero `completado` queda en true para
-- siempre, así que la conversación de arranque no vuelve a aparecer.
--
-- Eso deja a alguien que se equivocó al principio —o que cambió de situación,
-- que es lo normal con el tiempo— con una configuración que ya no lo
-- representa y sin forma de rehacerla.
--
-- Limpiar `completado_en` es todo lo que hace falta: las respuestas viejas
-- quedan como estaban hasta que las pise, así que reiniciar no le borra nada
-- de entrada. Si abandona a la mitad, sigue teniendo lo de antes.

create or replace function public.eos_reiniciar_onboarding_v96(p_usuario_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_fila public.eos_onboarding%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if p_usuario_id is null then
    raise exception 'EOS_ACTOR_REQUERIDO';
  end if;

  update public.eos_onboarding
  set paso = 'bienvenida',
      completado_en = null,
      updated_at = now()
  where usuario_id = p_usuario_id
  returning * into v_fila;

  if not found then
    -- Nunca lo empezó: no hay nada que reiniciar y tampoco es un error.
    return jsonb_build_object('ok', true, 'ya_estaba', true, 'paso', 'bienvenida');
  end if;

  return jsonb_build_object(
    'ok', true,
    'ya_estaba', false,
    'paso', v_fila.paso,
    'preocupacion_principal', v_fila.preocupacion_principal,
    'evita_mirar', v_fila.evita_mirar
  );
end;
$$;

revoke all on function public.eos_reiniciar_onboarding_v96(uuid)
  from public, anon, authenticated;
grant execute on function public.eos_reiniciar_onboarding_v96(uuid) to service_role;

comment on function public.eos_reiniciar_onboarding_v96(uuid) is
  'v96: vuelve el onboarding al principio sin borrar las respuestas anteriores, para que abandonarlo a la mitad no deje al usuario peor que antes.';
