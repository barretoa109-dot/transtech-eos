-- La v154 se pegaba a la oportunidad equivocada, y no se notaba.
--
-- ============================================================
-- ENCONTRADO POR SU PROPIA PRUEBA, EL MISMO DÍA
-- ============================================================
--
-- La regla decía: si el contacto tiene UNA sola oportunidad abierta y el
-- título no se parece a ninguna, avanzá esa igual — "es el caso normal, una
-- persona, un negocio en curso".
--
-- La prueba mandó "ZZ interesado en algo" para un contacto que tenía abierta
-- "ZZ mantenimiento anual". Nada en común. Y se pegó a ella.
--
-- Es el peor tipo de error de los que este proyecto persigue: se adjunta al
-- registro equivocado en silencio, y encima conserva el título viejo, así que
-- la confirmación dice el nombre de la otra y nadie puede darse cuenta de que
-- el negocio nuevo nunca entró.
--
-- ============================================================
-- LA ETAPA ES LA QUE DISTINGUE MOVER DE ANOTAR
-- ============================================================
--
-- "Le mandé la propuesta a Pedro" no nombra el negocio pero dice a dónde va:
-- es un avance, y ahí sí vale usar la única abierta que tenga.
--
-- "Pedro está interesado en el mantenimiento" no dice etapa: es un negocio
-- nuevo, y se crea.
--
-- Con dos o más abiertas y sin decir cuál, no se elige: se devuelven los
-- títulos y se pregunta. Mover de etapa el negocio equivocado no rompe nada
-- visible —los dos siguen ahí, con montos plausibles— y el embudo miente
-- sobre cuál está por cerrarse, que es justo para lo que se lo mira.

create or replace function public.eos_crm_oportunidad_por_chat_v154(
  p_usuario_id uuid,
  p_command_id uuid,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_titulo text;
  v_contacto_texto text;
  v_contacto_id uuid;
  v_monto numeric;
  v_moneda text;
  v_etapa text;
  v_cierre date;
  v_detalle text;
  v_id uuid;
  v_abiertas integer := 0;
  v_creada boolean := false;
  v_etapa_antes text;
  v_lista text;
begin
  if not public.eos_tiene_modulo(p_usuario_id, 'crm') then
    raise exception 'EOS_ACCION_SIN_MODULO_CRM';
  end if;

  v_titulo := nullif(btrim(coalesce(
    p_datos ->> 'titulo', p_datos ->> 'oportunidad', p_datos ->> 'que', ''
  )), '');

  if v_titulo is null then
    raise exception 'EOS_ACCION_OPORTUNIDAD_SIN_TITULO';
  end if;

  v_contacto_texto := nullif(btrim(coalesce(
    p_datos ->> 'contacto', p_datos ->> 'cliente', p_datos ->> 'nombre', ''
  )), '');

  /*
   * El contacto es opcional pero, si lo nombraron, TIENE que existir.
   *
   * Guardar la oportunidad sin contacto porque no se encontró a Pedro deja
   * una fila que nadie puede seguir: el embudo sirve para saber a quién
   * llamar, y una oportunidad sin dueño no se llama.
   */
  if v_contacto_texto is not null then
    v_contacto_id := public.eos_crm_resolver_contacto(p_usuario_id, v_contacto_texto);

    if v_contacto_id is null then
      raise exception 'EOS_ACCION_CONTACTO_NO_RESUELTO: %', v_contacto_texto;
    end if;
  end if;

  v_monto := public.eos_leer_monto(coalesce(
    p_datos ->> 'monto', p_datos ->> 'valor', p_datos ->> 'total', ''
  ));
  if v_monto is null or v_monto < 0 then v_monto := null; end if;

  v_moneda := upper(nullif(btrim(coalesce(p_datos ->> 'moneda', '')), ''));
  if v_moneda is null or length(v_moneda) <> 3 then v_moneda := 'PYG'; end if;

  v_etapa := lower(nullif(btrim(coalesce(p_datos ->> 'etapa', p_datos ->> 'estado', '')), ''));
  if v_etapa not in ('nueva', 'contactado', 'propuesta', 'negociacion', 'ganada', 'perdida') then
    v_etapa := null;
  end if;

  v_cierre := case
    when coalesce(p_datos ->> 'cierre_estimado', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (p_datos ->> 'cierre_estimado')::date
    when coalesce(p_datos ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (p_datos ->> 'fecha')::date
    else null
  end;

  v_detalle := nullif(btrim(coalesce(p_datos ->> 'detalle', p_datos ->> 'notas', '')), '');

  -- ---------------------------------------------------------------
  -- ¿Es nueva, o es la que ya estaba?
  -- ---------------------------------------------------------------
  if v_contacto_id is not null then
    select count(*) into v_abiertas
    from public.eos_crm_oportunidades o
    where o.usuario_id = p_usuario_id
      and o.contacto_id = v_contacto_id
      and o.etapa not in ('ganada', 'perdida');

    -- Primero, por título parecido. Es la única coincidencia que se puede
    -- afirmar: la persona nombró el negocio que quiere mover.
    select o.id, o.etapa into v_id, v_etapa_antes
    from public.eos_crm_oportunidades o
    where o.usuario_id = p_usuario_id
      and o.contacto_id = v_contacto_id
      and o.etapa not in ('ganada', 'perdida')
      and (
        lower(o.titulo) like '%' || lower(v_titulo) || '%'
        or lower(v_titulo) like '%' || lower(o.titulo) || '%'
      )
    order by
      (lower(o.titulo) = lower(v_titulo)) desc,
      o.actualizado_en desc
    limit 1;

    /*
     * Sin título parecido, la ETAPA es lo que distingue "moveme esto" de
     * "anotá esto nuevo".
     *
     * "Le mandé la propuesta a Pedro" no nombra el negocio pero sí dice a
     * dónde va: es un avance. "Pedro está interesado en el mantenimiento" no
     * dice etapa: es un negocio nuevo.
     *
     * Sin esta distinción, la v154 pegaba cualquier frase sobre la única
     * oportunidad abierta que tuviera esa persona — y encima le dejaba el
     * título viejo, así que nadie podía darse cuenta.
     */
    if v_id is null and v_etapa is not null then
      if v_abiertas = 1 then
        select o.id, o.etapa into v_id, v_etapa_antes
        from public.eos_crm_oportunidades o
        where o.usuario_id = p_usuario_id
          and o.contacto_id = v_contacto_id
          and o.etapa not in ('ganada', 'perdida')
        limit 1;

      elsif v_abiertas > 1 then
        /*
         * Con dos o más abiertas y sin decir cuál, no se elige. Mover de
         * etapa el negocio equivocado no rompe nada visible: los dos siguen
         * ahí, con montos plausibles, y el embudo miente sobre cuál está por
         * cerrarse.
         */
        select string_agg(o.titulo, '; ' order by o.actualizado_en desc)
        into v_lista
        from public.eos_crm_oportunidades o
        where o.usuario_id = p_usuario_id
          and o.contacto_id = v_contacto_id
          and o.etapa not in ('ganada', 'perdida');

        raise exception 'EOS_ACCION_OPORTUNIDAD_CUAL: %', v_lista;
      end if;
    end if;
  end if;

  if v_id is null then
    insert into public.eos_crm_oportunidades (
      usuario_id, contacto_id, titulo, detalle,
      monto, moneda, etapa, cierre_estimado, action_command_id
    ) values (
      p_usuario_id, v_contacto_id, left(v_titulo, 200), v_detalle,
      coalesce(v_monto, 0), v_moneda, coalesce(v_etapa, 'nueva'), v_cierre, p_command_id
    )
    returning id into v_id;

    v_creada := true;
  else
    /*
     * El título NO se toca al avanzar.
     *
     * Quien dice "le mandé la propuesta a Pedro" está moviendo de etapa el
     * negocio que ya tenía, no renombrándolo. Pisar el título con la frase de
     * hoy haría que la oportunidad cambie de nombre cada vez que alguien la
     * menciona, y el embudo dejaría de ser reconocible entre una semana y la
     * siguiente.
     */
    update public.eos_crm_oportunidades o
    set detalle = coalesce(v_detalle, o.detalle),
        monto = coalesce(v_monto, o.monto),
        moneda = coalesce(v_moneda, o.moneda),
        etapa = coalesce(v_etapa, o.etapa),
        cierre_estimado = coalesce(v_cierre, o.cierre_estimado),
        -- Cerrarla deja su fecha. Sin ella no se puede medir cuánto tardó un
        -- negocio en cerrarse, que es el único número que dice si el embudo
        -- está sano o solo está lleno.
        cerrada_en = case
          when coalesce(v_etapa, o.etapa) in ('ganada', 'perdida') then coalesce(o.cerrada_en, now())
          else null
        end,
        motivo_perdida = case
          when coalesce(v_etapa, o.etapa) = 'perdida'
            then coalesce(nullif(btrim(coalesce(p_datos ->> 'motivo', '')), ''), o.motivo_perdida)
          else o.motivo_perdida
        end,
        action_command_id = p_command_id,
        actualizado_en = now()
    where o.id = v_id;
  end if;

  return (
    select jsonb_build_object(
      'id', o.id,
      'titulo', o.titulo,
      'contacto', v_contacto_texto,
      'monto', o.monto,
      'moneda', o.moneda,
      'etapa', o.etapa,
      'etapa_antes', case when v_creada then null else v_etapa_antes end,
      'cierre_estimado', o.cierre_estimado,
      'creada', v_creada,
      -- Sin monto el embudo no puede prever nada, y se dice en vez de
      -- inventarle un número.
      'sin_monto', o.monto = 0
    )
    from public.eos_crm_oportunidades o where o.id = v_id
  );
end;
$function$;

revoke all on function public.eos_crm_oportunidad_por_chat_v154(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eos_crm_oportunidad_por_chat_v154(uuid, uuid, jsonb) to service_role;

comment on function public.eos_crm_oportunidad_por_chat_v154(uuid, uuid, jsonb) is
  'v154: crea o avanza una oportunidad del embudo desde el chat. Ganarla NO registra la venta. Sin monto entra en cero y lo dice, en vez de inventarle uno.';
