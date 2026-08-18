-- EOS Financial Autopilot — Global Financial Context Commit v1.3
-- DESIGN ONLY. DO NOT APPLY TO PRODUCTION DURING EOS 4.0 RC1 FREEZE.
--
-- This table is the separately owned commit marker for a multi-provider global
-- Financial Context. Provider-scoped rows and the context must be written first;
-- this marker is inserted last in the future atomic RPC transaction.
--
-- Existence of a marker proves only that one exact provider evidence set and one
-- exact global context were committed together. It does NOT imply SAFE.

create table if not exists public.eos_financial_global_context_commits_v1_3 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  commit_fingerprint text not null
    check (commit_fingerprint ~ '^[0-9a-f]{64}$'),
  manifest_fingerprint text not null
    check (manifest_fingerprint ~ '^[0-9a-f]{64}$'),
  context_revision text not null
    check (context_revision ~ '^ctx:[0-9a-f]{64}$'),
  context_source_fingerprint text not null
    check (context_source_fingerprint ~ '^[0-9a-f]{64}$'),
  global_coverage_fingerprint text not null
    check (global_coverage_fingerprint ~ '^[0-9a-f]{64}$'),
  source_orchestration_fingerprint text not null
    check (source_orchestration_fingerprint ~ '^[0-9a-f]{64}$'),
  analysis_fingerprint text not null
    check (analysis_fingerprint ~ '^[0-9a-f]{64}$'),
  global_result_fingerprint text not null
    check (global_result_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_bindings jsonb not null
    check (jsonb_typeof(provider_bindings) = 'array'),
  committed_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint eos_fin_global_context_commit_context_fk
    foreign key (usuario_id, context_revision)
    references public.eos_financial_contexts_v1(usuario_id, revision)
    on delete restrict,

  unique (usuario_id, commit_fingerprint),
  unique (usuario_id, context_revision),
  unique (usuario_id, context_source_fingerprint)
);

create index if not exists eos_fin_global_context_commits_user_time_idx
  on public.eos_financial_global_context_commits_v1_3(usuario_id, committed_at desc);

alter table public.eos_financial_global_context_commits_v1_3 enable row level security;

-- Provider topology and provenance fingerprints remain server-only. Financial
-- State/Surface should expose only their existing sanitized contracts.
revoke all on table public.eos_financial_global_context_commits_v1_3
  from anon, authenticated;

-- No authenticated SELECT policy is deliberately created here.
-- No browser INSERT/UPDATE/DELETE grants are created.
-- Service/server execution must be granted only by the future validated RPC
-- migration after non-production security review.

-- Implemented by the separate design-only
-- PERSISTENCE_MULTI_PROVIDER_RPC_V1_3_DRAFT.sql. These invariants must still be
-- repeated on a non-production Supabase branch before deployment:
--   1. validate p_usuario_id from the trusted server boundary;
--   2. validate the exact sorted provider binding set;
--   3. verify every provider-plan/scope/snapshot fingerprint;
--   4. write provider-scoped rows;
--   5. write the exact global context;
--   6. insert this commit marker LAST;
--   7. exact commit replay => no-op;
--   8. same replay identity with different material => hard failure;
--   9. any failure before/at marker insert => whole PostgreSQL transaction rolls back;
--  10. validate RLS/grants/service-role execution in non-production;
--  11. rehearse rollback before any production migration.
