# Financial Autopilot — Critical Source Coverage v1.3

> Post-RC1 design/implementation contract. Do **not** apply the v1.3 SQL draft to production while EOS 4.0 RC1 remains frozen.

## Why this exists

Source freshness and source coverage answer different questions:

- **Freshness:** are the critical sources EOS already knows about current enough?
- **Coverage:** does EOS know the material source set is complete enough to claim financial safety?

A fresh checking account does not prove that the user has no second bank account, credit card, loan, wallet, payroll source or other material financial source outside the current context.

Therefore:

`sourcesFresh = true` does **not** imply `criticalSourcesComplete = true`.

## Hard safety rule

For the v1.3 path:

`criticalSourcesComplete = false => Financial Context must be DEGRADED`

Consequences:

- no SAFE assertion;
- `Disponible Real` is not exposed as safe;
- `canAssertSafety = false`;
- first forecast risk is not presented as an authoritative current projection;
- user-facing attention resolves to `CONNECTION_REQUIRED` under the existing Financial State v1 contract.

This is deliberately fail-closed. EOS may be conservative while source coverage is unresolved; it must not be confidently wrong.

## Trusted Source Coverage Resolver

`criticalSourcesComplete` is no longer accepted by Zero Entry as a free-standing caller boolean.

Zero Entry receives:

- a server-derived `trustedUserId`;
- the current provider snapshot;
- a versioned `TrustedFinancialSourceInventory` produced by a trusted discovery/coverage layer.

The resolver derives the boolean from evidence.

The inventory includes:

- owner;
- `asOf` and `validUntil`;
- trusted authority (`user_confirmed`, `provider_discovery` or `verified_document`);
- whether discovery itself completed;
- inventory confidence;
- unresolved material-source hint count;
- expected source identities with materiality and confidence.

A source identity is opaque:

`fin-source:<sha256>`

Its SHA-256 material is scoped by trusted user + provider + connection + external account identity. Display names, account numbers and provider payloads are not used as matching keys and are not exposed to Financial State/Surface.

## Resolution rules

Coverage can resolve `true` only when all of the following hold:

1. snapshot and inventory ownership match the trusted server-side user;
2. inventory structure and time window are valid;
3. inventory authority is trusted;
4. discovery completed;
5. inventory confidence meets the hard threshold;
6. no unresolved material-source hint remains;
7. expected and connected source identities are unambiguous;
8. material expected-source evidence meets its confidence threshold;
9. every `critical` or `material` expected source is connected under an authoritative own/joint identity.

Missing `optional` sources do not block coverage.

A source with `external` or `unknown` ownership cannot satisfy material coverage. A source under a different provider/connection/account scope cannot satisfy the expected identity either.

Absence of another source is never interpreted as proof that another source does not exist.

## Fresh but incomplete example

A user may have one checking account that is fully synchronized and fresh. If the trusted inventory also expects a material card that is not connected, then:

- `sourcesFresh = true` for the known checking account;
- `criticalSourcesComplete = false` because the material card is missing;
- Financial Context becomes `DEGRADED`;
- EOS does not expose `Disponible Real` as safe.

This is covered by the Zero Entry and source-coverage scenarios.

## Coverage evidence identity and lifetime

The trusted inventory produces an internal SHA-256 `inventoryFingerprint` and a coverage validity window.

Zero Entry carries both into resolved safety inputs. For v1.3 persistence:

- the compact coverage fingerprint/lifetime become `source-coverage-evidence:<sha256>`;
- the critical-source completeness commitment binds to that evidence ref;
- changing evidence changes the v1.3 context revision;
- a SAFE v1.3 context cannot be persisted without a valid coverage fingerprint and future validity window;
- context `validUntil` is capped so it cannot outlive the trusted coverage evidence that justified SAFE.

The raw expected-source inventory is not persisted into the user-facing Financial State contract.

## Persistence chain

v1.3 layers on top of the existing isolated contracts:

`v1 base -> v1.1 first forecast risk -> v1.2 critical obligations -> v1.3 critical sources`

The v1.3 context revision commits to:

- the v1.2 context fingerprint;
- aggregate context integrity evidence;
- the v1.2 critical-obligation completeness commitment;
- the source-coverage evidence commitment;
- the derived `criticalSourcesComplete` boolean.

## Read boundary

`SupabaseFinancialStateReaderV1_3`:

1. reads the v1.2 context first;
2. reads `critical_sources_complete` scoped by trusted `usuario_id` + exact context `revision`;
3. requires the persisted source-coverage evidence commitment;
4. validates the critical-source SHA-256 commitment against the persisted explanation refs;
5. fails closed on missing, malformed, tampered or unreadable data;
6. forces DEGRADED when the persisted derived value is false.

No raw Ledger or ingestion row is required for this user-facing read.

## Rollout gates

The production API remains dark unless `EOS_FINANCIAL_STATE_V1_ENABLED=true`.

The v1.3 reader is selected only when both layered switches are enabled:

- `EOS_FINANCIAL_STATE_V1_2_ENABLED=true`
- `EOS_FINANCIAL_STATE_V1_3_ENABLED=true`

v1.3 cannot bypass v1.2. If a required v1.3 database field is missing after the flag is enabled, the read fails closed; there is no silent downgrade to a less strict reader.

Both `/api/finance/state` and `/dashboard/finanzas` select the same strictest enabled reader generation.

## Production boundary

`PERSISTENCE_CRITICAL_SOURCES_V1_3_DRAFT.sql` remains design-only.

The Trusted Source Coverage Resolver currently uses fixtures/contracts only. It does not connect to a real bank, aggregator or provider and does not move money.

Before promotion, the v1.3 path must pass non-production PostgreSQL/Supabase validation for fresh insert, exact replay, conflicting replay, rollback, owner isolation, service-role-only execution, malformed values, missing values, coverage-evidence lifetime and the invariant that fresh-known-but-incomplete coverage never becomes SAFE.
