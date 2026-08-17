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

The complete preview-only Financial Autopilot smoke route now contains 35
independent scenario groups.

## Still excluded

- real banking/provider integration;
- OAuth token or provider-secret storage;
- a deployed consent-write route;
- production schema or RPC changes;
- n8n/Worker Gate changes;
- prepare/approve/execute monetary commands;
- money movement.

The next P0 block is the server-owned consent and inventory persistence boundary,
followed by the read-only onboarding UI behind the post-RC1 feature gate.
