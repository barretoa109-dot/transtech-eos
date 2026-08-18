# Financial Autopilot — Multi-Provider Analysis v1.3

> Post-RC1 design/implementation contract. This layer is analysis-only and does **not** change production persistence or connect real financial providers.

## Why this layer exists

Financial Autopilot can only become truly zero-entry when EOS can reason across multiple banks, cards, wallets and lenders at once.

The existing `FinancialConnectorSnapshot` intentionally carries one `providerKey`. That is correct for provider-scoped ingestion and persistence, but it means Bank A + Bank B must never be flattened into a fake synthetic provider before canonical persistence.

`buildProviderPreservingFinancialAnalysisView` solves the analysis side while keeping provider provenance explicit.

## Contract

Input:

- server-derived `trustedUserId`;
- one or more provider snapshots;
- trusted server time.

Output:

- deterministic combined account array;
- deterministic combined ledger array;
- explicit provider scopes;
- account -> provider origin mapping;
- ledger -> provider origin mapping;
- oldest/newest provider fetch timestamps;
- SHA-256 `analysisFingerprint` over the exact provider-scoped analysis material.

No synthetic `providerKey` is created.

## Hard integrity rules

The view fails closed when:

- trusted user is missing;
- there is no provider snapshot;
- provider key is empty or non-canonical;
- provider `fetchedAt` is invalid or more than five minutes in the future;
- account or ledger ownership differs from the trusted user;
- account IDs collide across snapshots;
- ledger IDs collide across snapshots;
- a ledger row points to an account outside its own provider snapshot;
- the same provider-scoped account identity appears twice;
- the same provider + connection + external-account transaction source appears twice.

These rules prevent cross-provider ID collisions and overlapping snapshot windows from silently double-counting money.

## Determinism

Provider scopes, account origins and ledger origins are sorted before the aggregate fingerprint is produced.

Reversing provider snapshot input order therefore cannot change:

- provider scope output;
- account/ledger origin output;
- `analysisFingerprint`.

The fingerprint commits to full analysis-relevant account and ledger material plus provider provenance. If a stale timestamp, balance, transaction, category or description changes analysis material, the fingerprint changes.

## Global Source Orchestration

`orchestrateTrustedGlobalFinancialSources` couples two previously separate questions:

1. **Coverage:** does trusted evidence prove EOS knows the material source set?
2. **Analysis:** what exact provider snapshots are EOS reasoning over?

The orchestration fingerprint commits to:

- trusted owner;
- global source-coverage fingerprint;
- independent closure fingerprint;
- exact leaf inventory fingerprints;
- provider-preserving analysis fingerprint.

This prevents a caller from proving coverage over providers A+B while analyzing a different provider set A+C.

If global coverage is structurally incomplete, `orchestrationFingerprint = null`.

Freshness remains independent. A complete-but-stale source set can retain a structural orchestration identity, but the stale analysis material changes the analysis/orchestration fingerprints and financial safety still becomes DEGRADED.

## Multi-provider Zero Entry

`buildZeroEntryFinancialAutopilotFromGlobalSources` now consumes the global source orchestration directly.

It runs the existing Zero Entry intelligence across the combined provider-preserving account/Ledger view:

- reconciliation;
- recurrence detection;
- behavioral patterns;
- inferred obligations;
- variable essential spend;
- confirmed-income horizon;
- usable liquidity;
- Available Real;
- 30/60/90 forecast;
- Next Best Financial Action.

The returned result is explicitly marked:

`analysisScope = "multi_provider"`

and carries the global `sourceOrchestrationFingerprint`.

Coverage and freshness flow through the same hard safety gates as single-provider Zero Entry. Therefore a stale card at Bank B can degrade a context even when liquid cash at Bank A is perfectly fresh, and an incomplete Bank B inventory cannot produce SAFE.

## Persistence boundary is now executable

The existing v1 persistence builder still accepts one `FinancialConnectorSnapshot`, because canonical ingestion identity is provider-scoped.

It now explicitly rejects any Zero Entry result marked `analysisScope = "multi_provider"` with:

`financial_multi_provider_requires_scoped_persistence`

This check executes before provider-scoped persistence planning. It prevents a developer from accidentally passing a global result together with Bank A's snapshot and persisting Bank B-derived analysis under Bank A's provider identity.

The v1.1/v1.2/v1.3 persistence builders inherit this rejection because they layer on top of the v1 builder.

The next persistence step is not a synthetic merged snapshot. It must be a provider-scoped multi-plan design that writes each original provider snapshot under its original provider + connection identity and commits one separately bound global context.

## Scenario coverage

Preview-only scenarios prove:

- two providers combine without losing provenance;
- reversed provider order produces the same analysis identity;
- explicit oldest/newest fetch windows are retained;
- duplicate account IDs fail closed;
- duplicate ledger IDs fail closed;
- ledger rows cannot jump provider account scope;
- duplicate provider-scoped accounts fail closed;
- duplicate provider transaction sources fail closed;
- cross-user account data fails at the security boundary;
- future snapshot skew beyond five minutes fails closed;
- global coverage and analysis are bound into one orchestration identity;
- incomplete coverage cannot produce a trusted orchestration fingerprint;
- multi-provider Zero Entry can reach normal SAFE/NO_ACTION product semantics when evidence is complete/fresh;
- stale non-liquidity provider evidence degrades that result;
- incomplete scoped-provider evidence cannot claim global SAFE;
- single-provider v1 persistence rejects the multi-provider result before flattening can occur.

The scenarios are included in the internal preview-only Financial Autopilot smoke route.

## Production boundary

No production DB migration or RPC change is introduced here.

No provider credentials, real bank data, n8n/Worker Gate change or money movement is introduced.

PR #58 remains draft / post-RC1 / **DO NOT MERGE** until the EOS 4.0 RC1 gates are closed.
