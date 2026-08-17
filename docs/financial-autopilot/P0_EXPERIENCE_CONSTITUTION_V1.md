# Financial Autopilot — P0 Experience and Constitution v1

> Post-RC1 read-only implementation contract. This block does not authorize a production migration, real provider credential, real financial-data write or money movement. PR #58 remains draft and **DO NOT MERGE** during the EOS 4.0 RC1 freeze.

## Purpose

This block turns the first-30-days journey into two deterministic product contracts:

1. a versioned Financial Constitution for the five rules the user confirms once;
2. an experience state that remains independent from financial safety.

The separation is deliberate:

```text
onboarding complete != Financial Context present != SAFE
```

Only the existing Financial State safety gates can authorize a visible Available Real. The experience layer may decide what EOS or the user needs to do, but it cannot promote financial safety.

## Financial Constitution v1

`lib/financial-autopilot/financial-constitution.ts` defines:

- protected liquidity floor;
- minimum savings rate in basis points;
- debt priority policy;
- primary goal and priority;
- approval threshold;
- explicit autonomy level;
- confirmation timestamp;
- canonical SHA-256 policy fingerprint.

For the read-only pilot:

```text
executionAuthorityMinor = 0
```

Any attempt to build a pilot Constitution with non-zero monetary authority is rejected before persistence. Learned behavior cannot change the fingerprinted policy or its authority.

The contract is compatible with the existing draft table `eos_financial_constitutions_v1`, whose policy payload and fingerprint remain server-owned for mutation and user-readable through RLS only after a reviewed post-RC1 migration.

## Experience state v1

`lib/financial-autopilot/financial-experience.ts` defines progress independently from the economic state:

| Phase | Meaning |
| --- | --- |
| `CONNECTING` | Consent or a critical source is missing |
| `BUILDING_BASELINE` | EOS is ingesting, reconciling or learning the first model |
| `CONSTITUTION_REQUIRED` | The five user policy rules still need confirmation |
| `READY` | EOS can serve the current Financial Surface, including DEGRADED states |
| `PAUSED` | Security, consent or provider integrity has frozen affected autonomy |

It also maps the I0–I4 intervention ladder to exactly one user need:

- `I0`: nothing;
- `I1`: optional calm information;
- `I2`: silent soft adjustment;
- `I3`: Constitution confirmation or one financial decision;
- `I4`: source authorization/repair or security review.

Priority is fail-closed: security pause, missing consent and incomplete source coverage are resolved before baseline, Constitution or financial-status presentation.

## Financial Surface addition

The public surface now carries a sanitized intervention outcome and level. The Web view renders a dedicated North Star field:

> **EOS necesita de ti**
> Nada

When attention is required, the same field contains only the single necessary intervention. Raw Ledger rows, source identifiers, evidence references and provider metadata remain excluded.

## Deterministic validation

`runFinancialExperienceScenario` covers:

1. versioned, fingerprinted and confirmed Constitution;
2. monetary execution fixed to zero;
3. rejection of non-zero execution authority;
4. missing-consent authorization request;
5. incomplete coverage hiding financial safety;
6. silent baseline construction;
7. one-time Constitution confirmation;
8. healthy `READY/I0/NOTHING` state;
9. silent adjustment remaining `I2` and non-interruptive;
10. hard conflict producing `I3/MAKE_DECISION`;
11. DEGRADED producing `I4/REFRESH_CONNECTION` without safety;
12. security pause overriding a healthy surface.

The scenario is part of the preview-only internal Financial Autopilot smoke route. The complete route now contains 34 independent scenario groups.

## Server-owned persistence draft

`PERSISTENCE_CONSTITUTION_RPC_V1_DRAFT.sql` and
`supabase-financial-constitution-store.ts` define the post-RC1 write boundary without
activating it in production:

- the server binds the authenticated EOS user and never accepts a caller-selected owner;
- PostgreSQL recomputes and verifies the canonical policy fingerprint;
- only `service_role` may execute the RPC; `anon`, `authenticated` and `PUBLIC` are denied;
- exact retries are no-ops and return the existing receipt;
- updates use an expected-version compare-and-swap under a per-user advisory lock;
- a successful update supersedes the previous active version atomically;
- `executionAuthorityMinor` must remain zero in both TypeScript and PostgreSQL;
- database error details are not exposed by the adapter.

The PostgreSQL 17 validation suite now exercises 17 guarantees: the original 12
multi-provider invariants plus five Constitution persistence invariants. This is a
draft migration contract only; it has not been applied to Supabase production.

## Still excluded

- Constitution writes from the user interface or any deployed route;
- production application of `eos_financial_constitutions_v1`;
- real connector consent or credential storage;
- prepare/approve monetary commands;
- n8n/Worker Gate changes;
- money movement.

The next P0 block is explicit source-coverage onboarding input and consent-state
orchestration behind the post-RC1 feature gate. It must reuse this domain and
persistence contract and may not relax any current Financial State gate.
