-- EOS Financial Autopilot v1 — persistence schema contract draft
-- DESIGN ONLY. DO NOT APPLY TO PRODUCTION DURING EOS 4.0 RC1 FREEZE.
--
-- Goals:
--   * one canonical financial truth per user;
--   * replay-safe ingestion and Ledger persistence;
--   * immutable/auditable reconciliation and context snapshots;
--   * browser reads are owner-scoped and read-only;
--   * ingestion/reconciliation/normalization writes remain service-owned;
--   * disconnecting a provider is a soft state change, not a history deletion.

create table if not exists public.eos_financial_connections_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  provider_key text not null,
  connection_key text not null,
  connection_type text not null,
  country text not null default 'PY',
  status text not null default 'active'
    check (status in ('active', 'stale', 'degraded', 'revoked', 'disconnected', 'error')),
  scopes jsonb not null default '[]'::jsonb,
  consented_at timestamptz,
  expires_at timestamptz,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  fresh_until timestamptz,
  health text not null default 'unknown'
    check (health in ('healthy', 'stale', 'degraded', 'error', 'unknown')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, provider_key, connection_key)
);

create table if not exists public.eos_financial_accounts_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.eos_financial_connections_v1(id) on delete cascade,
  external_account_id text not null,
  account_type text not null
    check (account_type in ('checking', 'savings', 'card', 'wallet', 'investment', 'loan', 'cash', 'other')),
  institution_name text,
  display_name text,
  currency text not null,
  ownership text not null default 'unknown'
    check (ownership in ('own', 'joint', 'external', 'unknown')),
  available_balance_minor bigint,
  ledger_balance_minor bigint,
  balance_as_of timestamptz,
  fresh_until timestamptz,
  status text not null default 'active'
    check (status in ('active', 'stale', 'closed', 'hidden', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, connection_id, external_account_id)
);

create index if not exists eos_fin_accounts_user_connection_idx
  on public.eos_financial_accounts_v1(usuario_id, connection_id);

create table if not exists public.eos_financial_ingestion_events_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.eos_financial_connections_v1(id) on delete set null,
  account_id uuid references public.eos_financial_accounts_v1(id) on delete set null,
  provider_key text not null,
  external_event_id text,
  event_type text not null,
  provider_status text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  payload_hash text not null,
  source_fingerprint text not null,
  raw_ref text,
  sync_batch_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- PostgreSQL UNIQUE treats NULLs as distinct. COALESCE keeps provider event replay
-- idempotent even for connector/import events that legitimately have no connection id.
create unique index if not exists eos_fin_ingestion_external_uidx
  on public.eos_financial_ingestion_events_v1(
    usuario_id,
    provider_key,
    coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid),
    external_event_id
  )
  where external_event_id is not null;

create unique index if not exists eos_fin_ingestion_fingerprint_uidx
  on public.eos_financial_ingestion_events_v1(usuario_id, provider_key, source_fingerprint);

create index if not exists eos_fin_ingestion_user_received_idx
  on public.eos_financial_ingestion_events_v1(usuario_id, received_at desc);

create table if not exists public.eos_financial_ledger_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.eos_financial_accounts_v1(id) on delete cascade,
  source_event_id uuid references public.eos_financial_ingestion_events_v1(id) on delete restrict,
  canonical_key text not null,
  external_transaction_id text,
  transaction_type text not null
    check (transaction_type in (
      'income', 'expense', 'internal_transfer', 'card_payment', 'refund',
      'debt_payment', 'debt_draw', 'investment_contribution',
      'investment_withdrawal', 'fee', 'tax', 'cash_withdrawal',
      'cash_deposit', 'adjustment', 'unknown'
    )),
  direction text not null check (direction in ('credit', 'debit', 'neutral')),
  status text not null check (status in ('pending', 'posted', 'reversed', 'cancelled')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null,
  occurred_at timestamptz not null,
  posted_at timestamptz,
  description_raw text,
  merchant_normalized text,
  category text,
  subcategory text,
  counterparty_ref text,
  internal_transfer_group_id uuid,
  recurrence_id uuid,
  reversal_of uuid references public.eos_financial_ledger_v1(id),
  confidence numeric(5,4) not null default 0 check (confidence >= 0 and confidence <= 1),
  classification_source text,
  provenance text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, canonical_key)
);

create unique index if not exists eos_fin_ledger_external_uidx
  on public.eos_financial_ledger_v1(usuario_id, account_id, external_transaction_id)
  where external_transaction_id is not null;

create unique index if not exists eos_fin_ledger_source_event_uidx
  on public.eos_financial_ledger_v1(usuario_id, source_event_id)
  where source_event_id is not null;

create index if not exists eos_fin_ledger_user_time_idx
  on public.eos_financial_ledger_v1(usuario_id, occurred_at desc);

create index if not exists eos_fin_ledger_user_status_idx
  on public.eos_financial_ledger_v1(usuario_id, status, occurred_at desc);

create table if not exists public.eos_financial_reconciliations_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  signature text not null,
  reconciliation_type text not null,
  ledger_entry_ids uuid[] not null,
  decision text not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  matched_amount_minor bigint,
  reason_code text not null,
  rule_version text not null,
  created_at timestamptz not null default now(),
  unique (usuario_id, signature)
);

create table if not exists public.eos_financial_recurrences_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  recurrence_key text not null,
  kind text not null,
  direction text not null check (direction in ('credit', 'debit')),
  canonical_counterparty text,
  cadence text check (cadence in ('daily', 'weekly', 'biweekly', 'monthly', 'irregular')),
  expected_amount_minor bigint,
  amount_min_minor bigint,
  amount_max_minor bigint,
  currency text not null,
  next_expected_at timestamptz,
  essentiality text check (essentiality in ('critical', 'essential', 'flexible', 'optional')),
  confidence numeric(5,4) not null default 0 check (confidence >= 0 and confidence <= 1),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  miss_count integer not null default 0 check (miss_count >= 0),
  status text not null default 'active'
    check (status in ('active', 'paused', 'ended', 'superseded')),
  source_entry_ids uuid[] not null default '{}'::uuid[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, recurrence_key)
);

create table if not exists public.eos_financial_obligations_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  recurrence_id uuid references public.eos_financial_recurrences_v1(id) on delete set null,
  obligation_type text not null,
  counterparty text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null,
  due_at timestamptz not null,
  source text not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  priority integer not null default 0,
  must_protect boolean not null default false,
  status text not null default 'open'
    check (status in ('open', 'paid', 'cancelled', 'superseded', 'missed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, source_key)
);

create index if not exists eos_fin_obligations_user_due_idx
  on public.eos_financial_obligations_v1(usuario_id, due_at)
  where status = 'open';

create table if not exists public.eos_financial_constitutions_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  effective_from timestamptz not null default now(),
  superseded_at timestamptz,
  policy jsonb not null,
  policy_fingerprint text not null,
  confirmed_by_user_at timestamptz,
  created_at timestamptz not null default now(),
  unique (usuario_id, version),
  unique (usuario_id, policy_fingerprint)
);

create table if not exists public.eos_financial_contexts_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  revision text not null,
  currency text not null,
  status text not null check (status in ('SAFE', 'ATTENTION', 'ACTION_REQUIRED', 'DEGRADED')),
  horizon_until timestamptz not null,
  horizon_reason text not null,
  liquidity_usable_minor bigint not null,
  protected_commitments_minor bigint not null,
  essential_spend_expected_minor bigint not null,
  protected_reserve_minor bigint not null,
  critical_provisions_minor bigint not null,
  confirmed_income_minor bigint not null,
  uncertainty_buffer_minor bigint not null,
  available_real_safe_minor bigint not null,
  minimum_projected_cash_minor bigint,
  minimum_projected_cash_at timestamptz,
  confidence jsonb not null,
  explanation_refs jsonb not null default '[]'::jsonb,
  sources_fresh boolean not null,
  source_fingerprint text not null,
  generated_at timestamptz not null default now(),
  valid_until timestamptz,
  unique (usuario_id, revision),
  unique (usuario_id, source_fingerprint)
);

create index if not exists eos_fin_contexts_user_generated_idx
  on public.eos_financial_contexts_v1(usuario_id, generated_at desc);

-- RLS: enable on every base table. No public/anonymous access.
alter table public.eos_financial_connections_v1 enable row level security;
alter table public.eos_financial_accounts_v1 enable row level security;
alter table public.eos_financial_ingestion_events_v1 enable row level security;
alter table public.eos_financial_ledger_v1 enable row level security;
alter table public.eos_financial_reconciliations_v1 enable row level security;
alter table public.eos_financial_recurrences_v1 enable row level security;
alter table public.eos_financial_obligations_v1 enable row level security;
alter table public.eos_financial_constitutions_v1 enable row level security;
alter table public.eos_financial_contexts_v1 enable row level security;

revoke all on table public.eos_financial_connections_v1 from anon, authenticated;
revoke all on table public.eos_financial_accounts_v1 from anon, authenticated;
revoke all on table public.eos_financial_ingestion_events_v1 from anon, authenticated;
revoke all on table public.eos_financial_ledger_v1 from anon, authenticated;
revoke all on table public.eos_financial_reconciliations_v1 from anon, authenticated;
revoke all on table public.eos_financial_recurrences_v1 from anon, authenticated;
revoke all on table public.eos_financial_obligations_v1 from anon, authenticated;
revoke all on table public.eos_financial_constitutions_v1 from anon, authenticated;
revoke all on table public.eos_financial_contexts_v1 from anon, authenticated;

-- Candidate browser-readable normalized surfaces. Mutations remain server/service-owned.
grant select on table public.eos_financial_accounts_v1 to authenticated;
grant select on table public.eos_financial_ledger_v1 to authenticated;
grant select on table public.eos_financial_recurrences_v1 to authenticated;
grant select on table public.eos_financial_obligations_v1 to authenticated;
grant select on table public.eos_financial_constitutions_v1 to authenticated;
grant select on table public.eos_financial_contexts_v1 to authenticated;

create policy eos_fin_accounts_select_own
  on public.eos_financial_accounts_v1
  for select to authenticated
  using (usuario_id = auth.uid());

create policy eos_fin_ledger_select_own
  on public.eos_financial_ledger_v1
  for select to authenticated
  using (usuario_id = auth.uid());

create policy eos_fin_recurrences_select_own
  on public.eos_financial_recurrences_v1
  for select to authenticated
  using (usuario_id = auth.uid());

create policy eos_fin_obligations_select_own
  on public.eos_financial_obligations_v1
  for select to authenticated
  using (usuario_id = auth.uid());

create policy eos_fin_constitutions_select_own
  on public.eos_financial_constitutions_v1
  for select to authenticated
  using (usuario_id = auth.uid());

create policy eos_fin_contexts_select_own
  on public.eos_financial_contexts_v1
  for select to authenticated
  using (usuario_id = auth.uid());

-- Deliberately NO authenticated policy for:
--   eos_financial_connections_v1 (may contain provider metadata/scopes),
--   eos_financial_ingestion_events_v1 (raw provenance),
--   eos_financial_reconciliations_v1 (internal engine evidence).
-- Those surfaces should be exposed only through a deliberately narrow server/API contract.
--
-- Before this draft becomes a migration:
--   1. verify every table/column against the live Supabase schema;
--   2. add service-role/server write grants/RPCs explicitly;
--   3. run owner-isolation and cross-user negative tests;
--   4. run replay/idempotency tests against real Postgres constraints;
--   5. rehearse rollback on a non-production project;
--   6. do not apply until EOS 4.0 RC1 release freeze is closed.
