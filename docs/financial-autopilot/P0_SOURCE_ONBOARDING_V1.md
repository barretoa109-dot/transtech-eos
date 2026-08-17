# Financial Autopilot — P0 Source Onboarding v1

> Post-RC1 read-only contract. This block does not connect a real institution,
> store provider credentials, apply production SQL or authorize money movement.
> PR #58 remains draft and **DO NOT MERGE** during the EOS 4.0 RC1 freeze.

## Product outcome

The onboarding contract implements the first two days of the 30-day journey:

1. the user authorizes read access once;
2. EOS discovers accounts, cards and liabilities;
3. EOS asks for only one missing material source when necessary;
4. complete and fresh coverage allows baseline construction;
5. onboarding never claims financial safety.

This keeps the user out of bookkeeping. During discovery the only user-facing
message is that EOS is working; no manual account list, category setup or budget
form is required.

## Consent boundary

`FinancialReadConsentV1` binds the trusted EOS user, provider, validity window
and the exact required read scopes to a canonical SHA-256 fingerprint.

The required scopes are:

- accounts read;
- balances read;
- transactions read;
- liabilities read.

The contract fixes `movementAuthority = false`. Read consent and money-movement
authority are separate capabilities and cannot be combined by this pilot.
Expired, revoked, cross-user, incomplete or fingerprint-tampered consent fails
closed to `CONSENT_REQUIRED`.

## Deterministic experience

| State | EOS behavior | User action |
| --- | --- | --- |
| `CONSENT_REQUIRED` | Explains read-only access | Authorize reading |
| `DISCOVERING` | Finds material financial sources | Nothing |
| `SOURCE_REQUIRED` | Explains one missing material source | Connect that source |
| `REFRESH_REQUIRED` | Identifies stale coverage | Refresh connection |
| `COVERAGE_READY` | Starts reconciliation and baseline | Nothing |

`mayBuildBaseline` becomes true only for complete and fresh trusted coverage.
`mayAssertSafety` is always false because onboarding evidence is necessary but
not sufficient for `SAFE`.

## Scenario guarantees

The preview smoke scenario proves:

1. consent is read-only and fingerprint-bound;
2. incomplete read scopes are rejected;
3. missing consent creates exactly one authorization action;
4. discovery creates no bookkeeping request;
5. a missing material source blocks the baseline;
6. stale known sources block the baseline;
7. complete, fresh coverage may start the baseline;
8. onboarding never claims safety;
9. cross-user consent fails closed.

The complete preview-only Financial Autopilot smoke route now contains 36
independent scenario groups.

## Server-owned persistence draft

`PERSISTENCE_SOURCE_ONBOARDING_RPC_V1_DRAFT.sql` and
`supabase-source-onboarding-store.ts` persist consent plus its exact trusted
inventory as one versioned commit:

- PostgreSQL recomputes both canonical fingerprints;
- exact replay performs no write;
- updates use expected-version CAS under a per-user advisory lock;
- only one version remains active after an atomic supersession;
- `service_role` is the only executable role;
- the receipt table is inaccessible to `PUBLIC`, `anon` and `authenticated`;
- consent with movement authority is rejected;
- no OAuth token, provider secret or raw banking payload is accepted.

The PostgreSQL 17 suite now proves 22 guarantees: the prior 17 plus five source
onboarding persistence invariants. The SQL remains a non-production draft.

## Read-only preview UI

`FinancialSourceOnboardingCard` renders the five onboarding states inside EOS
Finanzas without exposing persistence or provider internals:

- one calm headline and explanation;
- an accessible 0–100 preparation indicator;
- at most one required action;
- `EOS necesita de ti: Nada` while EOS can keep working alone;
- a permanent read-only/no-money-movement reassurance;
- no account identifiers except an optional user-safe masked label;
- no Ledger rows, provider metadata, fingerprints, tokens or RPC receipts.

The dashboard preview accepts `?onboarding=consent`, `discovering`, `source`,
`refresh` or `ready` only when the existing non-production demo gate is active.
Invalid or production preview parameters fail to `404`. Action buttons are
deliberately disabled and labelled “disponible tras RC1”; no browser write path
exists in this block.

## Still excluded

- real banking/provider integration;
- OAuth token or provider-secret storage;
- a deployed consent-write route or active onboarding button;
- production schema or RPC changes;
- n8n/Worker Gate changes;
- prepare/approve/execute monetary commands;
- money movement.

The next P0 block is a sanitized server read model for the onboarding UI,
followed by authenticated preview E2E. It must not receive provider credentials
or expose persistence RPC access to the browser.
