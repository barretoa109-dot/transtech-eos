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

The complete preview-only Financial Autopilot smoke route now contains 38
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

The PostgreSQL 17 suite now proves 26 guarantees: the prior 22 plus four
independent coverage-evidence persistence invariants. The SQL remains a
non-production draft.

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

## Sanitized server read model

`SupabaseSourceOnboardingReader` reads the active onboarding commit only on the
server and validates every boundary before producing UI state:

- the trusted EOS user is bound before the query;
- only the active owner-scoped row is requested;
- consent and inventory payloads are parsed as untrusted data;
- both canonical fingerprints are recomputed;
- cross-user and malformed responses fail closed;
- database errors expose only their stable code;
- provider secrets, raw transactions and RPC receipts are never selected.

`resolveSourceOnboardingReadModel` additionally requires an independent
`TrustedSourceCoverageResolution`. A persisted inventory alone can never
self-promote to `COVERAGE_READY`; absent coverage remains `DISCOVERING`, and
onboarding still cannot assert financial safety. The reader is exported only
from the server entry point; the browser receives only its sanitized model.

## Authenticated feature-gated wiring

`EOS_FINANCIAL_ONBOARDING_V1_ENABLED=true` is now the only live activation
switch. It defaults off and must equal the exact string `true`.

When enabled, the EOS Finanzas Server Component:

1. obtains the user with Supabase Auth `getUser()`;
2. creates the service-role client only on the server;
3. constructs an owner-bound `SupabaseSourceOnboardingReader`;
4. passes the same session identity into the authenticated resolver;
5. renders only the sanitized onboarding model.

No caller-selected user ID exists. Missing sessions are rejected, two-user
scenarios prove independent owner-bound reads, and any reader failure produces a
zero-safety `REFRESH_REQUIRED` model. Because no independently persisted
coverage resolver is wired yet, a valid stored inventory remains `DISCOVERING`.
The live UI action also remains disabled; this block adds no browser mutation.

## Independent coverage evidence

`SourceCoverageEvidenceV1` is a separate, expiring commitment bound to the exact
trusted inventory fingerprint. It records completeness, freshness, connected /
missing / stale counts and normalized reason codes without storing transactions
or provider credentials.

The builder rejects inconsistent counts, false completeness, freshness
contradictions, inventory substitution and invalid validity windows. The
PostgreSQL RPC independently recomputes the fingerprint, makes exact replay a
no-op and is executable only by `service_role`; its table is unavailable to
`PUBLIC`, `anon` and `authenticated`.

The authenticated Server Component now reads only current evidence for the same
user and inventory fingerprint. Valid complete+fresh evidence may transition
the UI to `COVERAGE_READY`; missing, expired or mismatched evidence remains
fail-closed. This authorizes baseline construction only—never `SAFE` and never
money movement.

## Still excluded

- real banking/provider integration;
- OAuth token or provider-secret storage;
- a deployed consent-write route or active onboarding button;
- production schema or RPC changes;
- n8n/Worker Gate changes;
- prepare/approve/execute monetary commands;
- money movement.

## Authenticated two-user database E2E

`npm run test:financial-onboarding:e2e` exercises persistence, server-only
readers and authenticated orchestration against an isolated PostgreSQL 17
database. Two deterministic users prove valid, absent, expired,
cross-inventory and cross-user evidence behavior. Valid evidence may enable
baseline construction but never `SAFE`; every other case remains fail-closed.
The suite also verifies that the `authenticated` database role cannot access
the internal tables or evidence persistence RPC.

This is a hermetic database E2E, not a claim that Supabase Auth HTTP,
PostgREST or a production project was exercised. Those external integration
gates remain post-RC1.
