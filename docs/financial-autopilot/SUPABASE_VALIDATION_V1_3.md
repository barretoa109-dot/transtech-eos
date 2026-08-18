# Financial Autopilot v1.3 — Supabase non-production validation

Date: 2026-08-16

Environment: temporary Supabase Free project, PostgreSQL 17.6, `pgcrypto`

Production project: untouched

Final environment status: `INACTIVE` (paused immediately after validation)

Release state: design/post-RC1, PR #58 remains draft and **DO NOT MERGE**

## Outcome

The atomic multi-provider persistence stack passed the required real-Supabase
validation. This result proves the database transaction, replay and access
contracts in an isolated environment. It does not authorize production rollout
while the EOS 4.0 RC1 freeze remains active.

| Gate | Result | Evidence |
|---|---|---|
| Full draft stack on PostgreSQL 17 | PASS | All seven ordered SQL files loaded on PostgreSQL 17.6. |
| TypeScript/PostgreSQL fingerprint parity | PASS | Both implementations returned `e2887f3704951efc5f0f4e938cf251e18ae3f68cd190c7f5d133e721957a100f` for the canonical fixture. |
| Two-session same-user concurrency | PASS | Two simultaneous service-role sessions returned one fresh write and one exact replay. |
| Exact replay | PASS | Fresh call touched 2 provider scopes, 2 ingestion events and 2 Ledger rows; replay touched 0/0/0. |
| Atomic final state | PASS | Exactly 2 scopes, 2 events, 2 Ledger rows, 1 context, 1 global commit and 1 plan receipt existed. |
| Service-role PostgREST call | PASS | A temporary validation Edge Function used Supabase's internally injected service role; PostgREST returned HTTP 200 and the expected replay response. No key was returned or persisted in the repository. |
| Anonymous PostgREST denial | PASS | HTTP 401, SQLSTATE `42501`, permission denied for the RPC. |
| Authenticated PostgREST denial | PASS | A synthetic confirmed user received a real JWT; PostgREST returned HTTP 403, SQLSTATE `42501`. The synthetic user was deleted immediately. |
| Receipt-table isolation | PASS | `anon` and `authenticated` received SQLSTATE `42501`; privilege inspection showed only `service_role` can execute the RPC. |
| Cross-user substitution | PASS | A service-role call with a different trusted user failed with SQLSTATE `42501` before mutation. |
| Forced late-provider failure | PASS | A temporary trigger failed provider B after provider A began. Connections, accounts, scopes, events, Ledger, contexts, commits and plan receipts all remained at zero. |
| Forced final-commit failure | PASS | A temporary trigger failed the final marker insert. All eight persistence counts remained at zero, including the context and plan receipt. |
| Migration down rehearsal | PASS | The rollback removed 12 tables, the public RPC and `eos_private`; it preserved Auth and the shared `pgcrypto` extension. |
| Migration up rehearsal | PASS | The seven SQL files reapplied cleanly after rollback and a fresh two-provider write succeeded. |
| Security Advisor | PASS WITH EXPLICIT DISPOSITION | No browser-executable RPC or readable server receipt was found. Remaining `RLS enabled/no policy` INFO notices are deliberate deny-by-default internal tables with browser grants revoked. The temporary project's leaked-password setting is project Auth configuration, not part of this database draft. |
| Performance Advisor | PASS | Missing-FK-index and per-row `auth.uid()` notices were corrected. Remaining notices are only `unused_index` INFO findings expected in a newly created validation database without production workload. |

## Advisor-driven hardening

`SCHEMA_V1_DRAFT.sql` was strengthened during this validation:

- added direct indexes for all foreign-key columns reported by the Performance
  Advisor;
- changed browser-readable RLS ownership checks to cache
  `(select auth.uid())` once per statement;
- retained deliberate no-policy/server-only tables instead of adding browser
  access merely to silence informational lint output.

Supabase references:

- [RLS policy lint](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Foreign-key index lint](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- [RLS initialization-plan lint](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

## Rollback artifact

`PERSISTENCE_STACK_V1_3_ROLLBACK_DRAFT.sql` is the rehearsed, fail-closed
rollback. It intentionally uses no `CASCADE`; an unknown dependency must stop
the operation for review instead of being removed silently.

## Remaining production boundary

The technical Supabase validation gates for this draft are complete. Production
still requires all of the following independent approvals:

1. EOS 4.0 RC1 freeze closed;
2. production migration reviewed from the final draft diff;
3. backup/restore and operational rollback owner assigned;
4. explicit production deployment approval;
5. post-deployment advisors and smoke tests repeated before any real provider or
   financial data is enabled.

Until then, the RPC remains unwired and the SQL remains design-only.
