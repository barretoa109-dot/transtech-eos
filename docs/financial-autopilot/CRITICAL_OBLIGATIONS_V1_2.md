# Financial Autopilot — Critical Obligations Completeness v1.2

> Post-RC1 design/implementation track. Do **not** apply the v1.2 SQL draft to Supabase production while EOS 4.0 RC1 remains frozen.

## Why v1.2 exists

`obligationCompleteness` is a useful confidence score, but a score is not the same thing as the hard boolean required to claim financial safety.

For a user-facing `SAFE`, EOS must know explicitly whether the set of critical obligations required by the current Financial Context is complete enough to protect. v1.2 therefore persists:

`criticalObligationsComplete: boolean`

The hard rule is:

`criticalObligationsComplete = false => persisted context must be DEGRADED`

A high confidence score can never override this boolean.

## Identity chain

v1.2 is layered without weakening the prior contracts:

`v1 base fingerprint -> v1.1 first-forecast-risk fingerprint -> v1.2 critical-obligations completeness fingerprint`

The completeness signal also gets a compact SHA-256 explanation commitment bound to the existing aggregate `context-integrity:` commitment. This lets the v1.2 read boundary detect stored-boolean drift without exposing raw Ledger evidence.

## Read behavior

`SupabaseFinancialStateReaderV1_2` first delegates to the v1.1 reader, preserving:

- owner isolation;
- aggregate context integrity;
- first forecast risk validation;
- material protected-obligation identity checks;
- no raw Ledger read for Financial State.

It then reads `critical_obligations_complete` using the same trusted `usuario_id` and exact context `revision`.

Outcomes:

- explicit `true`: the v1.1 state may continue if all other gates pass;
- explicit `false`: the read projection is forced to `DEGRADED` and cannot assert Available Real;
- missing/malformed boolean: fail closed;
- boolean/commitment mismatch: fail closed;
- cross-user read: blocked before the trusted read path.

## Write behavior

`buildFinancialPersistencePlanV1_2` obtains the boolean from the zero-entry engine's resolved hard input, not from a browser field and not by re-deriving it from confidence.

The v1.2 persistence upgrader rejects any plan that attempts to persist:

`SAFE | ATTENTION | ACTION_REQUIRED + criticalObligationsComplete=false`

The SQL wrapper draft enforces the same relation before invoking the v1.1 persistence function, so an inconsistent batch is rejected before the base snapshot write.

## Rollout boundary

The production Financial State endpoint still requires the primary exact-`true` server flag:

`EOS_FINANCIAL_STATE_V1_ENABLED=true`

v1.2 has an independent, secondary exact-`true` rollout flag:

`EOS_FINANCIAL_STATE_V1_2_ENABLED=true`

The secondary flag does not expose the Financial State surface by itself. It only selects the stricter v1.2 reader after the primary API is already enabled.

If v1.2 is enabled before the required database column exists, the read fails closed with the normal sanitized 503 path. It never silently falls back to v1.1.

## Required non-production promotion tests

Before enabling v1.2 anywhere that matters, validate on an isolated Supabase/Postgres environment:

1. fresh insert with `true`;
2. fresh `DEGRADED` insert with `false`;
3. reject non-DEGRADED + `false` before base persistence;
4. exact replay idempotency;
5. conflicting same-revision replay rejection;
6. missing/malformed boolean rollback;
7. owner + revision scoped read;
8. boolean/commitment drift rejection;
9. `false` always projects `DEGRADED`, `canAssertSafety=false`, `availableRealMinor=null`;
10. service-role-only RPC execution and cross-user isolation;
11. rollback rehearsal.

## Production boundary

This v1.2 work does not authorize or perform:

- Supabase production schema changes;
- real bank credentials or connectors;
- autonomous money movement;
- n8n/Worker Gate changes;
- merging Financial Autopilot into EOS 4.0 RC1.
