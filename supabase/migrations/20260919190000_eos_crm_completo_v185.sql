-- v185: el CRM completo (ficha del cliente, oportunidades, seguimientos) y el token
-- de WhatsApp guardado en Vault.
--
-- ============================================================
-- QUÉ FALTABA
-- ============================================================
--
-- 1. Conectar un WhatsApp de empresa. La v177 dejó el canal, pero el token de Meta
--    tiene que vivir en Vault y no había cómo guardarlo ni leerlo: dos funciones
--    que solo ejecuta `service_role`. La tabla de canales sigue sin token.
--
-- 2. La ficha del cliente. `eos_crm_contactos` tenía nombre, RUC, teléfono y
--    notas. Faltaban lo que un CRM pregunta primero: en qué estado está la
--    relación, cuándo hay que volver a hablarle y quién de la empresa se ocupa.
--
-- 3. Las oportunidades. Tenían monto, etapa y fecha de cierre. Faltaban la
--    probabilidad (para saber cuánto vale REALMENTE el embudo), qué se le está
--    vendiendo y cuándo es el próximo paso.
--
-- 4. Etapas configurables. Las seis etapas son un contrato: los indicadores, el
--    trigger que gana una oportunidad al registrar una venta y el aviso de
--    estancadas dependen de sus códigos. Por eso NO se agregan etapas nuevas;
--    lo que cada empresa configura es cómo se LLAMAN, en qué orden se muestran
--    y qué probabilidad lleva cada una por defecto. Es lo que se puede cambiar
--    sin romper nada de lo que ya funciona.
--
-- 5. Seguimientos. Los avisos de "este cliente hay que retomarlo" se recalculan
--    todos los días: sin memoria, uno que la persona ya resolvió (o pospuso)
--    volvería a aparecer para siempre. Esta tabla recuerda qué pasó con cada uno.

-- ============================================================
-- 1) La ficha del cliente
-- ============================================================

alter table public.eos_crm_contactos
  add column if not exists empresa text check (empresa is null or length(btrim(empresa)) between 1 and 160),
  add column if not exists estado_relacion text not null default 'activo'
    check (estado_relacion in ('prospecto', 'activo', 'inactivo')),
  add column if not exists proxima_interaccion_en date,
  add column if not exists responsable_id uuid references auth.users(id) on delete set null;

comment on column public.eos_crm_contactos.estado_relacion is
  'v185: prospecto = todavía no compró ni negoció; activo = relación en marcha; inactivo = dejó de comprar o de contestar. Es distinto de `activo` (boolean), que solo dice si la ficha está archivada.';
comment on column public.eos_crm_contactos.proxima_interaccion_en is
  'v185: cuándo hay que volver a hablarle. Alimenta los seguimientos del CRM.';
comment on column public.eos_crm_contactos.responsable_id is
  'v185: quién de la empresa se ocupa de este cliente. Puede ser cualquier miembro.';

create index if not exists eos_crm_contactos_proxima_idx
  on public.eos_crm_contactos (usuario_id, proxima_interaccion_en)
  where proxima_interaccion_en is not null;

-- ============================================================
-- 2) Las oportunidades
-- ============================================================

alter table public.eos_crm_oportunidades
  add column if not exists probabilidad smallint check (probabilidad is null or probabilidad between 0 and 100),
  add column if not exists producto_servicio text check (producto_servicio is null or length(btrim(producto_servicio)) between 1 and 200),
  add column if not exists proxima_accion_en date;

comment on column public.eos_crm_oportunidades.probabilidad is
  'v185: 0 a 100. Nula = sin estimar: NO se cuenta como 0, se cuenta con la de la etapa (eos_crm_etapas_config) o queda afuera del pronóstico.';
comment on column public.eos_crm_oportunidades.proxima_accion_en is
  'v185: cuándo es el próximo paso con esta oportunidad (una llamada, mandar la propuesta).';

create index if not exists eos_crm_oportunidades_proxima_idx
  on public.eos_crm_oportunidades (usuario_id, proxima_accion_en)
  where proxima_accion_en is not null;

-- ============================================================
-- 3) Etapas configurables: nombre, orden, visibilidad y probabilidad por defecto
-- ============================================================

create table if not exists public.eos_crm_etapas_config (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid references public.eos_empresas(id) on delete set null,

  -- El código NO se configura: es el contrato con los indicadores y los triggers.
  etapa text not null check (etapa in ('nueva', 'contactado', 'propuesta', 'negociacion', 'ganada', 'perdida')),
  etiqueta text not null check (length(btrim(etiqueta)) between 1 and 40),
  orden smallint not null default 0,
  visible boolean not null default true,
  probabilidad_defecto smallint check (probabilidad_defecto is null or probabilidad_defecto between 0 and 100),

  actualizado_en timestamptz not null default now(),

  constraint eos_crm_etapas_config_uniq unique (usuario_id, etapa)
);

comment on table public.eos_crm_etapas_config is
  'v185: cómo se llama, en qué orden se muestra y qué probabilidad lleva cada etapa del embudo. Los códigos de etapa son fijos a propósito.';

-- ============================================================
-- 4) Seguimientos: qué pasó con cada aviso
-- ============================================================

create table if not exists public.eos_crm_seguimientos_estado (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid references public.eos_empresas(id) on delete set null,

  -- La misma clave estable que arma `lib/crm/seguimientos.ts` (ej. "sin-respuesta:<contacto>").
  clave text not null check (length(clave) between 1 and 200),
  estado text not null check (estado in ('hecho', 'pospuesto', 'descartado')),
  -- Un pospuesto vuelve a aparecer a partir de esta fecha.
  hasta date,

  actualizado_en timestamptz not null default now(),

  constraint eos_crm_seguimientos_estado_uniq unique (usuario_id, clave)
);

comment on table public.eos_crm_seguimientos_estado is
  'v185: memoria de los avisos de seguimiento del CRM, para que uno ya resuelto o pospuesto no reaparezca.';

-- ============================================================
-- 5) `empresa_id` heredado y RLS de las dos tablas nuevas (mismo patrón que el ERP/CRM)
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array['eos_crm_etapas_config', 'eos_crm_seguimientos_estado'] loop
    execute format('drop trigger if exists eos_empresa_heredar on public.%I', t);
    execute format(
      'create trigger eos_empresa_heredar before insert on public.%I
         for each row execute function public.eos_empresa_heredar_v110()', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_propio', t);
    execute format(
      'create policy %I on public.%I
         for all to authenticated
         using ((select auth.uid()) = usuario_id or empresa_id = (select public.eos_mi_empresa_v109()))
         with check ((select auth.uid()) = usuario_id or empresa_id = (select public.eos_mi_empresa_v109()))',
      t || '_propio', t);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ============================================================
-- 6) Los secretos de WhatsApp en Vault: el token de acceso y el secreto de la app
-- ============================================================
--
-- La tabla de canales guarda solo referencias (`secreto_ref`, `secreto_app_ref`),
-- nunca el valor. Un secreto no pasa por ninguna consulta de la aplicación salvo
-- cuando hay que ENVIAR o validar la firma de un webhook, y ahí lo lee la clave
-- de servicio dentro del servidor: no llega al navegador ni a los logs.
--
-- Son DOS secretos distintos, y los dos hacen falta según cómo conecte la empresa:
--
--   token  ('token')  con qué se le escribe a Meta para ENVIAR por ese número.
--   app    ('app')    con qué Meta firma los mensajes que ENTRAN. Si la empresa usa
--                     su propia app de Meta, la firma sale con el secreto de ESA
--                     app y el secreto global de TransTech no la valida.
--
-- Además cada canal tiene su `verify_token`: es el que Meta manda al configurar el
-- webhook para comprobar que la URL es de quien dice. No es un secreto fuerte (vale
-- un solo apretón de manos), por eso vive en la tabla y no en Vault.
--
-- Solo `service_role` ejecuta estas funciones.

alter table public.eos_wa_canales
  add column if not exists ultimo_error text,
  add column if not exists verificado_en timestamptz,
  add column if not exists secreto_app_ref uuid,
  add column if not exists verify_token text;

create unique index if not exists eos_wa_canales_verify_token_uniq
  on public.eos_wa_canales (verify_token) where verify_token is not null;

create or replace function public.eos_wa_guardar_secreto_v185(p_canal_id uuid, p_valor text, p_tipo text default 'token')
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ref uuid;
  v_id uuid;
begin
  if p_tipo not in ('token', 'app') then
    raise exception 'EOS_WA_SECRETO_TIPO_INVALIDO';
  end if;

  if p_valor is null or length(btrim(p_valor)) < 16 then
    raise exception 'EOS_WA_SECRETO_INVALIDO';
  end if;

  select case when p_tipo = 'token' then c.secreto_ref else c.secreto_app_ref end into v_ref
  from public.eos_wa_canales c where c.id = p_canal_id;

  if not found then
    raise exception 'EOS_WA_CANAL_NO_ENCONTRADO';
  end if;

  if v_ref is not null then
    perform vault.update_secret(v_ref, btrim(p_valor));
    return v_ref;
  end if;

  v_id := vault.create_secret(
    btrim(p_valor),
    'eos_wa_' || p_tipo || '_' || p_canal_id::text,
    'Secreto de WhatsApp Business (' || p_tipo || ') de un canal de empresa (v185)'
  );

  if p_tipo = 'token' then
    update public.eos_wa_canales set secreto_ref = v_id where id = p_canal_id;
  else
    update public.eos_wa_canales set secreto_app_ref = v_id where id = p_canal_id;
  end if;

  return v_id;
end;
$function$;

create or replace function public.eos_wa_leer_secreto_v185(p_canal_id uuid, p_tipo text default 'token')
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_valor text;
begin
  select s.decrypted_secret into v_valor
  from public.eos_wa_canales c
  join vault.decrypted_secrets s
    on s.id = case when p_tipo = 'app' then c.secreto_app_ref else c.secreto_ref end
  where c.id = p_canal_id;

  return v_valor;
end;
$function$;

-- Borra los DOS: desconectar un canal no deja ningún secreto suyo en Vault.
create or replace function public.eos_wa_borrar_secreto_v185(p_canal_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token uuid;
  v_app uuid;
begin
  select c.secreto_ref, c.secreto_app_ref into v_token, v_app
  from public.eos_wa_canales c where c.id = p_canal_id;

  if v_token is null and v_app is null then
    return false;
  end if;

  update public.eos_wa_canales set secreto_ref = null, secreto_app_ref = null where id = p_canal_id;
  delete from vault.secrets where id in (v_token, v_app);
  return true;
end;
$function$;

-- Para validar la firma de un webhook SIN saber todavía de qué canal es: se
-- resuelve por `phone_number_id` (que viaja en el cuerpo) y se devuelve solo el
-- secreto de la app de ESE canal. La firma se verifica DESPUÉS con él: leer un
-- secreto por una clave del cuerpo sin autenticar no expone nada, porque el
-- secreto nunca sale de esta función hacia el que mandó el POST.
create or replace function public.eos_wa_secreto_app_de_numero_v185(p_phone_number_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select s.decrypted_secret
  from public.eos_wa_canales c
  join vault.decrypted_secrets s on s.id = c.secreto_app_ref
  where c.phone_number_id = p_phone_number_id;
$function$;

revoke all on function public.eos_wa_guardar_secreto_v185(uuid, text, text) from public, anon, authenticated;
grant execute on function public.eos_wa_guardar_secreto_v185(uuid, text, text) to service_role;
revoke all on function public.eos_wa_leer_secreto_v185(uuid, text) from public, anon, authenticated;
grant execute on function public.eos_wa_leer_secreto_v185(uuid, text) to service_role;
revoke all on function public.eos_wa_borrar_secreto_v185(uuid) from public, anon, authenticated;
grant execute on function public.eos_wa_borrar_secreto_v185(uuid) to service_role;
revoke all on function public.eos_wa_secreto_app_de_numero_v185(text) from public, anon, authenticated;
grant execute on function public.eos_wa_secreto_app_de_numero_v185(text) to service_role;

-- ============================================================
-- 7) Quien escribe por primera vez por WhatsApp entra como prospecto
-- ============================================================
--
-- Mismo cuerpo que la v177 (sale de `pg_get_functiondef` de producción); solo
-- cambia el estado con el que se crea la ficha. Misma firma: los permisos siguen.

CREATE OR REPLACE FUNCTION public.eos_wa_recibir_v177(p_canal_id uuid, p_wa_message_id text, p_telefono text, p_texto text, p_tipo text, p_nombre_perfil text, p_ocurrio_en timestamp with time zone, p_intencion text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_canal public.eos_wa_canales%rowtype;
  v_ultimos text := right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 9);
  v_contacto_id uuid;
  v_nuevo boolean := false;
  v_mensaje_id uuid;
  v_previo public.eos_wa_consentimientos%rowtype;
  v_op_id uuid;
  v_op_etapa text;
  v_opt_out boolean := false;
  v_ocurrio timestamptz := coalesce(p_ocurrio_en, now());
  v_tipo text := case when p_tipo in ('texto', 'imagen', 'documento', 'audio') then p_tipo else 'otro' end;
begin
  select * into v_canal from public.eos_wa_canales where id = p_canal_id;
  if not found then
    raise exception 'EOS_WA_CANAL_NO_ENCONTRADO';
  end if;

  if length(v_ultimos) < 8 then
    raise exception 'EOS_WA_TELEFONO_INVALIDO';
  end if;

  -- Meta reintenta el mismo webhook: el segundo intento no hace nada.
  select m.id, m.contacto_id into v_mensaje_id, v_contacto_id
  from public.eos_wa_mensajes m
  where m.canal_id = p_canal_id and m.wa_message_id = p_wa_message_id;

  if found then
    return jsonb_build_object('duplicado', true, 'mensaje_id', v_mensaje_id, 'contacto_id', v_contacto_id);
  end if;

  -- El cliente: dentro de la empresa dueña del canal, nunca fuera.
  select c.id into v_contacto_id
  from public.eos_crm_contactos c
  where c.activo
    and (c.usuario_id = v_canal.usuario_id
         or (v_canal.empresa_id is not null and c.empresa_id = v_canal.empresa_id))
    and right(regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g'), 9) = v_ultimos
  order by c.creado_en
  limit 1;

  if v_contacto_id is null then
    insert into public.eos_crm_contactos (usuario_id, nombre, telefono, es_cliente, origen, etiquetas, estado_relacion)
    values (
      v_canal.usuario_id,
      left(coalesce(nullif(btrim(p_nombre_perfil), ''), '+' || regexp_replace(p_telefono, '\D', '', 'g')), 160),
      regexp_replace(p_telefono, '\D', '', 'g'),
      true,
      'whatsapp',
      array['whatsapp'],
      -- Quien llega por WhatsApp todavía no compró ni negoció (v185).
      'prospecto'
    )
    returning id into v_contacto_id;

    v_nuevo := true;

    insert into public.eos_wa_eventos (usuario_id, canal_id, contacto_id, evento, actor, resumen)
    values (v_canal.usuario_id, p_canal_id, v_contacto_id, 'cliente_nuevo', 'sistema',
            'Cliente nuevo por WhatsApp: se creó su ficha en el CRM.');
  end if;

  -- El mensaje. `on conflict` cubre la carrera entre dos entregas simultáneas.
  insert into public.eos_wa_mensajes (
    usuario_id, canal_id, contacto_id, wa_message_id, direccion, telefono, tipo, texto,
    estado, origen, intencion, ocurrio_en
  )
  values (
    v_canal.usuario_id, p_canal_id, v_contacto_id, p_wa_message_id, 'entrante',
    regexp_replace(p_telefono, '\D', '', 'g'), v_tipo, left(p_texto, 4096),
    'recibido', 'cliente', nullif(p_intencion, ''), v_ocurrio
  )
  on conflict (canal_id, wa_message_id) where wa_message_id is not null do nothing
  returning id into v_mensaje_id;

  if v_mensaje_id is null then
    return jsonb_build_object('duplicado', true, 'contacto_id', v_contacto_id);
  end if;

  -- "Última interacción" al día, y el mensaje entra al historial del cliente.
  update public.eos_crm_contactos
     set ultima_interaccion_en = greatest(coalesce(ultima_interaccion_en, v_ocurrio), v_ocurrio),
         actualizado_en = now()
   where id = v_contacto_id;

  insert into public.eos_crm_actividades (usuario_id, contacto_id, tipo, detalle, fecha, hecha)
  values (
    v_canal.usuario_id, v_contacto_id, 'whatsapp',
    left('El cliente escribió por WhatsApp: ' || coalesce(nullif(btrim(p_texto), ''), '(' || v_tipo || ')'), 4000),
    (v_ocurrio at time zone 'America/Asuncion')::date, true
  );

  -- Consentimiento. Escribir primero habilita a responder, pero una baja previa
  -- NO se levanta porque el cliente vuelva a escribir.
  select * into v_previo
  from public.eos_wa_consentimientos where canal_id = p_canal_id and contacto_id = v_contacto_id;

  if p_intencion = 'baja' then
    insert into public.eos_wa_consentimientos (usuario_id, canal_id, contacto_id, estado, origen, evidencia, cambiado_en)
    values (v_canal.usuario_id, p_canal_id, v_contacto_id, 'revocado', 'baja_por_mensaje',
            'Mensaje ' || coalesce(p_wa_message_id, ''), now())
    on conflict (canal_id, contacto_id)
    do update set estado = 'revocado', origen = 'baja_por_mensaje',
                  evidencia = excluded.evidencia, cambiado_en = now();

    v_opt_out := true;

    insert into public.eos_wa_eventos (usuario_id, canal_id, contacto_id, evento, actor, resumen)
    values (v_canal.usuario_id, p_canal_id, v_contacto_id, 'opt_out', 'cliente',
            'El cliente pidió no recibir más mensajes. EOS dejó de escribirle.');
  elsif v_previo.id is null then
    insert into public.eos_wa_consentimientos (usuario_id, canal_id, contacto_id, estado, origen, evidencia)
    values (v_canal.usuario_id, p_canal_id, v_contacto_id, 'otorgado', 'cliente_escribio',
            'Mensaje ' || coalesce(p_wa_message_id, ''))
    on conflict (canal_id, contacto_id) do nothing;
  end if;

  -- Lo que el mensaje pide, en el CRM.
  if p_intencion in ('consulta_precio', 'interes', 'confirma_compra') then
    select o.id, o.etapa into v_op_id, v_op_etapa
    from public.eos_crm_oportunidades o
    where o.contacto_id = v_contacto_id and o.etapa not in ('ganada', 'perdida')
    order by o.creado_en desc
    limit 1;

    if v_op_id is null then
      insert into public.eos_crm_oportunidades (usuario_id, contacto_id, titulo, detalle, etapa)
      values (
        v_canal.usuario_id, v_contacto_id, 'Consulta por WhatsApp',
        left(coalesce(p_texto, ''), 1000),
        case when p_intencion = 'confirma_compra' then 'negociacion' else 'nueva' end
      )
      returning id into v_op_id;

      insert into public.eos_wa_eventos (usuario_id, canal_id, contacto_id, evento, actor, resumen)
      values (v_canal.usuario_id, p_canal_id, v_contacto_id, 'oportunidad_creada', 'eos',
              'EOS abrió una oportunidad por lo que preguntó el cliente.');
    elsif p_intencion = 'confirma_compra' and v_op_etapa in ('nueva', 'contactado', 'propuesta') then
      update public.eos_crm_oportunidades
         set etapa = 'negociacion', actualizado_en = now()
       where id = v_op_id;
    end if;

    if p_intencion = 'confirma_compra' then
      insert into public.eos_wa_eventos (usuario_id, canal_id, contacto_id, evento, actor, resumen)
      values (v_canal.usuario_id, p_canal_id, v_contacto_id, 'requiere_atencion_humana', 'eos',
              'El cliente confirmó la compra: falta que autorices registrar la venta.');
    end if;

  elsif p_intencion = 'lo_pensara' then
    select o.id into v_op_id
    from public.eos_crm_oportunidades o
    where o.contacto_id = v_contacto_id and o.etapa not in ('ganada', 'perdida')
    order by o.creado_en desc
    limit 1;

    insert into public.eos_crm_actividades (usuario_id, contacto_id, oportunidad_id, tipo, detalle, fecha, hecha)
    values (
      v_canal.usuario_id, v_contacto_id, v_op_id, 'tarea',
      'Retomar: el cliente dijo que lo iba a pensar.',
      (v_ocurrio at time zone 'America/Asuncion')::date + 3, false
    );

    insert into public.eos_wa_eventos (usuario_id, canal_id, contacto_id, evento, actor, resumen)
    values (v_canal.usuario_id, p_canal_id, v_contacto_id, 'seguimiento_creado', 'eos',
            'El cliente dijo que lo iba a pensar: EOS dejó un seguimiento para dentro de 3 días.');

  elsif p_intencion = 'pide_persona' then
    insert into public.eos_wa_eventos (usuario_id, canal_id, contacto_id, evento, actor, resumen)
    values (v_canal.usuario_id, p_canal_id, v_contacto_id, 'requiere_atencion_humana', 'cliente',
            'El cliente pidió hablar con una persona.');
  end if;

  if v_op_id is not null then
    update public.eos_wa_mensajes set oportunidad_id = v_op_id where id = v_mensaje_id;
  end if;

  return jsonb_build_object(
    'duplicado', false,
    'mensaje_id', v_mensaje_id,
    'contacto_id', v_contacto_id,
    'contacto_nuevo', v_nuevo,
    'oportunidad_id', v_op_id,
    'opt_out', v_opt_out
  );
end;
$function$;

revoke execute on function public.eos_wa_recibir_v177(uuid, text, text, text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.eos_wa_recibir_v177(uuid, text, text, text, text, text, timestamptz, text)
  to service_role;
