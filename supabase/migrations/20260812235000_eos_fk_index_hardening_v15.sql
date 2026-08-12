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
