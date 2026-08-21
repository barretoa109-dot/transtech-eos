-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

create table if not exists public.eos_documents_v11 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  conversacion_id uuid,
  nombre text not null,
  mime_type text not null,
  extension text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  checksum_sha256 text,
  storage_path text,
  source text not null default 'chat_upload'
    check (source in ('chat_upload','manual','generated','imported','api')),
  document_type text not null default 'unknown'
    check (document_type in ('invoice','receipt','contract','report','spreadsheet','proposal','policy','statement','presentation','image','text','unknown')),
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','ready','partial','unsupported','error')),
  intelligence_status text not null default 'pending'
    check (intelligence_status in ('pending','processing','ready','error')),
  extracted_text text,
  extracted_char_count integer not null default 0 check (extracted_char_count >= 0),
  language text,
  summary text,
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_documents_name_not_blank check (btrim(nombre) <> ''),
  constraint eos_documents_mime_not_blank check (btrim(mime_type) <> '')
);

create table if not exists public.eos_document_chunks_v11 (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.eos_documents_v11(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  char_start integer,
  char_end integer,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_document_chunks_content_not_blank check (btrim(content) <> ''),
  constraint eos_document_chunks_range_check check (
    char_start is null or char_end is null or (char_start >= 0 and char_end >= char_start)
  )
);

create table if not exists public.eos_document_findings_v11 (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.eos_documents_v11(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  finding_type text not null
    check (finding_type in ('fact','metric','date','money','obligation','risk','opportunity','decision','action','person','organization','reference')),
  title text not null,
  value_text text,
  normalized_value jsonb not null default '{}'::jsonb,
  evidence_text text,
  confidence numeric(4,3) not null default 0.500 check (confidence >= 0 and confidence <= 1),
  importance smallint not null default 3 check (importance between 1 and 5),
  status text not null default 'active'
    check (status in ('active','dismissed','superseded')),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_document_findings_title_not_blank check (btrim(title) <> '')
);

create table if not exists public.eos_document_links_v11 (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.eos_documents_v11(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('goal','decision','action','learning','memory','context','conversation')),
  entity_id text not null,
  relation text not null
    check (relation in ('supports','contradicts','updates','creates','evidence_for','related_to')),
  confidence numeric(4,3) not null default 0.500 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint eos_document_links_entity_not_blank check (btrim(entity_id) <> '')
);

create table if not exists public.eos_document_intelligence_runs_v11 (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.eos_documents_v11(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  request_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','error')),
  model_version text,
  prompt_version text,
  execution_id text,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists eos_documents_user_checksum_uidx
  on public.eos_documents_v11 (usuario_id, checksum_sha256)
  where checksum_sha256 is not null;
create index if not exists eos_documents_user_created_idx
  on public.eos_documents_v11 (usuario_id, created_at desc);
create index if not exists eos_documents_user_status_idx
  on public.eos_documents_v11 (usuario_id, intelligence_status, created_at desc);
create unique index if not exists eos_document_chunks_document_index_uidx
  on public.eos_document_chunks_v11 (document_id, chunk_index);
create index if not exists eos_document_findings_user_importance_idx
  on public.eos_document_findings_v11 (usuario_id, importance desc, created_at desc)
  where status = 'active';
create unique index if not exists eos_document_links_unique_uidx
  on public.eos_document_links_v11 (document_id, entity_type, entity_id, relation);
create unique index if not exists eos_document_runs_request_uidx
  on public.eos_document_intelligence_runs_v11 (usuario_id, request_id);

create or replace function public.eos_touch_document_v11()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.extracted_text is distinct from old.extracted_text then
    new.extracted_char_count := length(coalesce(new.extracted_text, ''));
  end if;
  return new;
end;
$$;

drop trigger if exists eos_documents_touch_v11 on public.eos_documents_v11;
create trigger eos_documents_touch_v11
before update on public.eos_documents_v11
for each row execute function public.eos_touch_document_v11();

alter table public.eos_documents_v11 enable row level security;
alter table public.eos_document_chunks_v11 enable row level security;
alter table public.eos_document_findings_v11 enable row level security;
alter table public.eos_document_links_v11 enable row level security;
alter table public.eos_document_intelligence_runs_v11 enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'eos_documents_v11',
    'eos_document_chunks_v11',
    'eos_document_findings_v11',
    'eos_document_links_v11',
    'eos_document_intelligence_runs_v11'
  ] loop
    execute format('drop policy if exists %I_select_own on public.%I', t, t);
    execute format('create policy %I_select_own on public.%I for select to authenticated using ((select auth.uid()) = usuario_id)', t, t);
    execute format('drop policy if exists %I_insert_own on public.%I', t, t);
    execute format('create policy %I_insert_own on public.%I for insert to authenticated with check ((select auth.uid()) = usuario_id)', t, t);
    execute format('drop policy if exists %I_update_own on public.%I', t, t);
    execute format('create policy %I_update_own on public.%I for update to authenticated using ((select auth.uid()) = usuario_id) with check ((select auth.uid()) = usuario_id)', t, t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

comment on table public.eos_documents_v11 is
  'Fase 8 Document Intelligence: registro canónico de documentos recibidos, generados o importados por cada usuario.';
comment on table public.eos_document_findings_v11 is
  'Hallazgos trazables extraídos de documentos: hechos, métricas, riesgos, obligaciones, decisiones y acciones.';
comment on table public.eos_document_links_v11 is
  'Relaciones explícitas entre evidencia documental y entidades operativas de EOS.';

commit;
