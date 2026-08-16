# Financial Autopilot — Global Financial Context Commit v1.3

> Post-RC1 design/preview contract. Nothing here authorizes a production migration, production RPC, real bank credential, real financial-data write or money movement.

## Purpose

A user may have several independent provider scopes while EOS must expose one consolidated financial reality. A provider key cannot own that global truth without corrupting provenance.

The Global Financial Context Commit is therefore a separately owned marker that binds:

- the exact global Financial Context revision and source fingerprint;
- the exact multi-provider manifest;
- the exact trusted global source coverage;
- the exact source-orchestration evidence;
- the exact provider-preserving analysis;
- the exact global Zero Entry result;
- the exact sorted set of provider scope, snapshot and provider-plan fingerprints.

The marker fingerprint uses the contract `multi-provider-global-context-commit-v1`.

## Commit ordering

The future PostgreSQL/Supabase transaction must use this logical order:

`provider-scoped rows -> global Financial Context -> Global Context Commit`

The Global Context Commit is inserted last. If provider B fails, the context fails, or marker insertion fails, the entire database transaction must roll back.

This eliminates the need to invent a synthetic provider for global state.

## Replay identity

The authoritative marker replay identity is:

`usuario_id + commit_fingerprint`

An exact replay is a no-op. Reusing an immutable identity with different material must fail closed.

The marker is deterministic from values already bound by the scoped persistence plan. It deliberately does not include `planFingerprint` in its own hash, which avoids a circular identity dependency.

## Provider binding

Every provider binding contains only deterministic identifiers needed to prove the committed evidence set:

- `providerKey`;
- `scopeFingerprint`;
- `snapshotFingerprint`;
- `providerPlanFingerprint`.

Bindings are sorted before hashing, so provider input ordering cannot change the commit identity.

## Safety semantics

A committed context is not automatically SAFE.

A DEGRADED context may legitimately have a Global Context Commit when structural global coverage is complete but evidence is stale. The marker proves atomic provenance, not economic safety.

When structural global coverage is incomplete, there is no authoritative global context and therefore no Global Context Commit. Provider-scoped raw ingestion may still be persisted independently inside the same plan.

## Preview implementation

`buildMultiProviderGlobalContextCommitFromPlan` derives the marker from an eligible scoped plan and returns `null` for a structurally incomplete plan with no global context.

`InMemoryMultiProviderPersistenceStore` now stages provider rows and the global context, then inserts the derived marker last before committing staged state. Its result returns `globalContextCommitFingerprint`.

The future server-only `eos_financial_persist_multi_provider_v1_3` response contract must return that exact fingerprint (or null when no global context exists). The TypeScript adapter rejects substitution or omission.

## Database draft

`GLOBAL_CONTEXT_COMMIT_V1_3_DRAFT.sql` defines the design-only table `eos_financial_global_context_commits_v1_3`.

It binds the marker to `(usuario_id, context_revision)`, keeps provider topology/provenance server-only, enables RLS, and grants no browser access.

The SQL is not a production migration and must not be applied during the EOS 4.0 RC1 freeze.

## Trust boundary

SHA-256 fingerprints prevent accidental or untrusted application-layer substitution from passing identity checks. They are not a substitute for the database/service trust boundary.

An attacker with authority to rewrite every database row and recompute every fingerprint remains inside the trust root. Production safety still requires service-role isolation, RLS/grant review, auditability, non-production PostgreSQL tests and rollback rehearsal.

## Required non-production validation before executable RPC

Before the multi-provider RPC is implemented/deployed, validate at minimum:

- fresh atomic insert across two or more providers;
- exact replay no-op;
- immutable replay conflict;
- late-provider rollback;
- context failure rollback;
- commit-marker failure rollback;
- cross-user/provider/account substitution rejection;
- marker/context foreign-key integrity;
- no marker for incomplete structural coverage;
- DEGRADED marker does not become SAFE;
- RLS/grants and service-only execution;
- rollback rehearsal.

## Release boundary

PR #58 remains draft / post-RC1 / **DO NOT MERGE**. No production schema, RPC, provider credential, real data or money movement is introduced by this contract.
