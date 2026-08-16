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

## Trusted ownership of the signal

`criticalSourcesComplete` is not inferred from transaction volume, confidence score or the mere absence of another source.

It must be supplied by a trusted source/connection coverage layer. Future evidence may include:

- institution/account discovery from authorized providers;
- explicitly declared critical sources;
- connector/account inventory reconciliation;
- source revocation/disconnection state;
- user-confirmed source coverage when automatic discovery is unavailable.

Learned behavior may help EOS ask the right question, but it does not silently authorize the boolean to become true.

## Persistence chain

v1.3 layers on top of the existing isolated contracts:

`v1 base -> v1.1 first forecast risk -> v1.2 critical obligations -> v1.3 critical sources`

The v1.3 context revision commits to:

- the v1.2 context fingerprint;
- aggregate context integrity evidence;
- the v1.2 critical-obligation completeness commitment;
- the explicit `criticalSourcesComplete` boolean.

The raw source inventory is not exposed through Financial State or Financial Surface.

## Read boundary

`SupabaseFinancialStateReaderV1_3`:

1. reads the v1.2 context first;
2. reads `critical_sources_complete` scoped by trusted `usuario_id` + exact context `revision`;
3. validates its SHA-256 commitment against the persisted explanation refs;
4. fails closed on missing, malformed, tampered or unreadable data;
5. forces DEGRADED when the explicit value is false.

No raw Ledger or ingestion row is required for this user-facing read.

## Rollout gates

The production API remains dark unless `EOS_FINANCIAL_STATE_V1_ENABLED=true`.

The v1.3 reader is selected only when both layered switches are enabled:

- `EOS_FINANCIAL_STATE_V1_2_ENABLED=true`
- `EOS_FINANCIAL_STATE_V1_3_ENABLED=true`

v1.3 cannot bypass v1.2. If a required v1.3 database field is missing after the flag is enabled, the read fails closed; there is no silent downgrade to a less strict reader.

## Production boundary

`PERSISTENCE_CRITICAL_SOURCES_V1_3_DRAFT.sql` is design-only.

Before promotion it must pass non-production PostgreSQL/Supabase validation for fresh insert, exact replay, conflicting replay, rollback, owner isolation, service-role-only execution, malformed values, missing values and the invariant that fresh-known-but-incomplete coverage never becomes SAFE.
