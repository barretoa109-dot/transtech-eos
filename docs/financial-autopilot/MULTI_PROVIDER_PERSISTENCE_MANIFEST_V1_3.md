# Financial Autopilot — Multi-Provider Persistence Manifest v1.3

> Post-RC1 design-only persistence hand-off. This manifest writes nothing and does not modify the production database.

## Why it exists

Multi-provider Zero Entry can now reason across several banks/cards without losing provider provenance. The existing persistence builder, correctly, refuses those results because its canonical ingestion contract is scoped to one `providerKey`.

The next layer needs a deterministic hand-off between:

- original provider snapshots;
- provider-scoped canonical Ledger identities;
- trusted global source coverage;
- the exact multi-provider Zero Entry result.

`buildMultiProviderPersistenceManifest` provides that hand-off without inventing a synthetic provider and without executing any write.

## Manifest structure

The manifest contains:

- trusted owner;
- one deterministic provider scope per original provider snapshot;
- provider snapshot SHA-256 fingerprint;
- opaque account source refs;
- provider-scoped canonical Ledger keys;
- provider scope fingerprint;
- provider-preserving analysis fingerprint;
- global source-coverage fingerprint;
- source orchestration fingerprint;
- global Zero Entry result fingerprint;
- `globalContextEligible`;
- final manifest SHA-256 fingerprint.

## Provider-scoped identity

Each provider scope is generated from the original provider snapshot. Ledger identities use the existing canonical rule:

`providerKey + connectionId + externalAccountId + externalTransactionId/sourceEventId`

Therefore a transaction from Bank B cannot be silently persisted under Bank A merely because the global analysis considered both.

Account and Ledger material are canonicalized before snapshot hashing, so connector array ordering does not define persistence identity.

## Result binding

The manifest recomputes global source orchestration from the supplied bundles + closure and requires it to match the supplied multi-provider Zero Entry result.

A substituted or stale result fails with:

`financial_multi_provider_manifest_orchestration_mismatch`

The global result fingerprint commits to:

- multi-provider analysis scope;
- source orchestration identity;
- source coverage identity;
- resolved safety inputs;
- primary horizon;
- Financial Context status;
- Available Real safe amount;
- minimum projected cash/time;
- confidence;
- first material forecast risk.

## Global context eligibility

`globalContextEligible` means the source set has a structurally valid global closure and orchestration identity. It does **not** mean the context is SAFE.

A complete source set may still be stale, low-confidence or economically stressed. Those conditions remain represented by the Financial Context status and hard safety gates.

When global coverage is incomplete, a future system may still persist raw provider-scoped ingestion safely, but it must not persist/serve an authoritative global SAFE context from that manifest.

## What still does not happen

The manifest is not a database persistence plan.

It does not:

- call Supabase;
- invoke the existing v1/v1.1/v1.2/v1.3 RPCs;
- merge provider snapshots;
- create a synthetic provider key;
- write global context rows;
- move money.

The existing single-provider persistence builder continues to hard-reject `analysisScope = "multi_provider"`.

## Next persistence generation

A future provider-scoped multi-plan can use this manifest as its integrity root:

1. persist each original provider's connection/account/ingestion/Ledger rows under its own provider + connection identity;
2. persist cross-provider reconciliation/recurrence/obligation evidence using canonical Ledger keys from all scopes;
3. persist one global Financial Context whose revision commits to the manifest + global safety evidence;
4. replay the exact same manifest idempotently and reject conflicting replay;
5. validate owner isolation, rollback and service-role-only execution in non-production PostgreSQL/Supabase before any rollout.

No production schema or RPC for that generation has been applied.

## Production boundary

PR #58 remains draft / post-RC1 / **DO NOT MERGE** until EOS 4.0 RC1 release gates close.

No production financial table, RPC, provider credential, n8n/Worker Gate path or money movement is changed by this work.
