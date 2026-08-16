# Financial Autopilot — Multi-Provider Scoped Persistence Plan v1.3

> Post-RC1 design/implementation contract. This planner performs **no database writes** and does not authorize a production migration, real provider credentials or money movement.

## Purpose

Global Zero Entry can now reason across several financial providers without losing provenance. Persistence must preserve the same rule.

A Bank A + Bank B analysis must never be flattened into one fake `providerKey` merely because EOS wants one global financial context.

The scoped persistence plan separates two responsibilities:

1. persist each original provider snapshot under its original provider + connection identity;
2. plan one separately bound global context above those provider scopes.

## Provider-scoped plans

For every original provider bundle, the planner derives deterministic:

- connection upserts;
- account upserts;
- ingestion-event upserts;
- canonical Ledger upserts;
- provider snapshot fingerprint;
- provider scope fingerprint;
- provider-plan fingerprint.

Every connection and Ledger row retains the original provider key. No synthetic provider is introduced.

The planner recomputes the provider scope identity and requires it to match the already-bound `MultiProviderPersistenceManifest`. A scope substitution or mismatch fails closed before any future write layer could run.

## One global context

When the manifest proves structurally complete global coverage, the planner creates exactly one `MultiProviderGlobalContextPlan`.

Its SHA-256 source identity binds:

- trusted user;
- manifest fingerprint;
- provider-preserving analysis fingerprint;
- global coverage fingerprint;
- source orchestration fingerprint;
- exact global Zero Entry result fingerprint;
- currency/status/horizon;
- all Available Real safety aggregates;
- confidence;
- source freshness;
- explicit critical-source completeness;
- explicit critical-obligation completeness;
- first forecast risk;
- generated/valid time window.

The resulting revision is `ctx:<sha256>`.

This global context is not stored under any provider key. Provider ingestion and global reasoning remain separate layers.

## Incomplete coverage behavior

Provider ingestion planning is allowed to remain available even when global source coverage is structurally incomplete.

In that case:

- provider-scoped plans are still produced;
- `globalContextPlan = null`;
- EOS must not persist a global financial context from incomplete structural evidence.

This lets EOS safely ingest newly connected institutions while still refusing to make a global safety assertion.

## Freshness behavior

Structural closure and freshness remain independent.

A globally complete source set with one stale remote card/account may still produce a bound global context plan, but that context must remain `DEGRADED` with `sourcesFresh = false`.

Therefore `globalContextPlan !== null` does **not** mean SAFE.

## Determinism

Provider plans are sorted by original provider + scope fingerprint. Account and Ledger identities are canonicalized before plan hashing.

Reversing input provider order must not change:

- provider-plan fingerprints;
- global context revision;
- final scoped persistence plan fingerprint.

## Current implementation boundary

This module is still a planner, not a persistence store.

It intentionally does **not**:

- call Supabase;
- execute an RPC;
- create or alter production tables;
- change RLS/grants;
- connect a real bank;
- move money.

The next safe persistence step is a server-only replay-safe store/RPC draft that accepts this scoped plan, persists provider scopes independently, and inserts one separately bound global context atomically or with an explicit recoverable transaction protocol.

That future store must be validated only in non-production first.

## Scenario coverage

The preview-only scenario proves:

- Bank A and Bank B keep independent provider-scoped writes;
- no synthetic provider identity appears;
- one global context binds both provider scopes;
- global revision is SHA-256 based;
- provider input order does not change plan identity;
- stale remote-provider data retains structural context but forces DEGRADED;
- incomplete global coverage still plans provider ingestion while suppressing global context;
- provider-scoped Ledger identities remain distinct.

## Release boundary

PR #58 remains draft / post-RC1 / **DO NOT MERGE** until EOS 4.0 RC1 closes Auth/E2E/Worker Gate/payments/security/rollback gates.
