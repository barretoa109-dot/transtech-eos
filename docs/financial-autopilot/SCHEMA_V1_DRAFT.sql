-- EOS Financial Autopilot v1 — schema contract draft
-- DESIGN ONLY. Do not apply to production during EOS 4.0 RC1 freeze.

create table if not exists public.eos_financial_connections_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  provider_key text not null,
  connection_type text not null,
  country text not null default 'PY',
  status text not null default 'active',
  scopes jsonb not null default '[]'::jsonb,
  consented_at timestamptz,
  expires_at timestamptz,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  fresh_until timestamptz,
  health text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, provider_key, id)
);

create table if not exists public.eos_financial_accounts_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.eos_financial_connections_v1(id) on delete set null,
  external_account_id text not null,
  account_type text not null,
  institution_name text,
  display_name text,
  currency text not null,
  ownership text not null default 'unknown',
  available_balance_minor bigint,
  ledger_balance_minor bigint,
  balance_as_of timestamptz,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, connection_id, external_account_id)
);

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

create unique index if not exists eos_fin_ingestion_external_uidx
  on public.eos_financial_ingestion_events_v1(usuario_id, provider_key, connection_id, external_event_id)
  where external_event_id is not null;

create unique index if not exists eos_fin_ingestion_fingerprint_uidx
  on public.eos_financial_ingestion_events_v1(usuario_id, provider_key, source_fingerprint);

create table if not exists public.eos_financial_ledger_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.eos_financial_accounts_v1(id) on delete cascade,
  source_event_id uuid references public.eos_financial_ingestion_events_v1(id) on delete restrict,
  external_transaction_id text,
  transaction_type text not null,
  direction text not null,
  status text not null,
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
  created_at timestamptz not null default now()
);

create index if not exists eos_fin_ledger_user_time_idx
  on public.eos_financial_ledger_v1(usuario_id, occurred_at desc);

create table if not exists public.eos_financial_reconciliations_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  reconciliation_type text not null,
  ledger_entry_ids uuid[] not null,
  decision text not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  reason_code text not null,
  rule_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.eos_financial_recurrences_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  canonical_counterparty text,
  cadence text,
  expected_amount_minor bigint,
  amount_min_minor bigint,
  amount_max_minor bigint,
  currency text not null,
  next_expected_at timestamptz,
  essentiality text,
  confidence numeric(5,4) not null default 0 check (confidence >= 0 and confidence <= 1),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  miss_count integer not null default 0,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.eos_financial_obligations_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
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
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.eos_financial_constitutions_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  version integer not null,
  effective_from timestamptz not null default now(),
  superseded_at timestamptz,
  policy jsonb not null,
  confirmed_by_user_at timestamptz,
  created_at timestamptz not null default now(),
  unique (usuario_id, version)
);

create table if not exists public.eos_financial_contexts_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  revision text not null,
  currency text not null,
  status text not null,
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
  unique (usuario_id, revision)
);

-- RLS contract: authenticated users may read only their own normalized state.
-- Sensitive ingestion/reconciliation writes remain service-owned.
alter table public.eos_financial_connections_v1 enable row level security;
alter table public.eos_financial_accounts_v1 enable row level security;
alter table public.eos_financial_ingestion_events_v1 enable row level security;
alter table public.eos_financial_ledger_v1 enable row level security;
alter table public.eos_financial_reconciliations_v1 enable row level security;
alter table public.eos_financial_recurrences_v1 enable row level security;
alter table public.eos_financial_obligations_v1 enable row level security;
alter table public.eos_financial_constitutions_v1 enable row level security;
alter table public.eos_financial_contexts_v1 enable row level security;

-- Policies are intentionally not finalized here. Before migration, define the exact
-- browser-readable surface and keep mutations behind server-side RPC/service roles.
