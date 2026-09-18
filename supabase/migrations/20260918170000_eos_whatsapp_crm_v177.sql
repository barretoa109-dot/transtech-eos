-- v177: WhatsApp de la EMPRESA con sus clientes (Canal Empresa/EOS ↔ Cliente).
--
-- ============================================================
-- DOS CANALES QUE NO SE MEZCLAN
-- ============================================================
--
--   Canal Usuario ↔ EOS   `eos_whatsapp_vinculos_v162`. La persona le habla a
--                         EOS desde su teléfono. Un número, una cuenta.
--   Canal Empresa ↔ Cliente   ESTA migración. El WhatsApp Business de la
--                         empresa, por el que EOS ayuda a atender y a hacer
--                         seguimiento de sus clientes.
--
-- Comparten el webhook de Meta pero nada más: `metadata.phone_number_id` decide
-- de qué canal es cada mensaje, y un mensaje de un canal de empresa NUNCA
-- entra al camino de "usuario nuevo" del otro (ver el despacho en
-- `app/api/whatsapp/webhook/route.ts`).
--
-- ============================================================
-- LO QUE NO SE GUARDA ACÁ
-- ============================================================
--
-- El token de acceso de Meta. `eos_wa_canales.secreto_ref` apunta a un secreto
-- de Supabase Vault; la tabla nunca tiene el token, así que una lectura por RLS
-- o un volcado no lo exponen.
--
-- ============================================================
-- AISLAMIENTO
-- ============================================================
--
-- Todas las tablas llevan `usuario_id` y `empresa_id` (el segundo lo hereda el
-- trigger de la v110) y la misma policy de lectura que el resto del ERP/CRM:
-- la fila es del usuario o de su empresa. Una empresa no ve canales, clientes,
-- conversaciones ni consentimientos de otra. Las escrituras son solo de
-- `service_role`, desde rutas que ya verificaron quién es el dueño.

-- ============================================================
-- 1) El CRM sabe de dónde vino cada cliente y cuándo se habló por última vez
-- ============================================================

alter table public.eos_crm_contactos
  add column if not exists origen text not null default 'manual'
    check (origen in ('manual', 'whatsapp', 'importado', 'venta', 'web', 'otro')),
  add column if not exists ultima_interaccion_en timestamptz;

comment on column public.eos_crm_contactos.origen is
  'v177: cómo llegó el cliente. "whatsapp" cuando lo creó el canal de la empresa al recibir su primer mensaje.';
comment on column public.eos_crm_contactos.ultima_interaccion_en is
  'v177: cuándo fue el último mensaje con el cliente, en cualquier sentido. Lo actualiza el canal de WhatsApp; para otras vías se puede derivar de las actividades.';

-- ============================================================
-- 2) Canales: el número de WhatsApp Business de cada empresa
-- ============================================================

create table if not exists public.eos_wa_canales (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid references public.eos_empresas(id) on delete set null,

  -- Lo que Meta llama "Phone Number ID": identifica el número en cada webhook.
  phone_number_id text not null unique check (length(btrim(phone_number_id)) between 5 and 64),
  waba_id text,
  -- E.164 sin el "+", como lo muestra WhatsApp.
  telefono text check (telefono is null or telefono ~ '^[0-9]{8,15}$'),
  nombre_visible text check (nombre_visible is null or length(btrim(nombre_visible)) between 1 and 120),

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'activo', 'pausado', 'desconectado')),

  -- Referencia al secreto de Vault con el token. NUNCA el token.
  secreto_ref uuid,

  -- Los límites arrancan conservadores a propósito: el tope real lo pone Meta
  -- según la calidad del número, y subirlo es decisión de la empresa.
  limite_diario integer not null default 250 check (limite_diario between 1 and 100000),
  limite_por_contacto_dia smallint not null default 2 check (limite_por_contacto_dia between 1 and 10),
  silencio_desde_hora smallint not null default 21 check (silencio_desde_hora between 0 and 23),
  silencio_hasta_hora smallint not null default 7 check (silencio_hasta_hora between 0 and 23),

  -- ¿EOS puede contestar solo a un cliente que acaba de escribir? Apagado por
  -- defecto: la empresa lo enciende cuando confía en las respuestas.
  respuesta_automatica boolean not null default false,

  conectado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists eos_wa_canales_usuario_idx on public.eos_wa_canales (usuario_id);
create index if not exists eos_wa_canales_empresa_idx on public.eos_wa_canales (empresa_id) where empresa_id is not null;

comment on table public.eos_wa_canales is
  'v177: el número de WhatsApp Business de una empresa. Sin token: el secreto vive en Vault (secreto_ref).';

-- ============================================================
-- 3) Consentimiento: quién aceptó y quién pidió no recibir más
-- ============================================================

create table if not exists public.eos_wa_consentimientos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid references public.eos_empresas(id) on delete set null,
  canal_id uuid not null references public.eos_wa_canales(id) on delete cascade,
  contacto_id uuid not null references public.eos_crm_contactos(id) on delete cascade,

  estado text not null check (estado in ('otorgado', 'revocado')),
  origen text not null check (origen in (
    'cliente_escribio',    -- el cliente inició la conversación
    'formulario',          -- lo aceptó en un formulario propio de la empresa
    'verbal_registrado',   -- lo dijo y el dueño lo asentó, con evidencia
    'baja_por_mensaje',    -- pidió la baja por WhatsApp
    'baja_manual'          -- el dueño lo dio de baja
  )),
  -- Cómo se puede demostrar. Sin evidencia, un consentimiento declarado por el
  -- dueño no habilita a iniciar conversaciones.
  evidencia text,

  cambiado_en timestamptz not null default now(),

  constraint eos_wa_consentimientos_uniq unique (canal_id, contacto_id)
);

create index if not exists eos_wa_consentimientos_usuario_idx on public.eos_wa_consentimientos (usuario_id);

comment on table public.eos_wa_consentimientos is
  'v177: una fila por cliente y canal. "revocado" gana sobre todo lo demás y solo se levanta con un consentimiento explícito nuevo, no porque el cliente vuelva a escribir.';

-- ============================================================
-- 4) Plantillas: lo único con lo que se puede iniciar fuera de la ventana de 24 h
-- ============================================================

create table if not exists public.eos_wa_plantillas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid references public.eos_empresas(id) on delete set null,
  canal_id uuid not null references public.eos_wa_canales(id) on delete cascade,

  -- El nombre que exige Meta: minúsculas, números y guion bajo.
  nombre text not null check (nombre ~ '^[a-z0-9_]{1,512}$'),
  idioma text not null default 'es',
  categoria text not null check (categoria in ('utilidad', 'marketing', 'autenticacion')),
  cuerpo text not null check (length(btrim(cuerpo)) between 1 and 1024),
  cantidad_variables smallint not null default 0 check (cantidad_variables between 0 and 20),

  estado text not null default 'borrador'
    check (estado in ('borrador', 'en_revision', 'aprobada', 'rechazada', 'pausada')),
  meta_template_id text,
  motivo_rechazo text,

  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint eos_wa_plantillas_uniq unique (canal_id, nombre, idioma)
);

create index if not exists eos_wa_plantillas_usuario_idx on public.eos_wa_plantillas (usuario_id);

comment on table public.eos_wa_plantillas is
  'v177: plantillas de mensaje y su estado ante Meta. Solo una plantilla "aprobada" puede usarse para iniciar o retomar una conversación.';

-- ============================================================
-- 5) Mensajes: el historial completo, con la decisión y su motivo
-- ============================================================

create table if not exists public.eos_wa_mensajes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid references public.eos_empresas(id) on delete set null,
  canal_id uuid not null references public.eos_wa_canales(id) on delete cascade,
  contacto_id uuid references public.eos_crm_contactos(id) on delete set null,

  -- El id que le pone Meta. Es lo que hace idempotente la recepción: Meta
  -- reintenta el mismo webhook y no puede duplicar el mensaje.
  wa_message_id text,
  -- Para lo saliente que todavía no tiene id de Meta: la misma orden dos veces
  -- no manda dos mensajes.
  clave_idempotencia text,

  direccion text not null check (direccion in ('entrante', 'saliente')),
  telefono text not null,
  tipo text not null default 'texto' check (tipo in ('texto', 'imagen', 'documento', 'audio', 'plantilla', 'otro')),
  texto text check (texto is null or length(texto) <= 4096),
  plantilla_id uuid references public.eos_wa_plantillas(id) on delete set null,

  estado text not null check (estado in (
    'recibido', 'pendiente_aprobacion', 'en_cola', 'enviado', 'entregado', 'leido', 'fallido', 'bloqueado'
  )),
  -- Por qué se bloqueó o falló. Un "no salió" sin motivo es el peor estado.
  motivo text,

  origen text not null check (origen in ('cliente', 'usuario', 'eos_autonomo')),
  autorizacion text check (autorizacion is null or autorizacion in ('aprobada', 'regla_autonomia', 'ninguna')),

  -- Lo que se entendió del mensaje entrante y qué se hizo con eso.
  intencion text,
  oportunidad_id uuid references public.eos_crm_oportunidades(id) on delete set null,

  ocurrio_en timestamptz not null default now(),
  creado_en timestamptz not null default now()
);

create unique index if not exists eos_wa_mensajes_wa_id_uniq
  on public.eos_wa_mensajes (canal_id, wa_message_id) where wa_message_id is not null;
create unique index if not exists eos_wa_mensajes_clave_uniq
  on public.eos_wa_mensajes (canal_id, clave_idempotencia) where clave_idempotencia is not null;
create index if not exists eos_wa_mensajes_conversacion_idx
  on public.eos_wa_mensajes (canal_id, telefono, ocurrio_en desc);
create index if not exists eos_wa_mensajes_contacto_idx
  on public.eos_wa_mensajes (contacto_id, ocurrio_en desc) where contacto_id is not null;
create index if not exists eos_wa_mensajes_usuario_idx
  on public.eos_wa_mensajes (usuario_id, ocurrio_en desc);

comment on table public.eos_wa_mensajes is
  'v177: cada mensaje entrante y saliente del canal de una empresa, con la decisión de envío y su motivo.';

-- ============================================================
-- 6) Eventos: lo que EOS hizo por su cuenta, append-only
-- ============================================================

create table if not exists public.eos_wa_eventos (
  id bigint primary key generated always as identity,
  usuario_id uuid not null references auth.users(id) on delete cascade,

  -- Sin llaves foráneas a propósito: la tabla es append-only y un `on delete set
  -- null` o un cascade sobre estas columnas sería un UPDATE/DELETE que el trigger
  -- rechaza. Borrar un cliente no puede fallar por tener historial, y el historial
  -- tiene que sobrevivir al cliente. Igual que `eos_auditoria_v60`.
  empresa_id uuid,
  canal_id uuid,
  contacto_id uuid,

  evento text not null check (evento in (
    'canal_conectado', 'canal_pausado', 'canal_reanudado', 'canal_desconectado',
    'cliente_nuevo', 'opt_out', 'opt_in',
    'envio_bloqueado', 'envio_aprobado', 'envio_realizado',
    'requiere_atencion_humana', 'oportunidad_creada', 'seguimiento_creado'
  )),
  actor text not null check (actor in ('sistema', 'usuario', 'eos', 'cliente')),
  -- Legible: es lo que se le muestra al dueño para que vea qué hizo EOS.
  resumen text not null,
  detalle jsonb not null default '{}'::jsonb,

  creado_en timestamptz not null default now()
);

create index if not exists eos_wa_eventos_usuario_idx on public.eos_wa_eventos (usuario_id, id desc);

comment on table public.eos_wa_eventos is
  'v177: registro append-only de las acciones automáticas del canal (bajas, bloqueos, aprobaciones, seguimientos). Ni service_role puede editar o borrar filas.';

-- Append-only, con la misma salida de emergencia para borrar la cuenta que usa
-- la bitácora inmutable (v167): solo dentro de `eos_borrar_mis_datos_v55`.
drop trigger if exists eos_wa_eventos_solo_agregar_trg on public.eos_wa_eventos;
create trigger eos_wa_eventos_solo_agregar_trg
  before update or delete on public.eos_wa_eventos
  for each row execute function public.eos_auditoria_solo_agregar_v60();

-- ============================================================
-- 7) `empresa_id` heredado y RLS: mismo patrón que el resto del ERP/CRM
-- ============================================================

do $$
declare
  t text;
  tablas text[] := array[
    'eos_wa_canales', 'eos_wa_consentimientos', 'eos_wa_plantillas', 'eos_wa_mensajes', 'eos_wa_eventos'
  ];
begin
  foreach t in array tablas loop
    execute format('drop trigger if exists eos_empresa_heredar on public.%I', t);
    execute format(
      'create trigger eos_empresa_heredar before insert on public.%I
         for each row execute function public.eos_empresa_heredar_v110()',
      t
    );

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);

    -- Solo lectura para quien inicia sesión: ver lo propio o lo de su empresa.
    execute format(
      'create policy %I on public.%I
         for select to authenticated
         using (
           (select auth.uid()) = usuario_id
           or empresa_id = (select public.eos_mi_empresa_v109())
         )',
      t || '_leer', t
    );

    -- Nada para anon; escribir, solo service_role desde rutas que ya verificaron al dueño.
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- La bitácora ni siquiera la puede reescribir la clave de servicio.
revoke update, delete, truncate on public.eos_wa_eventos from service_role;

-- ============================================================
-- 8) Recibir un mensaje del cliente
-- ============================================================
--
-- Todo lo que toca al CRM al llegar un mensaje, en UNA transacción: si falla a
-- la mitad no queda un cliente creado sin su mensaje ni una oportunidad sin
-- cliente. La lectura de intención (`lib/whatsapp-crm/intencion.ts`) se hace
-- ANTES, en TypeScript, y llega como `p_intencion`.
--
-- Encontrar al cliente: se compara por los últimos 9 dígitos. En Paraguay eso
-- es el número nacional completo, y salva las cuatro formas en que está escrito
-- el mismo teléfono ("0981…", "+595 981…", etc.). Se busca SOLO dentro de la
-- empresa dueña del canal: el mismo teléfono en dos empresas son dos clientes.

create or replace function public.eos_wa_recibir_v177(
  p_canal_id uuid,
  p_wa_message_id text,
  p_telefono text,
  p_texto text,
  p_tipo text,
  p_nombre_perfil text,
  p_ocurrio_en timestamptz,
  p_intencion text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    insert into public.eos_crm_contactos (usuario_id, nombre, telefono, es_cliente, origen, etiquetas)
    values (
      v_canal.usuario_id,
      left(coalesce(nullif(btrim(p_nombre_perfil), ''), '+' || regexp_replace(p_telefono, '\D', '', 'g')), 160),
      regexp_replace(p_telefono, '\D', '', 'g'),
      true,
      'whatsapp',
      array['whatsapp']
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
$$;

-- ============================================================
-- 9) Lo que hace falta para decidir si se puede enviar
-- ============================================================
--
-- Las cinco entradas de `evaluarEnvio` (lib/whatsapp-crm/politica.ts) en una
-- sola consulta. La decisión NO se toma acá: vive en TypeScript, donde se
-- prueba, y esta función solo trae los números. Dos copias de la política
-- terminan diciendo cosas distintas.

create or replace function public.eos_wa_contexto_envio_v177(p_canal_id uuid, p_contacto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_canal public.eos_wa_canales%rowtype;
  v_inicio timestamptz := date_trunc('day', now() at time zone 'America/Asuncion') at time zone 'America/Asuncion';
  v_consent text;
  v_ultimo timestamptz;
  v_hoy integer;
  v_hoy_contacto integer;
begin
  select * into v_canal from public.eos_wa_canales where id = p_canal_id;
  if not found then
    raise exception 'EOS_WA_CANAL_NO_ENCONTRADO';
  end if;

  select cs.estado into v_consent
  from public.eos_wa_consentimientos cs
  where cs.canal_id = p_canal_id and cs.contacto_id = p_contacto_id;

  select max(m.ocurrio_en) into v_ultimo
  from public.eos_wa_mensajes m
  where m.canal_id = p_canal_id and m.contacto_id = p_contacto_id and m.direccion = 'entrante';

  select count(*) into v_hoy
  from public.eos_wa_mensajes m
  where m.canal_id = p_canal_id and m.direccion = 'saliente'
    and m.estado in ('en_cola', 'enviado', 'entregado', 'leido') and m.ocurrio_en >= v_inicio;

  select count(*) into v_hoy_contacto
  from public.eos_wa_mensajes m
  where m.canal_id = p_canal_id and m.contacto_id = p_contacto_id and m.direccion = 'saliente'
    and m.origen = 'eos_autonomo'
    and m.estado in ('en_cola', 'enviado', 'entregado', 'leido') and m.ocurrio_en >= v_inicio;

  return jsonb_build_object(
    'canal', jsonb_build_object(
      'estado', v_canal.estado,
      'limite_diario', v_canal.limite_diario,
      'enviados_hoy', v_hoy,
      'limite_por_contacto_dia', v_canal.limite_por_contacto_dia,
      'silencio_desde_hora', v_canal.silencio_desde_hora,
      'silencio_hasta_hora', v_canal.silencio_hasta_hora,
      'respuesta_automatica', v_canal.respuesta_automatica
    ),
    'consentimiento', coalesce(v_consent, 'sin_registro'),
    'ultimo_entrante_en', v_ultimo,
    'enviados_a_este_contacto_hoy', v_hoy_contacto
  );
end;
$$;

-- ============================================================
-- 10) Registrar un mensaje saliente (enviado, bloqueado o pendiente de aprobar)
-- ============================================================
--
-- Se registra SIEMPRE, también lo bloqueado: el dueño tiene que poder ver que
-- EOS quiso escribir y por qué no salió. Idempotente por `p_clave`: la misma
-- orden dos veces no genera dos mensajes.

create or replace function public.eos_wa_registrar_saliente_v177(
  p_canal_id uuid,
  p_contacto_id uuid,
  p_clave text,
  p_texto text,
  p_plantilla_id uuid,
  p_origen text,
  p_autorizacion text,
  p_estado text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canal public.eos_wa_canales%rowtype;
  v_contacto public.eos_crm_contactos%rowtype;
  v_id uuid;
  v_telefono text;
begin
  if p_estado not in ('pendiente_aprobacion', 'en_cola', 'bloqueado') then
    raise exception 'EOS_WA_ESTADO_INVALIDO: %', p_estado;
  end if;
  if p_origen not in ('usuario', 'eos_autonomo') then
    raise exception 'EOS_WA_ORIGEN_INVALIDO: %', p_origen;
  end if;

  select * into v_canal from public.eos_wa_canales where id = p_canal_id;
  if not found then
    raise exception 'EOS_WA_CANAL_NO_ENCONTRADO';
  end if;

  select * into v_contacto from public.eos_crm_contactos where id = p_contacto_id;
  if not found then
    raise exception 'EOS_WA_CONTACTO_NO_ENCONTRADO';
  end if;

  -- El aislamiento entre empresas, dicho en voz alta: un cliente de otra
  -- empresa no puede recibir mensajes por este canal aunque alguien conozca su id.
  if not (v_contacto.usuario_id = v_canal.usuario_id
          or (v_canal.empresa_id is not null and v_contacto.empresa_id = v_canal.empresa_id)) then
    raise exception 'EOS_WA_CONTACTO_AJENO';
  end if;

  v_telefono := regexp_replace(coalesce(v_contacto.telefono, ''), '\D', '', 'g');
  if length(v_telefono) < 8 then
    raise exception 'EOS_WA_CONTACTO_SIN_TELEFONO';
  end if;

  insert into public.eos_wa_mensajes (
    usuario_id, canal_id, contacto_id, clave_idempotencia, direccion, telefono,
    tipo, texto, plantilla_id, estado, motivo, origen, autorizacion
  )
  values (
    v_canal.usuario_id, p_canal_id, p_contacto_id, nullif(p_clave, ''), 'saliente', v_telefono,
    case when p_plantilla_id is null then 'texto' else 'plantilla' end,
    left(p_texto, 4096), p_plantilla_id, p_estado, left(p_motivo, 500), p_origen,
    nullif(p_autorizacion, '')
  )
  on conflict (canal_id, clave_idempotencia) where clave_idempotencia is not null do nothing
  returning id into v_id;

  if v_id is null then
    select m.id into v_id
    from public.eos_wa_mensajes m
    where m.canal_id = p_canal_id and m.clave_idempotencia = p_clave;

    return jsonb_build_object('duplicado', true, 'mensaje_id', v_id, 'telefono', v_telefono);
  end if;

  if p_estado = 'bloqueado' then
    insert into public.eos_wa_eventos (usuario_id, canal_id, contacto_id, evento, actor, resumen, detalle)
    values (v_canal.usuario_id, p_canal_id, p_contacto_id, 'envio_bloqueado', 'sistema',
            coalesce(nullif(p_motivo, ''), 'Envío bloqueado por la política del canal.'),
            jsonb_build_object('mensaje_id', v_id));
  end if;

  return jsonb_build_object('duplicado', false, 'mensaje_id', v_id, 'telefono', v_telefono);
end;
$$;

-- ============================================================
-- 11) Confirmar el resultado del envío y las confirmaciones de Meta
-- ============================================================
--
-- Los estados solo avanzan: un "entregado" que llega tarde no puede pisar un
-- "leído". `fallido` solo aplica a lo que todavía no fue entregado.

create or replace function public.eos_wa_actualizar_estado_v177(
  p_canal_id uuid,
  p_mensaje_id uuid,
  p_wa_message_id text,
  p_estado text,
  p_motivo text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
  v_orden constant text[] := array['en_cola', 'enviado', 'entregado', 'leido'];
begin
  if p_estado not in ('enviado', 'entregado', 'leido', 'fallido') then
    raise exception 'EOS_WA_ESTADO_INVALIDO: %', p_estado;
  end if;

  update public.eos_wa_mensajes m
     set wa_message_id = coalesce(m.wa_message_id, nullif(p_wa_message_id, '')),
         estado = p_estado,
         motivo = case when p_estado = 'fallido' then left(p_motivo, 500) else m.motivo end
   where m.canal_id = p_canal_id
     and m.direccion = 'saliente'
     and (
       (p_mensaje_id is not null and m.id = p_mensaje_id)
       or (p_mensaje_id is null and m.wa_message_id = p_wa_message_id)
     )
     and (
       (p_estado = 'fallido' and m.estado in ('en_cola', 'enviado'))
       or (p_estado <> 'fallido'
           and array_position(v_orden, m.estado) is not null
           and array_position(v_orden, p_estado) > array_position(v_orden, m.estado))
     );

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- ============================================================
-- 12) Permisos: solo service_role. Nada de anon ni authenticated.
-- ============================================================

revoke execute on function public.eos_wa_recibir_v177(uuid, text, text, text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.eos_wa_recibir_v177(uuid, text, text, text, text, text, timestamptz, text)
  to service_role;

revoke execute on function public.eos_wa_contexto_envio_v177(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.eos_wa_contexto_envio_v177(uuid, uuid)
  to service_role;

revoke execute on function public.eos_wa_registrar_saliente_v177(uuid, uuid, text, text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_wa_registrar_saliente_v177(uuid, uuid, text, text, uuid, text, text, text, text)
  to service_role;

revoke execute on function public.eos_wa_actualizar_estado_v177(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_wa_actualizar_estado_v177(uuid, uuid, text, text, text)
  to service_role;
