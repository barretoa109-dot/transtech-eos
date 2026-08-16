# Financial Autopilot — Replay-Safe Multi-Provider Persistence v1.3

> Post-RC1 design/preview contract. Nothing in this document authorizes a production migration, RPC deployment, real bank credential, real financial data write or money movement.

## Purpose

The multi-provider planner separates raw provider ingestion from the single global Financial Context. This layer defines the transactional persistence semantics required before that plan can ever be backed by PostgreSQL/Supabase.

The invariant is:

`all provider scopes + optional global context + optional global commit marker together, or none commit`

A failure in provider B must never leave provider A partially committed while the global context or its authoritative commit marker is missing.

## Preview transactional store

`InMemoryMultiProviderPersistenceStore` is process-local and fake-data only. It validates the complete plan before mutation and then applies writes to cloned maps. The staged state replaces committed state only after every provider scope, the optional global context and the derived Global Financial Context Commit succeed.

This gives the preview contract transaction-like rollback semantics:

- exact full-plan replay is a no-op;
- immutable provider ingestion identity cannot be reused with different material;
- provider-scope identity cannot be replayed with conflicting material;
- mutable connection/account/Ledger state remains provider-scoped;
- global contexts are immutable by global source fingerprint;
- the Global Context Commit is inserted after provider rows and context;
- a late conflict discards all staged changes from earlier providers.

The store independently recomputes provider-plan, manifest, global-context and full-plan SHA-256 identities before accepting a write. A caller cannot alter a safety aggregate and retain the old global context identity.

## Security boundary

The store is constructed with a trusted server-derived user id.

Every provider plan must belong to that user. Connection, account, ingestion and Ledger rows are checked against that owner boundary. Provider-bearing rows must also match the provider plan they are nested under.

The global context and its derived commit marker bind the same exact manifest, provider-preserving analysis, global coverage, source orchestration and global Zero Entry result, plus the exact sorted provider scope/snapshot/provider-plan fingerprint set.

Cross-user or cross-provider substitution fails before committed state changes.

## Replay semantics

The full persistence plan is keyed by:

`trusted user + planFingerprint`

If the exact serialized plan already exists, persistence returns `replayed=true` and touches zero rows.

Immutable ingestion events are keyed by:

`user + provider + connection + externalEventId`

Reusing that key with different event material fails with `financial_multi_provider_ingestion_replay_mismatch`.

The Global Context Commit has its own deterministic replay identity:

`user + globalContextCommitFingerprint`

This is intentionally stricter than mutable canonical Ledger state, because canonical Ledger rows may legitimately advance lifecycle state while raw source evidence and authoritative context commits must not be rewritten invisibly.

## Global context semantics

Provider ingestion may exist without a global context when trusted source coverage is structurally incomplete.

When `globalContextPlan` exists, it is separately committed using its global source fingerprint and `ctx:<sha256>` revision, followed by a Global Financial Context Commit. Plan/marker existence does not imply SAFE:

- complete + fresh + economically safe may be SAFE;
- complete but stale remains DEGRADED and may still be transactionally committed;
- structurally incomplete coverage produces no global context and no global commit marker.

The dedicated contract is `GLOBAL_FINANCIAL_CONTEXT_COMMIT_V1_3.md`; its design-only schema is `GLOBAL_CONTEXT_COMMIT_V1_3_DRAFT.sql`.

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
- exact `globalContextCommitFingerprint` or null;
- non-negative provider scope / Ledger / ingestion touched counters.

The adapter rejects owner mismatch before RPC, reduces database failure to a stable error code, and rejects response plan/context/commit substitution.

## Important SQL boundary

The TypeScript RPC adapter remains a contract only. The PostgreSQL multi-provider function is deliberately **not** deployed or wired in this phase.

The separately owned global commit-marker schema is now defined as a design-only draft, which removes the earlier provider-ownership ambiguity. The next database step is to implement the atomic RPC only in a non-production environment and prove rollback, replay, RLS/grants and service-role-only execution before any production migration is considered.

## Scenario coverage

Preview-only scenarios cover first write, exact replay, immutable event conflict, staged rollback, cross-user rejection, global context material tamper, incomplete global coverage, deterministic global commit construction, order-independent provider binding, DEGRADED commit semantics, and RPC plan/context/commit response substitution.

These scenarios are included in the internal Financial Autopilot pilot smoke route.

## Production boundary

No database call is made by the preview store.

The Supabase adapter is not wired to a production call site. No new RPC has been deployed. No financial schema has been applied. No real provider credential or financial data is introduced.

PR #58 remains draft / post-RC1 / **DO NOT MERGE** until the EOS 4.0 RC1 gates close.
