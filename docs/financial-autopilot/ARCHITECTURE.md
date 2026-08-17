# EOS Financial Autopilot v1

Status: product/architecture design, post-RC1 implementation track.

Related issues: #49, #50, #51, #52, #53, #54, #55.

## Product thesis

EOS must reduce financial cognitive load rather than teach users to become financial operators.

**Core principle:** EOS works; the user observes.

The desired steady state is zero-entry: users connect authorized sources once and EOS continuously detects, reconciles, forecasts, protects and decides. Manual entry exists only as a fallback when no reliable automatic source exists.

## North Star experience

A user should be able to open EOS for 10–15 seconds and answer:

1. Am I financially safe?
2. How much money is truly available to use?
3. Does EOS need a decision from me?

Default healthy experience:

- Financial status: `SAFE`
- Available Real: visible
- Commitments: protected
- Reserve: protected
- Goals: on track
- EOS needs from you: nothing

## End-to-end architecture

```text
External Sources
  -> Connector Registry
  -> Consent / Identity / Connection Vault
  -> Ingestion Events
  -> Normalization
  -> Deduplication / Reconciliation
  -> Financial Ledger
  -> Financial Context
  -> Forecast
  -> Available Real
  -> Next Best Financial Action
  -> Autonomy Policy Gate
  -> Financial Action Command
  -> Provider Execution
  -> Post-execution Reconciliation
  -> Learning
```

## 1. Connectivity layer

EOS must stay independent of any single bank or aggregator. Every provider is implemented behind a standardized adapter.

Possible source classes:

- banking APIs / authorized aggregators;
- cards and payment systems;
- accounting/ERP systems;
- payroll;
- email and statements;
- CSV/XLS/PDF imports;
- invoices and debt documents;
- confirmed conversational facts;
- manual fallback.

### Connector capability contract

Each connector declares:

- provider key;
- country;
- connection type;
- supported account/product types;
- available read capabilities;
- execution capabilities if any;
- authorization method;
- refresh model: webhook/polling;
- freshness SLA;
- scopes;
- health;
- version.

Read authorization and money-movement authorization are always separate.

## 2. Ingestion and provenance

External provider payloads never write directly into the final financial truth model.

Every external change first becomes an immutable ingestion event carrying:

- provider and connection;
- external identifiers;
- account/source identifier;
- provider timestamp;
- received timestamp;
- payload hash/fingerprint;
- sync batch/request id;
- provenance;
- confidence/freshness metadata.

This layer enables replay, idempotency, debugging and provider migrations.

## 3. Canonical Financial Ledger

The Financial Ledger is provider-independent and append-oriented.

Core normalized transaction types include:

- income;
- expense;
- internal transfer;
- card payment;
- refund;
- debt draw/payment;
- investment contribution/withdrawal;
- fee;
- tax;
- cash withdrawal/deposit;
- adjustment;
- unknown.

Key product rule: movement of money is not always economic impact.

Examples:

- purchase on card = economic expense;
- payment of that card = settlement, not a second expense;
- transfer between the user's own accounts = internal movement, not expense;
- pending -> posted = transaction evolution, not duplicate spending;
- refund/reversal must link to the original effect where possible.

## 4. Reconciliation engine

The engine reconciles:

- duplicate webhook/poll records;
- pending vs posted;
- own-account transfers;
- card payment against prior purchases;
- refunds;
- reversals;
- recurring-description drift;
- provider retries/callback duplicates.

Corrections preserve evidence and create reconciliation records; they do not silently erase source history.

## 5. Recurrences and obligations

EOS learns stable recurring patterns such as:

- salary;
- rent/mortgage;
- utilities;
- subscriptions;
- loans/installments;
- school/insurance;
- recurring business payments.

Obligations exist independently from ledger movements so EOS can protect money before a debit happens.

Each recurrence/obligation carries amount/range, due date/range, essentiality, confidence, source, status and freshness.

## 6. Financial Constitution

The Financial Constitution defines what “financially safe” means for the user.

Hard constraints can include:

- minimum protected liquidity;
- minimum emergency reserve;
- never-late obligations;
- savings minimum;
- debt rules;
- maximum autonomous action amount;
- permitted accounts/destinations;
- daily/monthly caps;
- action windows;
- autonomy level;
- approval thresholds.

Soft preferences can be learned, but EOS must never convert learned behavior into monetary authorization.

## 7. Financial Context

The conversational/decision brain should consume a compact, versioned Financial Context instead of thousands of raw ledger rows.

Minimum snapshot:

- usable liquidity;
- upcoming liabilities;
- expected income;
- expected essential spend;
- protected reserve;
- critical provisions;
- Available Real;
- minimum projected cash;
- recurrences;
- anomalies;
- affected goals;
- data freshness/completeness;
- confidence;
- source fingerprint/revision;
- generated_at / valid_until.

## 8. Available Real

Primary question:

**How much can the user use without putting anything important at risk?**

Base model:

```text
Available Real Base
= Usable Liquidity
- Protected Commitments within horizon
- Expected Essential Spend
- Protected Reserve
- Critical Provisions
+ Sufficiently Confirmed Income within horizon
```

Then:

```text
Available Real Safe
= max(0, Available Real Base - Uncertainty Buffer)
```

The uncertainty buffer grows when sources are stale, income is unstable, obligations are incomplete, reconciliation quality is low or behavior is highly variable.

Internally EOS may calculate optimistic / expected / safe values. UX defaults to the safe value.

## 9. Forecast

Primary personal horizon: until the next material expected income when confidence is sufficient.

Fallbacks:

- rolling 30 days for unpredictable income;
- 30/60/90 day views for additional planning;
- business cash-cycle horizons for company contexts.

Forecast layers:

1. deterministic obligations;
2. recurring inferred events;
3. behavioral variable spend;
4. hypothetical what-if scenarios.

The base forecast and what-if scenarios must remain separate.

## 10. Financial status

### SAFE
All critical obligations and reserve are protected, no material future cash gap exists, and relevant data is fresh enough.

### ATTENTION
A deviation exists but EOS can safely absorb or adjust it inside policy.

### ACTION_REQUIRED
EOS cannot preserve all hard constraints/goals simultaneously without a user decision.

### DEGRADED
Data freshness/completeness is insufficient to claim safety.

False `SAFE` is considered a critical product failure.

## 11. Next Best Financial Action

The engine should not generate many recommendations. It should usually conclude one of:

- `NO_ACTION` — everything is under control;
- `SILENT_ADJUSTMENT` — EOS adjusted a non-monetary/soft variable safely;
- `INFORM_NO_ACTION` — useful update, no decision required;
- `USER_DECISION_REQUIRED` — user must choose;
- `CONNECTION_REQUIRED` — EOS needs fresh data before giving a material answer.

Default UI shows one next best action, not a list of recommendations.

## 12. Psychological safety

EOS must optimize for tranquility, not app engagement.

Avoid:

- guilt-based language;
- excessive red alerts;
- moral scoring of spending categories;
- notifying every deviation;
- false precision;
- forcing financial education on the user.

Prefer:

- consequences;
- simple states;
- neutral language;
- solutions;
- silence when nothing material needs attention.

## 13. What-if simulator

User questions such as “Can I buy this?” must run against a projected copy of Financial Context.

Simulation returns impact on:

- Available Real;
- reserve;
- upcoming obligations;
- minimum projected cash;
- goals and target dates;
- debt/runway.

The answer explains concrete consequences rather than financial theory.

## 14. Execution model

Money movement uses a separate governed path.

Autonomy progression:

- L0: read-only;
- L1: prepare;
- L2: approve-once;
- L3: policy-bound autopilot;
- L4: advanced chained autopilot.

L3/L4 are never enabled by default.

Every action is an explicit typed Financial Action Command with:

- user ownership derived server-side;
- source account;
- destination ref;
- amount/currency;
- policy snapshot;
- Financial Context revision;
- forecast revision;
- decision ref;
- authorization ref/mode;
- stable idempotency key;
- expiration.

## 15. Pre-execution safety gate

Before every external monetary call, revalidate:

- identity/session;
- connector health and execution scope;
- context freshness;
- active policy and authorization;
- action/daily/monthly limits;
- account and destination permission;
- duplicate/replay status;
- post-action forecast;
- kill switch/circuit breaker status.

Old approval + materially changed context = revalidation and possibly new approval.

## 16. Exact-once money movement

Use Worker Gate principles:

- stable logical command identity;
- stable effect/idempotency key;
- lease/claim before execution;
- identical replay -> same result;
- payload mismatch -> reject;
- never execute governed + legacy path together;
- reconcile ambiguous provider timeouts before retry;
- duplicate callbacks never duplicate Ledger effects.

For providers without native idempotency, EOS must persist the attempt before calling, query/reconcile external state after ambiguity and never retry blindly.

## 17. Kill switch and circuit breakers

Global and per-user execution pause must be server-owned and immediate.

Automatic execution circuit breakers should trigger on provider degradation, inconsistent callbacks, abnormal error rates, reconciliation anomalies, suspicious activity or security incidents.

Read-only operation may continue where safe.

## 18. Post-execution reconciliation

External provider success is not the end of the workflow.

After execution EOS must:

1. persist provider reference;
2. observe/retrieve the actual financial movement;
3. reconcile it against the command;
4. update Ledger;
5. rebuild Financial Context/Forecast;
6. compare expected vs actual outcome;
7. feed Learning;
8. notify only when useful.

## 19. Zero-entry metric

Primary operational product metric:

**Manual Financial Input Rate -> 0**

Supporting metrics:

- % movements ingested automatically;
- manual inputs per user/month;
- classification questions per user/month;
- source freshness;
- reconciliation accuracy;
- forecast error;
- false SAFE count;
- interventions per user/week;
- % successful silent adjustments;
- protected-reserve breaches not anticipated;
- time user spends supervising finances;
- reported financial tranquility.

## 20. Implementation sequence after RC1

### Track 0 — Finish EOS 4.0 RC1
No Financial Autopilot expansion enters the frozen release candidate.

### Track 1 — Read-only foundation
- canonical schema;
- RLS/server-owned ingestion boundaries;
- atomic multi-provider PostgreSQL RPC v1.3 validated off-production;
- connector interfaces;
- mock provider;
- statement/CSV adapter;
- reconciliation tests;
- recurrence and obligation detection.

### Track 2 — Intelligence
- Financial Context builder;
- Available Real v1;
- Forecast v1;
- confidence/freshness gates;
- what-if simulator;
- goal protection.

### Track 3 — Experience
- financial status UX;
- one-screen Available Real;
- Next Best Financial Action;
- minimal-interruption notifications;
- 30-day user validation governed by [`FIRST_30_DAYS_USER_JOURNEY_V1.md`](./FIRST_30_DAYS_USER_JOURNEY_V1.md), including the intervention ladder, Constitution confirmation, month-end learning boundary and ten-second reassurance test.

### Track 4 — Real connectivity
- authorized banking/aggregator connectors;
- ERP/accounting adapters;
- webhooks/polling health;
- data-quality monitoring.

### Track 5 — Prepare/approve execution
- Financial Action Commands;
- authorization objects;
- preflight simulation;
- approval UX;
- exact-once harness;
- provider sandbox.

### Track 6 — Bounded autopilot
- policy-bound recurring actions;
- step-up authentication;
- kill switch;
- circuit breakers;
- fraud/anomaly gates;
- post-execution reconciliation.

### Track 7 — Advanced autonomy
Only after measured reliability, user trust, legal/compliance review and provider maturity.

## Release discipline

The current RC1 remains focused on Auth, E2E, Worker Gate, payments, security and rollback. Financial Autopilot architecture is developed on its own design/post-RC1 track until those release gates are closed.
