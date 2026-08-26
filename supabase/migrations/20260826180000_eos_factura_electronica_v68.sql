-- EOS — Factura electrónica (SIFEN)
--
-- ============================================================
-- QUÉ HACE Y QUÉ NO HACE ESTE MÓDULO. LEER ANTES DE PROMETER NADA.
-- ============================================================
--
-- Emitir una factura electrónica en Paraguay tiene cinco pasos:
--
--   1. Armar el Documento Electrónico (DE) como XML según la especificación
--      técnica de la SET.
--   2. Calcular el CDC, el código de control de 44 dígitos que lo identifica.
--   3. FIRMARLO con un certificado digital cualificado a nombre del
--      contribuyente.
--   4. Enviarlo a los web services de SIFEN y esperar la aprobación.
--   5. Generar el KuDE, la representación gráfica que se le entrega al cliente.
--
-- **Esta migración y su código cubren 1, 2 y 5.** Los pasos 3 y 4 dependen de
-- dos cosas que no están del lado del software: el certificado digital, que lo
-- compra el contribuyente a un prestador habilitado, y la habilitación del RUC
-- como facturador electrónico ante la SET, con sus credenciales de ambiente de
-- prueba y de producción.
--
-- Por eso el modelo distingue con todas las letras entre un documento
-- `borrador` —que ya tiene CDC, XML y KuDE, y sirve para probar todo el
-- circuito— y uno `aprobado`, que solo existe después de que SIFEN lo diga.
-- Un sistema que llame "factura" a lo primero mete a su usuario en un problema
-- con la SET, y eso es mucho peor que no tener el módulo.
--
-- ============================================================
-- EL CERTIFICADO NO SE GUARDA ACÁ
-- ============================================================
--
-- `eos_fe_config` guarda una REFERENCIA al certificado, nunca el archivo ni su
-- contraseña. Un .p12 en una fila de base de datos es la llave con la que se
-- puede facturar a nombre de otro: si un día se filtra un backup, se filtró la
-- identidad tributaria de todos los usuarios. Cuando llegue el paso 3, el
-- certificado va en un almacén de secretos y esta columna dice cuál es.

-- ============================================================
-- 1) Los datos del emisor
-- ============================================================

create table if not exists public.eos_fe_config (
  usuario_id uuid primary key references auth.users(id) on delete cascade,

  ruc text not null,
  ruc_dv smallint not null check (ruc_dv between 0 and 9),
  razon_social text not null,
  nombre_fantasia text,

  -- 1 = persona física, 2 = persona jurídica. Va adentro del CDC.
  tipo_contribuyente smallint not null default 1 check (tipo_contribuyente in (1, 2)),

  timbrado_numero text,
  timbrado_inicio date,
  timbrado_fin date,

  -- Los tres números que arman la numeración: 001-001-0000001.
  establecimiento text not null default '001' check (establecimiento ~ '^[0-9]{3}$'),
  punto_expedicion text not null default '001' check (punto_expedicion ~ '^[0-9]{3}$'),

  actividad_economica text,
  actividad_descripcion text,

  direccion text,
  numero_casa text,
  departamento smallint,
  distrito smallint,
  ciudad smallint,
  telefono text,
  email text,

  -- 'test' apunta al ambiente de prueba de SIFEN. Arranca ahí SIEMPRE: nadie
  -- debería poder emitir en producción por accidente en su primer intento.
  ambiente text not null default 'test' check (ambiente in ('test', 'prod')),

  -- Solo el NOMBRE del secreto donde vive el certificado. Nunca el certificado.
  certificado_ref text,

  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.eos_fe_config is
  'Datos del emisor para SIFEN. El certificado digital NO se guarda acá: solo la referencia al secreto.';
comment on column public.eos_fe_config.certificado_ref is
  'Nombre del secreto donde vive el .p12. Un certificado en la base es la identidad tributaria del usuario en un backup.';

-- ============================================================
-- 2) La numeración
-- ============================================================
--
-- Un número de factura no se puede repetir NUNCA, y tampoco puede saltear.
-- Por eso el contador vive en su propia fila con su propio lock, y no se
-- calcula con un `max(numero) + 1` sobre los documentos — que es la forma
-- clásica de emitir dos facturas con el mismo número cuando entran dos ventas
-- al mismo tiempo.

create table if not exists public.eos_fe_secuencias (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tipo_documento smallint not null,
  establecimiento text not null,
  punto_expedicion text not null,

  ultimo_numero bigint not null default 0 check (ultimo_numero >= 0),
  actualizado_en timestamptz not null default now(),

  primary key (usuario_id, tipo_documento, establecimiento, punto_expedicion)
);

create or replace function public.eos_fe_siguiente_numero(
  p_usuario_id uuid,
  p_tipo_documento smallint,
  p_establecimiento text,
  p_punto text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  -- `on conflict do update` con `returning`: el insert y el incremento son la
  -- misma sentencia, así que dos ventas simultáneas se ordenan solas en vez de
  -- leer las dos el mismo número.
  insert into public.eos_fe_secuencias (
    usuario_id, tipo_documento, establecimiento, punto_expedicion, ultimo_numero
  ) values (
    p_usuario_id, p_tipo_documento, p_establecimiento, p_punto, 1
  )
  on conflict (usuario_id, tipo_documento, establecimiento, punto_expedicion) do update
    set ultimo_numero = public.eos_fe_secuencias.ultimo_numero + 1,
        actualizado_en = now()
  returning ultimo_numero into v_numero;

  if v_numero > 9999999 then
    raise exception 'EOS_FE_NUMERACION_AGOTADA';
  end if;

  return v_numero;
end;
$$;

revoke all on function public.eos_fe_siguiente_numero(uuid, smallint, text, text)
  from public, anon, authenticated;
grant execute on function public.eos_fe_siguiente_numero(uuid, smallint, text, text)
  to service_role;

-- ============================================================
-- 3) Los documentos electrónicos
-- ============================================================

create table if not exists public.eos_fe_documentos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  venta_id uuid references public.eos_erp_ventas(id) on delete set null,

  -- 1 factura, 4 autofactura, 5 nota de crédito, 6 nota de débito, 7 remisión.
  tipo_documento smallint not null default 1
    check (tipo_documento in (1, 4, 5, 6, 7)),

  establecimiento text not null check (establecimiento ~ '^[0-9]{3}$'),
  punto_expedicion text not null check (punto_expedicion ~ '^[0-9]{3}$'),
  numero bigint not null check (numero between 1 and 9999999),

  -- 44 dígitos. Es la identidad del documento ante la SET.
  cdc text not null check (cdc ~ '^[0-9]{44}$'),

  fecha_emision timestamptz not null default now(),

  -- El recorrido real de un DE. `borrador` tiene CDC y XML pero NO es una
  -- factura todavía; solo `aprobado` lo es. Ver el comentario de cabecera.
  estado text not null default 'borrador'
    check (estado in ('borrador', 'firmado', 'enviado', 'aprobado', 'rechazado', 'cancelado')),

  total numeric(16,2) not null default 0,
  moneda text not null default 'PYG',

  xml text,
  -- Lo que contestó SIFEN, tal cual vino. Un rechazo sin el motivo original es
  -- imposible de corregir.
  respuesta jsonb,
  motivo_rechazo text,

  enviado_en timestamptz,
  aprobado_en timestamptz,

  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint eos_fe_documentos_cdc_uniq unique (cdc),
  constraint eos_fe_documentos_numero_uniq
    unique (usuario_id, tipo_documento, establecimiento, punto_expedicion, numero)
);

create index if not exists eos_fe_documentos_usuario_idx
  on public.eos_fe_documentos (usuario_id, fecha_emision desc);

comment on table public.eos_fe_documentos is
  'Documentos electrónicos. Un borrador tiene CDC y XML pero NO es una factura: solo lo es cuando SIFEN lo aprueba.';

-- ============================================================
-- 4) RLS
-- ============================================================
--
-- Lectura para el dueño; escritura SOLO del servidor. Un usuario que pudiera
-- escribir en `eos_fe_documentos` podría cambiarle el CDC o el estado a su
-- propia factura, o marcar como "aprobado" algo que SIFEN nunca vio. Eso no es
-- un problema de la aplicación: es un problema con la SET.

alter table public.eos_fe_config enable row level security;

drop policy if exists fe_config_select on public.eos_fe_config;
create policy fe_config_select on public.eos_fe_config
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists fe_config_insert on public.eos_fe_config;
create policy fe_config_insert on public.eos_fe_config
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists fe_config_update on public.eos_fe_config;
create policy fe_config_update on public.eos_fe_config
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

revoke all on table public.eos_fe_config from anon, authenticated;
grant select, insert, update on table public.eos_fe_config to authenticated, service_role;

alter table public.eos_fe_documentos enable row level security;

drop policy if exists fe_documentos_select on public.eos_fe_documentos;
create policy fe_documentos_select on public.eos_fe_documentos
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_fe_documentos from anon, authenticated;
grant select on table public.eos_fe_documentos to authenticated;
grant select, insert, update on table public.eos_fe_documentos to service_role;

alter table public.eos_fe_secuencias enable row level security;

drop policy if exists fe_secuencias_select on public.eos_fe_secuencias;
create policy fe_secuencias_select on public.eos_fe_secuencias
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_fe_secuencias from anon, authenticated;
grant select on table public.eos_fe_secuencias to authenticated;
grant select, insert, update on table public.eos_fe_secuencias to service_role;

-- ============================================================
-- 5) El módulo, en el catálogo
-- ============================================================
--
-- Entra como NO público: existe, funciona hasta donde puede funcionar, y no se
-- ofrece hasta que el circuito con la SET esté cerrado de punta a punta. Un
-- módulo visible que no puede emitir una factura de verdad es una promesa
-- incumplida en la pantalla de precios — y en este caso, además, un problema
-- tributario para quien le crea.

insert into public.eos_modulos (
  codigo, nombre, descripcion, precio_mensual_pyg, precio_anual_pyg,
  grupo, limite_mensajes, requiere, activo, es_publico, orden
) values (
  'facturacion', 'Factura electrónica',
  'Emisión de documentos electrónicos con SIFEN, sobre las ventas que ya cargaste.',
  0, 0, null, null, '{erp}', true, false, 85
)
on conflict (codigo) do nothing;
