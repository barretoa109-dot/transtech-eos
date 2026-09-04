-- ============================================================
-- v0 · El esquema base que nunca estuvo en el repositorio
-- ============================================================
--
-- QUÉ PASABA
--
-- El 2 de septiembre de 2026 se intentó por primera vez aplicar las 178
-- migraciones sobre una base vacía. Falló en la SEGUNDA:
--
--   ERROR: relation "public.conversaciones" does not exist
--
-- No era una tabla: eran VEINTIOCHO. Y al terminar de escribirlas y probar
-- de nuevo aparecieron VEINTE más, más una vista —clientes, leads,
-- perfiles, eos_notifications, eos_workspace_items (369 filas de datos
-- reales) entre ellas—, encontradas comparando el catálogo completo de
-- producción contra lo que las migraciones realmente crean, no leyendo el
-- código a ojo. Todas creadas a mano en el panel de Supabase antes de que
-- existiera el versionado, y ninguna escrita jamás en una migración.
--
-- Una de las huérfanas encontradas, eos_erp_cuenta_movimientos_v107, NO va
-- en este archivo por un motivo distinto al resto: existía en producción
-- con cero filas y un sufijo más alto que cualquier migración de este
-- repositorio (la última era v106). Mientras se escribía este cambio, otra
-- migración (20260902140000_eos_cuenta_corriente_v107, Fase 7) la formalizó
-- de verdad con su propio `create table if not exists` y su propio esquema
-- completo. Ponerla acá también habría sido un error nuevo: como las dos
-- usan `if not exists`, la que corriera primero ganaría en silencio y la
-- otra se volvería un no-op —exactamente el problema que ya afecta a
-- PRODUCCIÓN hoy, donde la tabla vieja sigue ahí y la migración de Fase 7,
-- si se aplica tal cual, nunca va a crear el esquema nuevo—. Queda anotado
-- en docs/lanzamiento/lista-maestra.md, no es de este cambio resolverlo.
--
-- Las funciones huérfanas (asignar_plan_eos, eos_actualizar_updated_at y
-- otras seis) están en un archivo aparte,
-- 20260812222511_eos_funciones_heredadas_v0.sql, justo antes de la primera
-- migración que las toca: crear funciones no tiene el problema de orden que
-- tienen las tablas, así que no hacía falta forzarlas al principio de todo.
--
-- POR QUÉ IMPORTA MÁS DE LO QUE PARECE
--
-- Producción está sana y lo seguía estando, así que el problema era
-- invisible: las tablas están ahí, las migraciones que las alteran
-- funcionaron siempre. Lo que no existía era la posibilidad de RECONSTRUIR.
--
-- Sin esto no hay entorno de pruebas —cada migración se estrenaba contra los
-- datos de usuarios reales—, no hay instalación desde cero, y el
-- procedimiento de recuperación ante incidentes no podía funcionar aunque
-- estuviera escrito: reaplicar las migraciones sobre una base nueva se
-- cortaba en el segundo archivo.
--
-- DE DÓNDE SALE ESTE ARCHIVO
--
-- Del catálogo de la base de producción: columnas, tipos, defaults, claves e
-- índices leídos de information_schema y pg_catalog, comparados uno por uno
-- contra lo que cada migración crea. No está escrito a mano.
--
-- Las tablas van todas juntas primero, y las restricciones en cuatro pasadas
-- separadas: primarias y únicas, índices únicos, foráneas, y el resto. Sin
-- esto "conversaciones" podía crear su foránea a "usuarios" antes de que
-- "usuarios" tuviera su propia clave, y "solicitudes_pago" podía apuntar a
-- "planes.codigo" antes de que existiera el índice único que lo hace
-- posible —planes.codigo no tiene un UNIQUE formal, sino un índice único—.
--
-- Dos foráneas que apuntan a eos_action_commands —creada por una migración
-- POSTERIOR— no pueden ir acá, porque acá corre antes que todo. Están en
-- 20260811014100_eos_memory_tasks_fk_action_commands_v0.sql, justo después
-- de la migración que crea su destino.
--
-- La vista dashboard_usuario tampoco existía en ninguna migración: se crea
-- al final de este archivo, después de dashboard_resumen, de la que
-- depende.
--
-- Las políticas RLS NO van acá: las crean las migraciones que siguen, que es
-- donde se puede leer por qué cada una dice lo que dice.
--
-- Va con fecha anterior a la primera migración para que corra antes que
-- todo. En producción se marca como aplicada sin ejecutarla (migration
-- repair), porque esas tablas ya están.

-- acciones_activas
create table if not exists public.acciones_activas (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  accion text not null,
  estado text default 'activo'::text not null,
  datos jsonb default '{}'::jsonb,
  created_at timestamp without time zone default now(),
  updated_at timestamp without time zone default now()
);

-- actividad_reciente
create table if not exists public.actividad_reciente (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  titulo text,
  descripcion text,
  created_at timestamp without time zone default now()
);

-- archivos_generados
create table if not exists public.archivos_generados (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  tipo text,
  nombre text,
  url text,
  created_at timestamp without time zone default now(),
  datos jsonb,
  conversacion_id jsonb
);

-- clientes
create table if not exists public.clientes (
  id uuid default gen_random_uuid() not null,
  nombre text,
  empresa text,
  whatsapp text,
  email text,
  fuente text,
  estado text default 'Nuevo'::text,
  plan text default 'Gratis'::text,
  estado_pago text default 'Pendiente'::text,
  mensajes_consumidos integer default 0,
  fecha_registro timestamp without time zone default now(),
  ultimo_contacto timestamp without time zone default now()
);

-- contexto_usuario
create table if not exists public.contexto_usuario (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  categoria text,
  contenido text,
  importancia integer default 1,
  created_at timestamp without time zone default now()
);

-- conversaciones
create table if not exists public.conversaciones (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  mensaje text,
  respuesta text,
  created_at timestamp without time zone default now(),
  titulo text,
  proyecto_id uuid
);

-- dashboard_ia
create table if not exists public.dashboard_ia (
  id uuid default gen_random_uuid() not null,
  usuario_id text,
  nivel text,
  riesgo text,
  recomendacion text,
  puntuacion integer,
  created_at timestamp without time zone default now()
);

-- dashboard_resumen
create table if not exists public.dashboard_resumen (
  id uuid default gen_random_uuid() not null,
  usuario_id text,
  objetivos_activos integer default 0,
  tareas_pendientes integer default 0,
  diagnosticos_realizados integer default 0,
  progreso_promedio integer default 0,
  puntuacion_eos integer default 50,
  updated_at timestamp without time zone default now()
);

-- diagnosticos
create table if not exists public.diagnosticos (
  id uuid default gen_random_uuid() not null,
  usuario_id text not null,
  puntuacion integer default 0,
  resumen text,
  acciones text,
  created_at timestamp with time zone default now()
);

-- documentos_generados
create table if not exists public.documentos_generados (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  tipo text,
  contenido text,
  created_at timestamp without time zone default now()
);

-- eos_actions
create table if not exists public.eos_actions (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  proyecto_id uuid,
  titulo text not null,
  descripcion text,
  tipo text default 'tarea'::text,
  prioridad text default 'media'::text,
  estado text default 'pendiente'::text,
  fecha_limite timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- eos_activity
create table if not exists public.eos_activity (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  conversacion_id uuid,
  proyecto_id uuid,
  tipo text default 'evento'::text,
  titulo text not null,
  descripcion text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

-- eos_contexto
create table if not exists public.eos_contexto (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  negocio text,
  rubro text,
  objetivo_principal text,
  problema_principal text,
  diagnostico_actual text,
  acciones_recomendadas text,
  ultimo_resumen text,
  progreso integer default 0,
  updated_at timestamp without time zone default now()
);

-- eos_daily_briefings
create table if not exists public.eos_daily_briefings (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  tipo_usuario text,
  saludo text,
  resumen text,
  prioridad_1 text,
  prioridad_2 text,
  prioridad_3 text,
  recomendacion_principal text,
  score integer default 0,
  created_at timestamp with time zone default now(),
  briefing_date date,
  estado text default 'listo'::text not null,
  titulo_dia text,
  enfoque_dia text,
  logros jsonb default '[]'::jsonb not null,
  riesgos jsonb default '[]'::jsonb not null,
  proximos_pasos jsonb default '[]'::jsonb not null,
  fuentes jsonb default '{}'::jsonb not null,
  modelo_version text default 'briefing-v5'::text not null,
  generated_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- eos_dashboard_metrics
create table if not exists public.eos_dashboard_metrics (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  metric_key text not null,
  metric_label text not null,
  metric_value text,
  metric_number numeric,
  metadata jsonb default '{}'::jsonb,
  updated_at timestamp with time zone default now()
);

-- eos_documents
create table if not exists public.eos_documents (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  tipo_documento text,
  plantilla text,
  nombre_archivo text,
  url_archivo text,
  contexto text,
  estado text default 'generado'::text,
  created_at timestamp with time zone default now()
);

-- eos_finance_records
create table if not exists public.eos_finance_records (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  tipo_usuario text default 'indefinido'::text,
  tipo_movimiento text,
  categoria text,
  descripcion text,
  monto numeric default 0,
  moneda text default 'PYG'::text,
  fecha date default CURRENT_DATE,
  created_at timestamp with time zone default now()
);

-- eos_goals
create table if not exists public.eos_goals (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  proyecto_id uuid,
  titulo text not null,
  descripcion text,
  progreso integer default 0 not null,
  estado text default 'activo'::text not null,
  created_at timestamp with time zone default now(),
  tipo_medicion text default 'porcentaje'::text not null,
  valor_inicial numeric(18,4),
  valor_actual numeric(18,4),
  valor_objetivo numeric(18,4),
  unidad text,
  prioridad smallint default 3 not null,
  criterio_exito text,
  proximo_paso text,
  fecha_inicio date default ((now() AT TIME ZONE 'America/Asuncion'::text))::date not null,
  fecha_limite date,
  request_id uuid,
  conversacion_id uuid,
  mensaje_id uuid,
  progreso_confianza numeric(4,3) default 1.000 not null,
  ultima_actualizacion_at timestamp with time zone default now() not null,
  completado_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  metadata jsonb default '{}'::jsonb not null
);

-- eos_historial
create table if not exists public.eos_historial (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  rol text not null,
  mensaje text not null,
  created_at timestamp without time zone default now()
);

-- eos_intelligence
create table if not exists public.eos_intelligence (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  tipo_usuario text,
  area_detectada text,
  prioridad text,
  diagnostico text,
  recomendacion text,
  accion_sugerida text,
  score integer default 0,
  estado text default 'activo'::text,
  created_at timestamp with time zone default now(),
  conversacion_id jsonb
);

-- eos_kpis
create table if not exists public.eos_kpis (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  nombre text not null,
  valor_actual numeric default 0,
  meta numeric default 0,
  unidad text,
  created_at timestamp with time zone default now()
);

-- eos_memory
create table if not exists public.eos_memory (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  categoria text default 'general'::text,
  titulo text not null,
  contenido text,
  importancia integer default 5,
  origen text default 'chat'::text,
  estado text default 'activo'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  clave text,
  entidad text,
  valor jsonb default '{}'::jsonb not null,
  confianza numeric(4,3) default 0.800 not null,
  confirmada boolean default false not null,
  conversacion_id uuid,
  mensaje_id uuid,
  metadata jsonb default '{}'::jsonb not null,
  ultima_observacion_at timestamp with time zone default now() not null,
  observaciones integer default 1 not null,
  action_command_id uuid
);

-- eos_notifications
create table if not exists public.eos_notifications (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  titulo text not null,
  mensaje text,
  tipo text default 'info'::text,
  leido boolean default false,
  created_at timestamp with time zone default now()
);

-- eos_profiles
create table if not exists public.eos_profiles (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  tipo_usuario text default 'indefinido'::text,
  nombre_visible text,
  rubro text,
  etapa_actual text default 'inicial'::text,
  score_general integer default 0,
  prioridad_actual text,
  resumen_actual text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- eos_projects
create table if not exists public.eos_projects (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  nombre text not null,
  tipo text default 'general'::text,
  descripcion text,
  estado text default 'activo'::text,
  progreso integer default 0,
  prioridad text default 'media'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  icono jsonb,
  favorito jsonb
);

-- eos_tasks
create table if not exists public.eos_tasks (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  proyecto_id uuid,
  titulo text,
  descripcion text,
  estado text default 'pendiente'::text,
  prioridad integer default 3,
  fecha_limite timestamp with time zone,
  created_at timestamp with time zone default now(),
  action_command_id uuid
);

-- eos_tendencias
create table if not exists public.eos_tendencias (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  score_actual integer,
  score_anterior integer,
  diferencia integer,
  tendencia text,
  created_at timestamp without time zone default now()
);

-- eos_workspace_items
create table if not exists public.eos_workspace_items (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  proyecto_id uuid,
  conversacion_id uuid,
  tipo text default 'documento'::text,
  titulo text not null,
  descripcion text,
  url text,
  metadata jsonb default '{}'::jsonb,
  estado text default 'activo'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- eventos_pago
create table if not exists public.eventos_pago (
  id uuid default gen_random_uuid() not null,
  proveedor text not null,
  evento_externo_id text not null,
  tipo text,
  solicitud_pago_id uuid,
  payload jsonb default '{}'::jsonb not null,
  procesado boolean default false not null,
  error text,
  created_at timestamp with time zone default now() not null,
  procesado_at timestamp with time zone
);

-- funciones_eos
create table if not exists public.funciones_eos (
  id uuid default gen_random_uuid() not null,
  codigo text not null,
  nombre text not null,
  descripcion text,
  categoria text default 'general'::text not null,
  activo boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- historial_pagos
create table if not exists public.historial_pagos (
  id uuid default gen_random_uuid() not null,
  solicitud_pago_id uuid not null,
  usuario_id uuid not null,
  plan_codigo text not null,
  periodicidad text not null,
  monto bigint not null,
  moneda text default 'PYG'::text not null,
  proveedor text not null,
  referencia_externa text,
  estado text not null,
  pagado_at timestamp with time zone,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

-- leads
create table if not exists public.leads (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  whatsapp text,
  empresa text,
  problema text,
  plan text default 'Gratis'::text,
  estado text default 'Nuevo'::text,
  created_at timestamp without time zone default now()
);

-- memorias
create table if not exists public.memorias (
  id uuid default gen_random_uuid() not null,
  usuario_id text not null,
  contenido text not null,
  created_at timestamp with time zone default now()
);

-- mensajes
create table if not exists public.mensajes (
  id uuid default gen_random_uuid() not null,
  conversacion_id uuid,
  rol text,
  texto text,
  created_at timestamp without time zone default now(),
  usuario_id uuid not null,
  request_id uuid,
  origen text default 'eos-web'::text not null,
  metadata jsonb default '{}'::jsonb not null
);

-- notificaciones
create table if not exists public.notificaciones (
  id uuid default gen_random_uuid() not null,
  usuario_id text,
  mensaje text,
  enviada boolean default false,
  created_at timestamp without time zone default now(),
  titulo text,
  leida boolean default false
);

-- objetivos
create table if not exists public.objetivos (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  titulo text,
  descripcion text,
  progreso integer default 0,
  created_at timestamp without time zone default now(),
  estado text default 'activo'::text
);

-- perfiles
create table if not exists public.perfiles (
  id uuid not null,
  nombre text,
  apellido text,
  whatsapp text,
  empresa text,
  plan text default 'free'::text,
  created_at timestamp with time zone default now()
);

-- permisos_plan
create table if not exists public.permisos_plan (
  id uuid default gen_random_uuid() not null,
  plan_id uuid not null,
  funcion_id uuid not null,
  habilitado boolean default true not null,
  configuracion jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- planes
create table if not exists public.planes (
  id uuid default gen_random_uuid() not null,
  nombre text,
  precio text,
  descripcion text,
  created_at timestamp with time zone default now(),
  codigo text not null,
  precio_mensual_pyg bigint default 0,
  precio_anual_pyg bigint default 0,
  precio_mensual_usd numeric(10,2) default 0,
  precio_anual_usd numeric(10,2) default 0,
  limite_mensajes integer,
  limite_excel integer,
  limite_pdf integer,
  limite_automatizaciones integer,
  limite_usuarios integer default 1,
  memoria_dias integer,
  prioridad integer default 0,
  es_publico boolean default true,
  activo boolean default true,
  orden integer default 0,
  updated_at timestamp with time zone default now()
);

-- recomendaciones
create table if not exists public.recomendaciones (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  score_actual integer,
  recomendacion text,
  prioridad text,
  created_at timestamp without time zone default now()
);

-- score_historico
create table if not exists public.score_historico (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid,
  score integer,
  created_at timestamp without time zone default now()
);

-- score_usuario
create table if not exists public.score_usuario (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  score integer default 0,
  nivel integer default 1,
  created_at timestamp without time zone default now()
);

-- seguimientos
create table if not exists public.seguimientos (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  objetivo_id uuid,
  mensaje text,
  estado text default 'pendiente'::text,
  created_at timestamp without time zone default now()
);

-- solicitudes_pago
create table if not exists public.solicitudes_pago (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  plan_codigo text not null,
  periodicidad text not null,
  moneda text default 'PYG'::text not null,
  monto bigint not null,
  proveedor text default 'pagopar'::text not null,
  estado text default 'pendiente'::text not null,
  referencia_interna text not null,
  referencia_externa text,
  checkout_url text,
  pagado_at timestamp with time zone,
  vencimiento_pago timestamp with time zone,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- tareas
create table if not exists public.tareas (
  id uuid default gen_random_uuid() not null,
  usuario_id text,
  titulo text,
  completada boolean default false,
  created_at timestamp without time zone default now(),
  objetivo_id uuid
);

-- uso_mensual
create table if not exists public.uso_mensual (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  periodo text not null,
  mensajes_usados integer default 0 not null,
  excel_generados integer default 0 not null,
  pdf_generados integer default 0 not null,
  automatizaciones_ejecutadas integer default 0 not null,
  tokens_entrada bigint default 0 not null,
  tokens_salida bigint default 0 not null,
  costo_estimado_usd numeric(14,6) default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- usuarios
create table if not exists public.usuarios (
  id uuid default gen_random_uuid() not null,
  nombre text,
  email text,
  whatsapp text,
  plan text default 'free'::text,
  created_at timestamp without time zone default now(),
  estado_suscripcion text default 'active'::text,
  plan_inicio timestamp with time zone default now(),
  plan_vencimiento timestamp with time zone,
  proveedor_pago text default 'manual'::text,
  ultimo_pago timestamp with time zone,
  cancelar_al_vencimiento boolean default false,
  metadata_suscripcion jsonb default '{}'::jsonb,
  updated_at timestamp with time zone default now()
);

-- ============================================================
-- Y recién ahora las restricciones, en el orden que hace falta.
-- ============================================================

-- claves primarias y únicas

alter table public.acciones_activas drop constraint if exists acciones_activas_pkey;
alter table public.acciones_activas add constraint acciones_activas_pkey PRIMARY KEY (id);
alter table public.actividad_reciente drop constraint if exists actividad_reciente_pkey;
alter table public.actividad_reciente add constraint actividad_reciente_pkey PRIMARY KEY (id);
alter table public.archivos_generados drop constraint if exists archivos_generados_pkey;
alter table public.archivos_generados add constraint archivos_generados_pkey PRIMARY KEY (id);
alter table public.clientes drop constraint if exists clientes_pkey;
alter table public.clientes add constraint clientes_pkey PRIMARY KEY (id);
alter table public.contexto_usuario drop constraint if exists contexto_usuario_pkey;
alter table public.contexto_usuario add constraint contexto_usuario_pkey PRIMARY KEY (id);
alter table public.conversaciones drop constraint if exists conversaciones_pkey;
alter table public.conversaciones add constraint conversaciones_pkey PRIMARY KEY (id);
alter table public.dashboard_ia drop constraint if exists dashboard_ia_pkey;
alter table public.dashboard_ia add constraint dashboard_ia_pkey PRIMARY KEY (id);
alter table public.dashboard_resumen drop constraint if exists dashboard_resumen_pkey;
alter table public.dashboard_resumen add constraint dashboard_resumen_pkey PRIMARY KEY (id);
alter table public.diagnosticos drop constraint if exists diagnosticos_pkey;
alter table public.diagnosticos add constraint diagnosticos_pkey PRIMARY KEY (id);
alter table public.documentos_generados drop constraint if exists documentos_generados_pkey;
alter table public.documentos_generados add constraint documentos_generados_pkey PRIMARY KEY (id);
alter table public.eos_actions drop constraint if exists eos_actions_pkey;
alter table public.eos_actions add constraint eos_actions_pkey PRIMARY KEY (id);
alter table public.eos_activity drop constraint if exists eos_activity_pkey;
alter table public.eos_activity add constraint eos_activity_pkey PRIMARY KEY (id);
alter table public.eos_contexto drop constraint if exists eos_contexto_user_id_unique;
alter table public.eos_contexto add constraint eos_contexto_user_id_unique UNIQUE (user_id);
alter table public.eos_contexto drop constraint if exists eos_contexto_pkey;
alter table public.eos_contexto add constraint eos_contexto_pkey PRIMARY KEY (id);
alter table public.eos_daily_briefings drop constraint if exists eos_daily_briefings_pkey;
alter table public.eos_daily_briefings add constraint eos_daily_briefings_pkey PRIMARY KEY (id);
alter table public.eos_dashboard_metrics drop constraint if exists eos_dashboard_metrics_usuario_id_metric_key_key;
alter table public.eos_dashboard_metrics add constraint eos_dashboard_metrics_usuario_id_metric_key_key UNIQUE (usuario_id, metric_key);
alter table public.eos_dashboard_metrics drop constraint if exists eos_dashboard_metrics_pkey;
alter table public.eos_dashboard_metrics add constraint eos_dashboard_metrics_pkey PRIMARY KEY (id);
alter table public.eos_documents drop constraint if exists eos_documents_pkey;
alter table public.eos_documents add constraint eos_documents_pkey PRIMARY KEY (id);
alter table public.eos_finance_records drop constraint if exists eos_finance_records_pkey;
alter table public.eos_finance_records add constraint eos_finance_records_pkey PRIMARY KEY (id);
alter table public.eos_goals drop constraint if exists eos_goals_pkey;
alter table public.eos_goals add constraint eos_goals_pkey PRIMARY KEY (id);
alter table public.eos_historial drop constraint if exists eos_historial_pkey;
alter table public.eos_historial add constraint eos_historial_pkey PRIMARY KEY (id);
alter table public.eos_intelligence drop constraint if exists eos_intelligence_pkey;
alter table public.eos_intelligence add constraint eos_intelligence_pkey PRIMARY KEY (id);
alter table public.eos_kpis drop constraint if exists eos_kpis_pkey;
alter table public.eos_kpis add constraint eos_kpis_pkey PRIMARY KEY (id);
alter table public.eos_memory drop constraint if exists eos_memory_pkey;
alter table public.eos_memory add constraint eos_memory_pkey PRIMARY KEY (id);
alter table public.eos_notifications drop constraint if exists eos_notifications_pkey;
alter table public.eos_notifications add constraint eos_notifications_pkey PRIMARY KEY (id);
alter table public.eos_profiles drop constraint if exists eos_profiles_pkey;
alter table public.eos_profiles add constraint eos_profiles_pkey PRIMARY KEY (id);
alter table public.eos_projects drop constraint if exists eos_projects_pkey;
alter table public.eos_projects add constraint eos_projects_pkey PRIMARY KEY (id);
alter table public.eos_tasks drop constraint if exists eos_tasks_pkey;
alter table public.eos_tasks add constraint eos_tasks_pkey PRIMARY KEY (id);
alter table public.eos_tendencias drop constraint if exists eos_tendencias_pkey;
alter table public.eos_tendencias add constraint eos_tendencias_pkey PRIMARY KEY (id);
alter table public.eos_workspace_items drop constraint if exists eos_workspace_items_pkey;
alter table public.eos_workspace_items add constraint eos_workspace_items_pkey PRIMARY KEY (id);
alter table public.eventos_pago drop constraint if exists eventos_pago_proveedor_evento_externo_id_key;
alter table public.eventos_pago add constraint eventos_pago_proveedor_evento_externo_id_key UNIQUE (proveedor, evento_externo_id);
alter table public.eventos_pago drop constraint if exists eventos_pago_pkey;
alter table public.eventos_pago add constraint eventos_pago_pkey PRIMARY KEY (id);
alter table public.funciones_eos drop constraint if exists funciones_eos_codigo_key;
alter table public.funciones_eos add constraint funciones_eos_codigo_key UNIQUE (codigo);
alter table public.funciones_eos drop constraint if exists funciones_eos_pkey;
alter table public.funciones_eos add constraint funciones_eos_pkey PRIMARY KEY (id);
alter table public.historial_pagos drop constraint if exists historial_pagos_proveedor_referencia_externa_key;
alter table public.historial_pagos add constraint historial_pagos_proveedor_referencia_externa_key UNIQUE (proveedor, referencia_externa);
alter table public.historial_pagos drop constraint if exists historial_pagos_pkey;
alter table public.historial_pagos add constraint historial_pagos_pkey PRIMARY KEY (id);
alter table public.leads drop constraint if exists leads_pkey;
alter table public.leads add constraint leads_pkey PRIMARY KEY (id);
alter table public.memorias drop constraint if exists memorias_pkey;
alter table public.memorias add constraint memorias_pkey PRIMARY KEY (id);
alter table public.mensajes drop constraint if exists mensajes_pkey;
alter table public.mensajes add constraint mensajes_pkey PRIMARY KEY (id);
alter table public.notificaciones drop constraint if exists notificaciones_pkey;
alter table public.notificaciones add constraint notificaciones_pkey PRIMARY KEY (id);
alter table public.objetivos drop constraint if exists objetivos_pkey;
alter table public.objetivos add constraint objetivos_pkey PRIMARY KEY (id);
alter table public.perfiles drop constraint if exists perfiles_pkey;
alter table public.perfiles add constraint perfiles_pkey PRIMARY KEY (id);
alter table public.permisos_plan drop constraint if exists permisos_plan_plan_funcion_unique;
alter table public.permisos_plan add constraint permisos_plan_plan_funcion_unique UNIQUE (plan_id, funcion_id);
alter table public.permisos_plan drop constraint if exists permisos_plan_pkey;
alter table public.permisos_plan add constraint permisos_plan_pkey PRIMARY KEY (id);
alter table public.planes drop constraint if exists planes_pkey;
alter table public.planes add constraint planes_pkey PRIMARY KEY (id);
alter table public.recomendaciones drop constraint if exists recomendaciones_pkey;
alter table public.recomendaciones add constraint recomendaciones_pkey PRIMARY KEY (id);
alter table public.score_historico drop constraint if exists score_historico_pkey;
alter table public.score_historico add constraint score_historico_pkey PRIMARY KEY (id);
alter table public.score_usuario drop constraint if exists score_usuario_pkey;
alter table public.score_usuario add constraint score_usuario_pkey PRIMARY KEY (id);
alter table public.seguimientos drop constraint if exists seguimientos_pkey;
alter table public.seguimientos add constraint seguimientos_pkey PRIMARY KEY (id);
alter table public.solicitudes_pago drop constraint if exists solicitudes_pago_referencia_externa_key;
alter table public.solicitudes_pago add constraint solicitudes_pago_referencia_externa_key UNIQUE (referencia_externa);
alter table public.solicitudes_pago drop constraint if exists solicitudes_pago_referencia_interna_key;
alter table public.solicitudes_pago add constraint solicitudes_pago_referencia_interna_key UNIQUE (referencia_interna);
alter table public.solicitudes_pago drop constraint if exists solicitudes_pago_pkey;
alter table public.solicitudes_pago add constraint solicitudes_pago_pkey PRIMARY KEY (id);
alter table public.tareas drop constraint if exists tareas_pkey;
alter table public.tareas add constraint tareas_pkey PRIMARY KEY (id);
alter table public.uso_mensual drop constraint if exists uso_mensual_usuario_periodo_unique;
alter table public.uso_mensual add constraint uso_mensual_usuario_periodo_unique UNIQUE (usuario_id, periodo);
alter table public.uso_mensual drop constraint if exists uso_mensual_pkey;
alter table public.uso_mensual add constraint uso_mensual_pkey PRIMARY KEY (id);
alter table public.usuarios drop constraint if exists usuarios_pkey;
alter table public.usuarios add constraint usuarios_pkey PRIMARY KEY (id);

-- índices únicos (posible destino de una foránea)

create UNIQUE index if not exists eos_daily_briefings_user_date_uidx ON public.eos_daily_briefings USING btree (usuario_id, briefing_date) WHERE (briefing_date IS NOT NULL);
create UNIQUE index if not exists eos_goals_usuario_request_unique_idx ON public.eos_goals USING btree (usuario_id, request_id) WHERE (request_id IS NOT NULL);
create UNIQUE index if not exists eos_memory_action_command_uidx ON public.eos_memory USING btree (action_command_id) WHERE (action_command_id IS NOT NULL);
create UNIQUE index if not exists eos_memory_usuario_clave_unique_idx ON public.eos_memory USING btree (usuario_id, clave) WHERE (clave IS NOT NULL);
create UNIQUE index if not exists eos_tasks_action_command_uidx ON public.eos_tasks USING btree (action_command_id) WHERE (action_command_id IS NOT NULL);
create UNIQUE index if not exists mensajes_request_role_unique_idx ON public.mensajes USING btree (usuario_id, request_id, rol) WHERE (request_id IS NOT NULL);
create UNIQUE index if not exists idx_planes_codigo_unico ON public.planes USING btree (codigo);

-- claves foráneas

alter table public.conversaciones drop constraint if exists conversaciones_usuario_id_fkey;
alter table public.conversaciones add constraint conversaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.eos_daily_briefings drop constraint if exists eos_daily_briefings_usuario_id_fkey;
alter table public.eos_daily_briefings add constraint eos_daily_briefings_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public.eos_goals drop constraint if exists eos_goals_conversacion_id_fkey;
alter table public.eos_goals add constraint eos_goals_conversacion_id_fkey FOREIGN KEY (conversacion_id) REFERENCES conversaciones(id) ON DELETE SET NULL;
alter table public.eos_goals drop constraint if exists eos_goals_mensaje_id_fkey;
alter table public.eos_goals add constraint eos_goals_mensaje_id_fkey FOREIGN KEY (mensaje_id) REFERENCES mensajes(id) ON DELETE SET NULL;
alter table public.eos_goals drop constraint if exists eos_goals_usuario_id_fkey;
alter table public.eos_goals add constraint eos_goals_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public.eos_kpis drop constraint if exists eos_kpis_usuario_id_fkey;
alter table public.eos_kpis add constraint eos_kpis_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public.eos_memory drop constraint if exists eos_memory_conversacion_id_fkey;
alter table public.eos_memory add constraint eos_memory_conversacion_id_fkey FOREIGN KEY (conversacion_id) REFERENCES conversaciones(id) ON DELETE SET NULL;
alter table public.eos_memory drop constraint if exists eos_memory_mensaje_id_fkey;
alter table public.eos_memory add constraint eos_memory_mensaje_id_fkey FOREIGN KEY (mensaje_id) REFERENCES mensajes(id) ON DELETE SET NULL;
alter table public.eos_memory drop constraint if exists eos_memory_usuario_id_fkey;
alter table public.eos_memory add constraint eos_memory_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public.eventos_pago drop constraint if exists eventos_pago_solicitud_pago_id_fkey;
alter table public.eventos_pago add constraint eventos_pago_solicitud_pago_id_fkey FOREIGN KEY (solicitud_pago_id) REFERENCES solicitudes_pago(id) ON DELETE SET NULL;
alter table public.historial_pagos drop constraint if exists historial_pagos_solicitud_pago_id_fkey;
alter table public.historial_pagos add constraint historial_pagos_solicitud_pago_id_fkey FOREIGN KEY (solicitud_pago_id) REFERENCES solicitudes_pago(id) ON DELETE RESTRICT;
alter table public.historial_pagos drop constraint if exists historial_pagos_usuario_id_fkey;
alter table public.historial_pagos add constraint historial_pagos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.mensajes drop constraint if exists mensajes_conversacion_id_fkey;
alter table public.mensajes add constraint mensajes_conversacion_id_fkey FOREIGN KEY (conversacion_id) REFERENCES conversaciones(id) ON DELETE CASCADE;
alter table public.mensajes drop constraint if exists mensajes_usuario_id_fkey;
alter table public.mensajes add constraint mensajes_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public.objetivos drop constraint if exists objetivos_usuario_id_fkey;
alter table public.objetivos add constraint objetivos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.perfiles drop constraint if exists perfiles_id_fkey;
alter table public.perfiles add constraint perfiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.permisos_plan drop constraint if exists permisos_plan_funcion_id_fkey;
alter table public.permisos_plan add constraint permisos_plan_funcion_id_fkey FOREIGN KEY (funcion_id) REFERENCES funciones_eos(id) ON DELETE CASCADE;
alter table public.permisos_plan drop constraint if exists permisos_plan_plan_id_fkey;
alter table public.permisos_plan add constraint permisos_plan_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE CASCADE;
alter table public.solicitudes_pago drop constraint if exists solicitudes_pago_plan_codigo_fkey;
alter table public.solicitudes_pago add constraint solicitudes_pago_plan_codigo_fkey FOREIGN KEY (plan_codigo) REFERENCES planes(codigo);
alter table public.solicitudes_pago drop constraint if exists solicitudes_pago_usuario_id_fkey;
alter table public.solicitudes_pago add constraint solicitudes_pago_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.uso_mensual drop constraint if exists uso_mensual_usuario_id_fkey;
alter table public.uso_mensual add constraint uso_mensual_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

-- otras restricciones

alter table public.eos_daily_briefings drop constraint if exists eos_daily_briefings_estado_check;
alter table public.eos_daily_briefings add constraint eos_daily_briefings_estado_check CHECK ((estado = ANY (ARRAY['generando'::text, 'listo'::text, 'error'::text])));
alter table public.eos_daily_briefings drop constraint if exists eos_daily_briefings_json_arrays_check;
alter table public.eos_daily_briefings add constraint eos_daily_briefings_json_arrays_check CHECK (((jsonb_typeof(logros) = 'array'::text) AND (jsonb_typeof(riesgos) = 'array'::text) AND (jsonb_typeof(proximos_pasos) = 'array'::text)));
alter table public.eos_daily_briefings drop constraint if exists eos_daily_briefings_score_check;
alter table public.eos_daily_briefings add constraint eos_daily_briefings_score_check CHECK (((score IS NULL) OR ((score >= 0) AND (score <= 100))));
alter table public.eos_goals drop constraint if exists eos_goals_estado_check;
alter table public.eos_goals add constraint eos_goals_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'activo'::text, 'pausado'::text, 'completado'::text, 'cancelado'::text])));
alter table public.eos_goals drop constraint if exists eos_goals_fechas_check;
alter table public.eos_goals add constraint eos_goals_fechas_check CHECK (((fecha_limite IS NULL) OR (fecha_limite >= fecha_inicio)));
alter table public.eos_goals drop constraint if exists eos_goals_prioridad_check;
alter table public.eos_goals add constraint eos_goals_prioridad_check CHECK (((prioridad >= 1) AND (prioridad <= 5)));
alter table public.eos_goals drop constraint if exists eos_goals_progreso_check;
alter table public.eos_goals add constraint eos_goals_progreso_check CHECK (((progreso >= 0) AND (progreso <= 100)));
alter table public.eos_goals drop constraint if exists eos_goals_progreso_confianza_check;
alter table public.eos_goals add constraint eos_goals_progreso_confianza_check CHECK (((progreso_confianza >= (0)::numeric) AND (progreso_confianza <= (1)::numeric)));
alter table public.eos_goals drop constraint if exists eos_goals_tipo_medicion_check;
alter table public.eos_goals add constraint eos_goals_tipo_medicion_check CHECK ((tipo_medicion = ANY (ARRAY['porcentaje'::text, 'numerico'::text, 'monetario'::text, 'hitos'::text])));
alter table public.eos_memory drop constraint if exists eos_memory_confianza_check;
alter table public.eos_memory add constraint eos_memory_confianza_check CHECK (((confianza >= (0)::numeric) AND (confianza <= (1)::numeric)));
alter table public.eos_memory drop constraint if exists eos_memory_observaciones_check;
alter table public.eos_memory add constraint eos_memory_observaciones_check CHECK ((observaciones >= 1));
alter table public.solicitudes_pago drop constraint if exists solicitudes_pago_estado_check;
alter table public.solicitudes_pago add constraint solicitudes_pago_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'procesando'::text, 'pendiente_transferencia'::text, 'en_revision'::text, 'pagado'::text, 'rechazado'::text, 'cancelado'::text, 'vencido'::text, 'reembolsado'::text, 'reversado'::text])));
alter table public.solicitudes_pago drop constraint if exists solicitudes_pago_monto_check;
alter table public.solicitudes_pago add constraint solicitudes_pago_monto_check CHECK ((monto >= 0));
alter table public.solicitudes_pago drop constraint if exists solicitudes_pago_periodicidad_check;
alter table public.solicitudes_pago add constraint solicitudes_pago_periodicidad_check CHECK ((periodicidad = ANY (ARRAY['mensual'::text, 'anual'::text])));
alter table public.solicitudes_pago drop constraint if exists solicitudes_pago_proveedor_check;
alter table public.solicitudes_pago add constraint solicitudes_pago_proveedor_check CHECK ((proveedor = ANY (ARRAY['pagopar'::text, 'transferencia'::text, 'bancard'::text])));

-- índices normales

create index if not exists actividad_reciente_usuario_created_idx_v17 ON public.actividad_reciente USING btree (usuario_id, created_at DESC);
create index if not exists conversaciones_usuario_created_idx ON public.conversaciones USING btree (usuario_id, created_at DESC);
create index if not exists dashboard_ia_usuario_created_idx_v17 ON public.dashboard_ia USING btree (usuario_id, created_at DESC);
create index if not exists dashboard_resumen_usuario_idx_v16 ON public.dashboard_resumen USING btree (usuario_id);
create index if not exists eos_contexto_user_updated_idx ON public.eos_contexto USING btree (user_id, updated_at DESC);
create index if not exists eos_daily_briefings_user_created_idx ON public.eos_daily_briefings USING btree (usuario_id, created_at DESC);
create index if not exists eos_goals_conversacion_idx ON public.eos_goals USING btree (conversacion_id) WHERE (conversacion_id IS NOT NULL);
create index if not exists eos_goals_mensaje_idx ON public.eos_goals USING btree (mensaje_id) WHERE (mensaje_id IS NOT NULL);
create index if not exists eos_goals_proyecto_idx ON public.eos_goals USING btree (proyecto_id) WHERE (proyecto_id IS NOT NULL);
create index if not exists eos_goals_usuario_estado_updated_idx ON public.eos_goals USING btree (usuario_id, estado, updated_at DESC);
create index if not exists eos_goals_usuario_fecha_limite_idx ON public.eos_goals USING btree (usuario_id, fecha_limite) WHERE (estado = ANY (ARRAY['activo'::text, 'pausado'::text]));
create index if not exists eos_kpis_usuario_created_idx_v19 ON public.eos_kpis USING btree (usuario_id, created_at DESC);
create index if not exists eos_memory_contexto_idx ON public.eos_memory USING btree (usuario_id, estado, importancia DESC, updated_at DESC);
create index if not exists eos_memory_conversacion_idx ON public.eos_memory USING btree (conversacion_id) WHERE (conversacion_id IS NOT NULL);
create index if not exists eos_memory_mensaje_idx ON public.eos_memory USING btree (mensaje_id) WHERE (mensaje_id IS NOT NULL);
create index if not exists eos_tendencias_usuario_created_idx_v19 ON public.eos_tendencias USING btree (usuario_id, created_at DESC);
create index if not exists eventos_pago_solicitud_pago_id_idx ON public.eventos_pago USING btree (solicitud_pago_id);
create index if not exists idx_funciones_eos_activo ON public.funciones_eos USING btree (activo);
create index if not exists idx_funciones_eos_categoria ON public.funciones_eos USING btree (categoria);
create index if not exists historial_pagos_solicitud_pago_id_idx ON public.historial_pagos USING btree (solicitud_pago_id);
create index if not exists historial_pagos_usuario_id_idx ON public.historial_pagos USING btree (usuario_id);
create index if not exists mensajes_conversacion_created_idx ON public.mensajes USING btree (conversacion_id, created_at);
create index if not exists mensajes_usuario_created_idx ON public.mensajes USING btree (usuario_id, created_at DESC) WHERE (usuario_id IS NOT NULL);
create index if not exists notificaciones_usuario_created_idx_v19 ON public.notificaciones USING btree (usuario_id, created_at DESC);
create index if not exists objetivos_usuario_id_idx ON public.objetivos USING btree (usuario_id);
create index if not exists idx_permisos_plan_funcion ON public.permisos_plan USING btree (funcion_id);
create index if not exists idx_permisos_plan_habilitado ON public.permisos_plan USING btree (habilitado);
create index if not exists idx_permisos_plan_plan ON public.permisos_plan USING btree (plan_id);
create index if not exists idx_planes_activo_publico ON public.planes USING btree (activo, es_publico);
create index if not exists recomendaciones_usuario_created_idx_v19 ON public.recomendaciones USING btree (usuario_id, created_at DESC);
create index if not exists score_historico_usuario_created_idx_v19 ON public.score_historico USING btree (usuario_id, created_at DESC);
create index if not exists seguimientos_usuario_created_idx_v17 ON public.seguimientos USING btree (usuario_id, created_at DESC);
create index if not exists solicitudes_pago_estado_idx ON public.solicitudes_pago USING btree (estado);
create index if not exists solicitudes_pago_plan_codigo_idx ON public.solicitudes_pago USING btree (plan_codigo);
create index if not exists solicitudes_pago_usuario_idx ON public.solicitudes_pago USING btree (usuario_id, created_at DESC);
create index if not exists tareas_usuario_created_idx_v18 ON public.tareas USING btree (usuario_id, created_at DESC);
create index if not exists idx_uso_mensual_periodo ON public.uso_mensual USING btree (periodo);
create index if not exists idx_uso_mensual_usuario ON public.uso_mensual USING btree (usuario_id);
create index if not exists idx_usuarios_estado_suscripcion ON public.usuarios USING btree (estado_suscripcion);
create index if not exists idx_usuarios_plan ON public.usuarios USING btree (plan);


-- ============================================================
-- La vista que tampoco creaba ninguna migración
-- ============================================================

create or replace view public.dashboard_usuario as
 SELECT usuario_id,
    objetivos_activos,
    tareas_pendientes,
    progreso_promedio,
    puntuacion_eos
   FROM dashboard_resumen;

