# Financial Autopilot — Replay-Safe Multi-Provider Persistence v1.3

> Post-RC1 design/preview contract. Nothing in this document authorizes a production migration, RPC deployment, real bank credential, real financial data write or money movement.

## Purpose

The multi-provider planner already separates raw provider ingestion from the single global Financial Context. This phase defines the transactional persistence semantics required before that plan can ever be backed by PostgreSQL/Supabase.

The invariant is:

`all provider scopes + optional global context commit together, or none commit`

A failure in provider B must never leave provider A partially committed while the global context is missing or stale.

## Preview transactional store

`InMemoryMultiProviderPersistenceStore` is process-local and fake-data only. It validates the complete plan before mutation and then applies writes to cloned maps. The staged state replaces committed state only after every provider scope and the optional global context succeed.

This gives the preview contract transaction-like rollback semantics:

- exact full-plan replay is a no-op;
- immutable provider ingestion identity cannot be reused with different material;
- provider-scope identity cannot be replayed with conflicting material;
- mutable connection/account/Ledger state remains provider-scoped;
- global contexts are immutable by global source fingerprint;
- a late conflict discards all staged changes from earlier providers.

The store independently recomputes provider-plan, global-context and full-plan SHA-256 identities before accepting a write. A caller cannot alter a safety aggregate and retain the old global context identity.

## Security boundary

The store is constructed with a trusted server-derived user id.

Every provider plan must belong to that user. Connection, account, ingestion and Ledger rows are checked against that owner boundary. Provider-bearing rows must also match the provider plan they are nested under.

The global context must bind the same:

- manifest fingerprint;
- provider-preserving analysis fingerprint;
- global coverage fingerprint;
- source orchestration fingerprint;
- global Zero Entry result fingerprint.

Cross-user or cross-provider substitution fails before committed state changes.

## Replay semantics

The full persistence plan is keyed by:

`trusted user + planFingerprint`

If the exact serialized plan already exists, persistence returns `replayed=true` and touches zero rows.

Immutable ingestion events are keyed by:

`user + provider + connection + externalEventId`

Reusing that key with different event material fails with `financial_multi_provider_ingestion_replay_mismatch`.

This is intentionally stricter than mutable canonical Ledger state, because a canonical Ledger row may legitimately advance lifecycle state while raw source evidence must not be rewritten invisibly.

## Global context semantics

Provider ingestion may exist without a global context when trusted source coverage is structurally incomplete.

When `globalContextPlan` exists, it is separately committed using its global source fingerprint and `ctx:<sha256>` revision. Plan existence does not imply SAFE:

- complete + fresh + economically safe may be SAFE;
- complete but stale remains DEGRADED;
- structurally incomplete coverage produces no global context plan.

## Server RPC adapter contract

`SupabaseMultiProviderPersistenceStore` reserves the server-only RPC name:

`eos_financial_persist_multi_provider_v1_3`

The request contract is:

- `p_usuario_id`: trusted server user;
- `p_batch`: `MultiProviderScopedPersistencePlan`.

The response must contain:

- `replayed`;
- exact `planFingerprint`;
- exact `globalContextRevision` or null;
- non-negative provider scope / Ledger / ingestion touched counters.

The adapter rejects owner mismatch before RPC, reduces database failure to a stable error code, and rejects response fingerprint/revision substitution.

## Important SQL boundary

The TypeScript RPC adapter is a contract only. The PostgreSQL implementation is deliberately **not** introduced in this phase because the existing `eos_financial_persist_snapshot_v1_3` RPC is shaped around one provider-scoped snapshot plus one context. Reusing it for a global multi-provider plan would either fabricate a provider identity or persist the global context more than once.

Before an executable multi-provider RPC draft is added, the non-production schema contract must define a separately owned global context commit marker and its replay key. That is the next persistence layer.

This avoids creating SQL that appears executable while violating the provider-preservation guarantees established by the planner.

## Scenario coverage

Preview-only scenarios prove:

- first write touches both provider scopes;
- exact replay is a no-op;
- immutable event conflict fails closed;
- a late provider conflict rolls back all staged changes;
- cross-user plans fail before mutation;
- global context material tampering fails identity verification;
- incomplete global coverage persists provider scopes without a global context;
- RPC request uses the exact server-only function contract;
- RPC response plan/context substitution fails closed;
- malformed counters fail closed.

These scenarios are included in the internal Financial Autopilot pilot smoke route.

## Production boundary

No database call is made by the preview store.

The Supabase adapter is not wired to a production call site. No new RPC has been deployed. No financial schema has been applied. No real provider credential or financial data is introduced.

PR #58 remains draft / post-RC1 / **DO NOT MERGE** until the EOS 4.0 RC1 gates close.
