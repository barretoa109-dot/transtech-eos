-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

create index if not exists eos_autonomy_events_command_idx_v15
  on public.eos_autonomy_events_v12 (command_id)
  where command_id is not null;

create index if not exists eos_document_chunks_user_idx_v15
  on public.eos_document_chunks_v11 (usuario_id);

create index if not exists eos_document_findings_document_idx_v15
  on public.eos_document_findings_v11 (document_id);

create index if not exists eos_document_runs_document_idx_v15
  on public.eos_document_intelligence_runs_v11 (document_id);

create index if not exists eos_document_links_user_idx_v15
  on public.eos_document_links_v11 (usuario_id);

comment on index public.eos_autonomy_events_command_idx_v15 is
  'Índice de cobertura para FK command_id del historial de autonomía.';
comment on index public.eos_document_chunks_user_idx_v15 is
  'Índice de cobertura para FK usuario_id de chunks documentales.';
comment on index public.eos_document_findings_document_idx_v15 is
  'Índice de cobertura para FK document_id de hallazgos documentales.';
comment on index public.eos_document_runs_document_idx_v15 is
  'Índice de cobertura para FK document_id de runs de inteligencia documental.';
comment on index public.eos_document_links_user_idx_v15 is
  'Índice de cobertura para FK usuario_id de enlaces documentales.';

commit;
