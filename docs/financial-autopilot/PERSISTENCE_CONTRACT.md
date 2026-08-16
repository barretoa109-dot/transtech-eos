# Financial Autopilot — Persistence Contract v1

> Post-RC1 design/implementation contract. Do **not** apply the financial schema to production while EOS 4.0 RC1 remains frozen.

## Purpose

The persistence layer turns a normalized Financial Autopilot computation into a durable, replay-safe financial state without changing the economic meaning of the source data.

The canonical flow is:

`Connection -> Accounts -> Immutable Ingestion -> Canonical Ledger -> Reconciliation -> Recurrences -> Obligations -> Financial Context`

The Financial Context is committed **last**. EOS must never publish a context as current if one of the source persistence steps failed.

## Current production boundary

A live Supabase schema inspection on 2026-08-16 showed the existing legacy `public.eos_finance_records` table and no `public.eos_financial_*_v1` tables. The new tables in `SCHEMA_V1_DRAFT.sql` therefore remain an isolated contract, not a production migration.

## Stable identities

### Connection

Unique business identity:

`usuario_id + provider_key + connection_key`

A disconnect/revocation updates connection state. It does not delete historical Ledger/ingestion evidence.

### Account

Unique business identity:

`usuario_id + connection + external_account_id`

The connector's transient/local object id must not be used as the long-term financial identity.

### Ingestion event

Raw ingestion is immutable.

External event identity uses the provider/source event id, not the financial transaction id. A repeated event with identical material is a replay. A repeated event id with different material is a **replay mismatch** and must fail closed.

### Canonical Ledger entry

Preferred key:

`external account id + external transaction id`

Fallback:

`external account id + source event id`

The Ledger is lifecycle-aware. A canonical transaction can advance `pending -> posted` without creating a second economic event.

### Reconciliation

Reconciliation is immutable evidence keyed by a deterministic signature of:

- reconciliation type;
- canonical Ledger evidence;
- reason code;
- matched amount when present.

### Recurrence

Stable identity is the recurrence key produced by the behavior engine. Source evidence is persisted by canonical Ledger identity, not by transient array position.

### Obligation

Stable identity is a deterministic `source_key`. Recomputing the same inferred obligation must upsert it instead of creating another liability.

### Financial Context

A context is identified by a deterministic source fingerprint derived from:

- normalized account state;
- canonical Ledger lifecycle state;
- reconciliation signatures;
- recurrences;
- obligations;
- resolved safety inputs;
- resulting status and Available Real.

`fetched_at` alone does not create a new financial reality. Source freshness changes may create a new fingerprint because they change what EOS is allowed to assert safely.

## Atomic persistence order

The future production adapter/RPC should execute one database transaction in this order:

1. upsert connection state;
2. upsert account state;
3. insert immutable ingestion events;
4. upsert canonical Ledger entries;
5. insert reconciliation evidence;
6. upsert recurrences;
7. upsert obligations;
8. insert Financial Context last.

Any failure before step 8 aborts the transaction. No partially-updated context may become visible.

## Replay semantics

### Exact replay

Same source material + same source fingerprint:

- no duplicate ingestion event;
- no duplicate Ledger economic effect;
- no duplicate reconciliation;
- no duplicate obligation;
- no duplicate context;
- return the existing context revision.

### Lifecycle update

Same canonical transaction, newer provider lifecycle state:

- preserve immutable ingestion evidence;
- update the canonical Ledger row;
- do not create a second expense/income;
- recompute downstream context if the material state changed.

### Replay mismatch

Same immutable provider event identity with different payload/fingerprint:

- fail closed;
- do not update the Ledger;
- do not publish a new context;
- retain an auditable error code.

## Context validity

A context must not claim validity beyond the earliest critical source freshness boundary.

Conceptually:

`valid_until = min(primary financial horizon, critical source fresh_until)`

A stale critical source forces `DEGRADED`; it cannot be compensated by an otherwise high aggregate confidence score.

## Security model

- Browser never supplies trusted `usuario_id` for persistence.
- Server derives the user from the authenticated Supabase session.
- Browser roles receive only explicitly allowed owner-scoped `SELECT` surfaces.
- Ingestion and reconciliation evidence remain service-owned.
- Provider credentials/tokens are not stored in normalized financial rows or returned through the Financial Context.
- RLS is enabled on every financial base table.
- No anonymous access.

## Economic invariants

Persistence must preserve the already-tested accounting semantics:

- own-account transfer is not income or expense;
- card purchase is consumption once;
- card payoff is liability settlement, not a second expense;
- debt draw is liquidity/financing, not income;
- refund offsets prior consumption;
- pending -> posted is one transaction lifecycle;
- explicit reversal neutralizes the original economic effect;
- duplicate provider delivery never creates duplicate economic effect.

## Preview evidence contract

The preview persistence emulator must prove at least:

- deterministic plan for exact replay;
- source ordering does not change the plan;
- changed balance changes Financial Context fingerprint;
- exact replay causes zero Ledger/ingestion writes;
- context-only change does not duplicate Ledger rows;
- immutable ingestion replay mismatch fails closed;
- a failed replay mismatch does not create a context;
- safety inputs persisted in the context exactly match the inputs used by the Available Real computation.

The in-memory store is an emulator only. It proves semantics; it is not a production datastore.

## Promotion gates after RC1

Before converting `SCHEMA_V1_DRAFT.sql` into an executable migration:

1. close EOS 4.0 RC1 release gates;
2. create/use a non-production Supabase branch or isolated project;
3. apply the schema there;
4. implement one transactional server/RPC persistence adapter;
5. run exact replay, race, owner isolation and cross-user negative tests;
6. run pending/posted and transfer/card/refund lifecycle tests against real Postgres constraints;
7. validate RLS and grants from anon/authenticated/service roles;
8. rehearse rollback;
9. only then evaluate production migration.

## Non-goals in this branch

This contract does not authorize:

- real bank credentials;
- real payment initiation;
- autonomous money movement;
- production schema application;
- RC1 Worker Gate/n8n changes.
