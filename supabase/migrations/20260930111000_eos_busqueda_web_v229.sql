-- v229: búsqueda web de EOS — métricas por búsqueda y caché de consultas públicas.
--
-- EOS investiga en la web cuando la persona pide datos actuales (precios,
-- tendencias, competidores). La búsqueda la hace el servidor con la herramienta
-- `web_search` de la Responses API de OpenAI (lib/busqueda/investigar.ts), con
-- una consulta pública ya limpiada de datos privados.
--
-- 1) `eos_busquedas_web_v229`: una fila por búsqueda, para el límite diario
--    por persona y las métricas (éxito, latencia, costo, proveedor, error).
--    NO guarda la consulta: solo su hash, para contar repetidas.
--
-- 2) `eos_busquedas_cache_v229`: el resultado de una consulta PÚBLICA, por
--    clave (hash de consulta + país + profundidad), con vencimiento. Se
--    comparte entre cuentas a propósito: la consulta ya no lleva nada de
--    nadie (nombres, montos, teléfonos se sacan antes), así que dos personas
--    que preguntan "precio del cemento en Paraguay" reciben lo mismo sin
--    pagarlo dos veces. Nada personalizado entra acá.
--
-- Solo service_role: anon y authenticated no leen ni escriben ninguna de las dos.
-- Rollback: drop de las dos tablas.

create table if not exists public.eos_busquedas_web_v229 (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  creado_en timestamptz not null default now(),
  ok boolean not null,
  codigo text not null check (codigo in ('ok', 'sin_resultados', 'timeout', 'limite_proveedor', 'error_proveedor', 'limite_usuario', 'consulta_invalida')),
  desde_cache boolean not null default false,
  proveedor text not null default 'openai_web_search',
  modelo text,
  ms integer,
  costo_usd numeric(10, 6) not null default 0,
  fuentes integer not null default 0,
  llamadas_busqueda integer not null default 0,
  consulta_hash text not null,
  pais text
);

create index if not exists eos_busquedas_web_v229_usuario_idx
  on public.eos_busquedas_web_v229 (usuario_id, creado_en desc);

alter table public.eos_busquedas_web_v229 enable row level security;
revoke all on table public.eos_busquedas_web_v229 from public, anon, authenticated;
grant select, insert on table public.eos_busquedas_web_v229 to service_role;
grant usage on sequence public.eos_busquedas_web_v229_id_seq to service_role;

comment on table public.eos_busquedas_web_v229 is
  'Una fila por búsqueda web de EOS: límite diario y métricas. No guarda la consulta, solo su hash. Solo service_role.';

create table if not exists public.eos_busquedas_cache_v229 (
  clave text primary key,
  pais text not null,
  resultado jsonb not null,
  creado_en timestamptz not null default now(),
  vence_en timestamptz not null
);

create index if not exists eos_busquedas_cache_v229_vence_idx
  on public.eos_busquedas_cache_v229 (vence_en);

alter table public.eos_busquedas_cache_v229 enable row level security;
revoke all on table public.eos_busquedas_cache_v229 from public, anon, authenticated;
grant select, insert, update, delete on table public.eos_busquedas_cache_v229 to service_role;

comment on table public.eos_busquedas_cache_v229 is
  'Resultados de consultas web PÚBLICAS (sin datos de nadie), por hash de consulta+país+profundidad, con vencimiento. Solo service_role.';
