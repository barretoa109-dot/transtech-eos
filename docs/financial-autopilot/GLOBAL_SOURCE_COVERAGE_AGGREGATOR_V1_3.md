# Financial Autopilot — Global Source Coverage Aggregator v1.3

> Post-RC1 design/implementation contract. This does **not** authorize production rollout, database migration, real bank credentials or money movement.

## Purpose

A single provider can prove what it knows about one connection or institution. It cannot, by itself, prove that EOS knows the user's complete financial source set.

The Global Source Coverage Aggregator combines several independently scoped inventories and only produces global coverage when a separate trusted closure binds the exact inventory set.

The intended product sequence is:

`provider/institution discovery -> scoped inventory fingerprints -> independent global closure -> global coverage commitment`

## Inputs

The aggregator receives:

- a server-derived `trustedUserId`;
- one or more `{ snapshot, inventory }` bundles;
- a `TrustedGlobalSourceClosure`;
- trusted server time.

Each bundle keeps its own provider identity and source refs. The aggregator does not flatten provider identity into one fake connector.

## Scoped leaf validation

Each leaf is validated through the existing v1.3 source-coverage resolver.

A `provider_connection` or `institution` inventory is locally acceptable only when its sole coverage failure is the expected `inventory_scope_insufficient` reason. Any other condition — missing material source, stale/invalid inventory window, weak evidence, duplicate identity, unresolved material hint or ownership mismatch — makes the leaf unsuitable for global closure.

A `global_user_finances` leaf is acceptable only when it independently satisfies the existing global scope + authority rules.

Freshness stays separate. A locally complete leaf may be stale; this preserves the invariant:

`criticalSourcesComplete = true` does not imply `criticalSourcesFresh = true`.

## Independent global closure

`TrustedGlobalSourceClosure` contains:

- owner;
- `asOf` / `validUntil`;
- authority;
- confidence;
- explicit `confirmsNoOtherMaterialSources` boolean;
- the exact sorted set of leaf inventory SHA-256 fingerprints it closes over.

Allowed closure authority is deliberately narrower than provider discovery:

- `user_confirmed`;
- `verified_document`.

A provider cannot act as the independent global closer for its own discovery.

The closure must be current, sufficiently confident, explicitly exhaustive and bind the exact leaf fingerprint set. Missing, extra or duplicate fingerprints fail closed.

The closure also cannot pre-date evidence it claims to close. Its `asOf` must be greater than or equal to the latest bound leaf inventory `asOf`. This prevents a historical user/document assertion from being replayed as if it had certified provider evidence discovered later.

## Global identity

The closure receives its own SHA-256 fingerprint over:

- contract version;
- owner;
- canonical time window;
- authority;
- confidence;
- exhaustiveness assertion;
- exact sorted leaf fingerprint set.

The final global source-coverage fingerprint then commits to:

- trusted owner;
- closure fingerprint;
- sorted leaf inventory fingerprints;
- shortest trusted coverage validity window.

Provider/account display data is not included in the public result.

## Overlap and ambiguity

The aggregator rejects overlapping source identities across leaf inventories.

This is conservative by design. Two scoped inventories that claim the same provider-scoped source identity may represent overlapping discovery domains or accidental double counting. Until an explicit deduplication contract exists, EOS must fail closed rather than silently count the source twice.

Duplicate leaf inventory fingerprints also fail closed.

## Lifetime

Global coverage validity is the earliest of:

- closure `validUntil`;
- every accepted leaf inventory `coverageValidUntil`.

Therefore global evidence can never outlive any trusted component that justified it.

## Provider-preserving orchestration

`buildProviderPreservingFinancialAnalysisView` combines accounts and Ledger rows for analysis while retaining explicit provider origin for every account and transaction. It rejects global ID collisions, provider-scoped account duplication, duplicate transaction-source identity and cross-provider account jumps instead of inventing a synthetic provider.

`orchestrateTrustedGlobalFinancialSources` binds the exact global coverage commitment to the exact provider-preserving analysis fingerprint. This prevents a caller from proving coverage over provider set A+B and then analyzing a different set A+C.

A structurally incomplete global coverage result cannot produce an orchestration fingerprint. Complete-but-stale coverage may retain structural identity, but freshness remains independently unsafe and changes the provider analysis/orchestration material.

## Global Zero Entry is now wired

`buildZeroEntryFinancialAutopilotFromGlobalSources` now consumes that orchestration directly.

It runs reconciliation, recurrence/pattern inference, obligations, essential spend, confirmed-income horizon, liquidity, Available Real, 30/60/90 forecasting and Next Best Financial Action across the provider-preserving combined view.

The result is explicitly marked `analysisScope = "multi_provider"` and carries the source orchestration fingerprint.

A stale non-liquidity source at one provider still forces the normal freshness degradation. An incomplete scoped inventory forces `criticalSourcesComplete = false`, so global Zero Entry cannot claim SAFE.

## Persistence boundary

The existing v1 persistence builder remains intentionally single-provider and now hard-rejects multi-provider Zero Entry results before any persistence plan can be built:

`financial_multi_provider_requires_scoped_persistence`

That prevents Bank B-derived analysis from being flattened under Bank A's `providerKey`.

`buildMultiProviderPersistenceManifest` now provides the next design-only hand-off. It binds original provider snapshots, provider-scoped canonical Ledger identities, global source orchestration and the exact global Zero Entry result into one deterministic manifest. It writes nothing.

See:

- `MULTI_PROVIDER_ANALYSIS_V1_3.md`;
- `MULTI_PROVIDER_PERSISTENCE_MANIFEST_V1_3.md`.

The next actual persistence generation must write each original provider scope independently and one separately bound global context. No synthetic merged provider snapshot is allowed.

## Scenario coverage

The preview-only scenarios now prove:

- multiple provider-scoped inventories require an independent global closure;
- global coverage identity is order-independent;
- closure cannot pre-date the evidence it binds;
- stale known sources keep coverage complete but freshness false;
- incomplete leaf coverage fails global closure;
- provider authority cannot impersonate the independent global closer;
- overlapping source identities fail closed;
- multi-provider analysis preserves provider origin and rejects double-counting identities;
- global coverage + provider analysis are committed into one orchestration identity;
- global Zero Entry can reach normal SAFE/NO_ACTION semantics when evidence is complete/fresh;
- stale/incomplete provider evidence degrades global Zero Entry;
- single-provider persistence rejects a global result before flattening;
- the persistence manifest binds the exact provider scopes and global result and rejects result substitution.

The scenarios are included in the preview-only Financial Autopilot smoke route.

## Production boundary

No production schema/RPC change is introduced by this aggregator, orchestration, global Zero Entry analysis or persistence-manifest layer.

No real provider connection is added. No production Supabase financial table is written. No autonomous financial action or money movement is introduced.

The PR remains post-RC1, draft and **DO NOT MERGE** until the EOS 4.0 RC1 release gates are closed.
