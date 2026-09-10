-- REGISTRAR_OPORTUNIDAD: "anotá que Pedro está interesado, unos 5 millones".
--
-- ============================================================
-- EL EMBUDO ESTÁ CONSTRUIDO, PROBADO, Y SE LLENA A MANO
-- ============================================================
--
-- `eos_crm_oportunidades` existe desde el 26 de agosto, con sus seis etapas y
-- su valor ponderado. El pipeline visual de `negocio/Embudo.tsx` está hecho y
-- testeado. Lo único que faltaba es la forma de meter algo adentro sin abrir
-- una pantalla.
--
-- Y es la información que más se pierde de todas: una oportunidad nace en una
-- conversación —un llamado, un mensaje, alguien que preguntó un precio— y si
-- no se anota en ese momento, no queda en ningún lado. Un embudo vacío no
-- significa que no haya negocios: significa que nadie los cargó.
--
-- ============================================================
-- CREA O AVANZA, SIN PREGUNTAR CUÁL DE LAS DOS
-- ============================================================
--
-- "Le mandé la propuesta a Pedro" no es una oportunidad nueva: es la de Pedro,
-- que pasó de contactado a propuesta. Obligar a la persona a decir si es nueva
-- o si es la que ya estaba es preguntarle algo que el sistema puede deducir.
--
-- Se busca entre las ABIERTAS de ese contacto: si el título se parece, se
-- avanza esa; si no, se crea. Con una sola abierta y sin título parecido
-- también se avanza esa, porque es el caso normal —una persona, un negocio en
-- curso— y crear una segunda dejaría el embudo contando dos veces la misma
-- plata.
--
-- ============================================================
-- GANARLA NO ES VENDER
-- ============================================================
--
-- Marcar una oportunidad como ganada no registra ninguna venta, ni descuenta
-- stock, ni suma plata al panel. Son dos hechos distintos y a veces pasan con
-- días de diferencia.
--
-- El prompt lo dice con esas palabras, porque la confusión es de una sola
-- dirección y cara: si el modelo creyera que ganar la oportunidad ya carga la
-- venta, el negocio se quedaría sin la venta.
--
-- ============================================================
-- SIN MONTO SE ANOTA IGUAL, Y SE DICE
-- ============================================================
--
-- "Pedro preguntó por el sistema" es una oportunidad real y todavía no tiene
-- número. Exigir el monto haría que el modelo lo invente, y un pipeline con
-- montos inventados es peor que un pipeline con huecos: el valor ponderado se
-- lee como una previsión.
--
-- Entra en cero, y la confirmación lo dice para que la persona lo complete
-- cuando lo sepa.

alter table public.eos_action_commands
  drop constraint if exists eos_action_commands_accion_check;

alter table public.eos_action_commands
  add constraint eos_action_commands_accion_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA',
    'REGISTRAR_OPORTUNIDAD'
  ]));

alter table public.eos_autonomy_rules_v12
  drop constraint if exists eos_autonomy_rules_action_check;

alter table public.eos_autonomy_rules_v12
  add constraint eos_autonomy_rules_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA',
    'REGISTRAR_OPORTUNIDAD'
  ]));

alter table public.eos_worker_gate_audit_v15
  drop constraint if exists eos_worker_gate_audit_action_check;

alter table public.eos_worker_gate_audit_v15
  add constraint eos_worker_gate_audit_action_check
  check (accion = any (array[
    'RESPONDER', 'GENERAR_EXCEL', 'GENERAR_PDF', 'GENERAR_WORD',
    'CREAR_TAREA', 'CREAR_OBJETIVO', 'GUARDAR_MEMORIA',
    'VER_DASHBOARD', 'VER_BRIEFING',
    'REGISTRAR_VENTA', 'AJUSTAR_STOCK', 'CREAR_CONTACTO',
    'CREAR_PRODUCTO', 'ACTUALIZAR_PRODUCTO',
    'REGISTRAR_COMPRA', 'REGISTRAR_GASTO_FIJO',
    'REGISTRAR_MOVIMIENTO_PERSONAL', 'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA', 'REGISTRAR_PAGO_DEUDA',
    'CORREGIR_MOVIMIENTO', 'DECLARAR_SALDO',
    'REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA',
    'REGISTRAR_TARJETA', 'REGISTRAR_COMPRA_TARJETA',
    'REGISTRAR_OPORTUNIDAD'
  ]));

alter table public.eos_crm_oportunidades
  add column if not exists action_command_id uuid;

create index if not exists eos_crm_oportunidades_command_idx
  on public.eos_crm_oportunidades (action_command_id)
  where action_command_id is not null;

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

    -- Por título parecido primero; si hay una sola abierta, esa.
    select o.id, o.etapa into v_id, v_etapa_antes
    from public.eos_crm_oportunidades o
    where o.usuario_id = p_usuario_id
      and o.contacto_id = v_contacto_id
      and o.etapa not in ('ganada', 'perdida')
      and (
        lower(o.titulo) like '%' || lower(v_titulo) || '%'
        or lower(v_titulo) like '%' || lower(o.titulo) || '%'
        or v_abiertas = 1
      )
    order by
      (lower(o.titulo) = lower(v_titulo)) desc,
      o.actualizado_en desc
    limit 1;
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
