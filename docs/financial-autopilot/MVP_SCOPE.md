# EOS Financial Autopilot — Pilot MVP Scope

This document defines the smallest version that proves the product thesis without prematurely moving real money.

## Goal

Prove that a user can stop manually managing day-to-day finances because EOS can keep an automatically refreshed financial model, calculate a trustworthy Available Real amount, anticipate near-term risk and interrupt only when necessary.

## Pilot promise

A pilot user should be able to connect/import sources and then mostly observe.

The pilot succeeds if the user can regularly see:

> **Everything is under control.**
> Available Real: Gs. X
> Commitments: protected
> Reserve: protected
> EOS needs from you: nothing

## Included

### Automatic/low-friction data ingestion
At least two ingestion paths:

1. standardized statement/CSV import;
2. mock or real read-only connector behind the connector contract.

Optional additional path if implementation cost is low: email/statement extraction.

Manual transaction-by-transaction entry is not the primary path.

### Canonical ledger
Must support:

- bank accounts;
- card purchases;
- card payments;
- income;
- ordinary expenses;
- own-account transfers;
- refunds/reversals;
- pending/posted evolution;
- recurring patterns;
- future obligations.

### Reconciliation
Must avoid:

- duplicate spending from card settlement;
- treating own-account transfers as expenses;
- webhook/poll duplicate effects;
- pending+posted double count;
- refund double count.

### Financial Constitution v1
Pilot parameters:

- protected reserve;
- essential obligations;
- primary financial goal;
- stability preference;
- autonomous monetary action limit fixed to zero for the pilot.

### Financial Context
Versioned snapshot with freshness and confidence.

### Available Real
Calculate and explain `available_real_safe` with source-backed components.

### Forecast
At minimum:

- next expected income or rolling 30-day horizon;
- critical obligations;
- expected essential spend;
- minimum projected cash;
- reserve breach detection;
- late/missing income scenario.

### What-if simulation
Support questions such as:

- Can I buy X?
- Can I travel this month?
- How much can I spend today without affecting anything important?

Simulation never mutates real context.

### Next Best Financial Action
Support:

- NO_ACTION;
- SILENT_ADJUSTMENT;
- USER_DECISION_REQUIRED;
- CONNECTION_REQUIRED.

Default should often be NO_ACTION.

### UX
One main financial status screen with:

- SAFE / ATTENTION / ACTION_REQUIRED / DEGRADED;
- Available Real;
- commitments status;
- reserve status;
- goals status;
- EOS needs from you;
- optional detail drill-down;
- source freshness when materially relevant.

## Explicitly excluded from pilot

- real autonomous transfers;
- bill payment execution;
- card payment execution;
- investing;
- borrowing/credit origination;
- FX execution;
- international payments;
- automatic creation of beneficiaries;
- hidden background money movement.

These belong to the separate execution readiness milestone.

## Pilot user journey

The detailed day-by-day product, intervention and measurement contract is defined in [`FIRST_30_DAYS_USER_JOURNEY_V1.md`](./FIRST_30_DAYS_USER_JOURNEY_V1.md). The summary below is retained as the pilot stage map; when it is ambiguous, the detailed 30-day contract governs the experience.

### Day 0
User creates/uses EOS account and opens Financial Autopilot.

EOS asks the minimum necessary setup questions and proposes defaults when it can infer them safely.

### Connection/import
User connects or imports financial sources.

EOS ingests history, identifies accounts, detects likely salary/income, recurring expenses and obligations, and reconciles transfers/card payments.

### First model
EOS creates Financial Context and explains any high-impact ambiguity once.

### First output
EOS shows:

- status;
- Available Real Safe;
- next expected income/horizon;
- protected reserve;
- upcoming commitments;
- one next best action or nothing.

### Continuous operation
New events trigger incremental recalculation.

Low-impact classification uncertainty is handled silently or deferred.

Only material uncertainty or conflict produces a user question.

### End of first month
EOS compares forecast vs actual, recalibrates soft estimates and reports a short automatic summary focused on what changed and whether user intervention was required.

It must not repeat onboarding, silently change the Financial Constitution or convert learned behavior into monetary authority. In the read-only pilot, any proposed payday allocation is a simulation only.

## Pilot acceptance scenarios

### Scenario A — high salary, poor visibility
User has a high monthly salary but does not track spending. EOS reconstructs the month and produces an Available Real number without manual categorization.

### Scenario B — own-account transfer
Transfer between two user accounts changes location of money but not economic spending.

### Scenario C — card purchase and card payment
Purchase is counted once. Paying the card does not create a second expense.

### Scenario D — recurring salary
EOS identifies salary with confidence and forecasts next expected income.

### Scenario E — salary delayed
Expected salary does not arrive. Forecast degrades before EOS falsely claims safety.

### Scenario F — safe discretionary purchase
Purchase is affordable and does not violate reserve/obligations. EOS says it is safe without moralizing.

### Scenario G — unsafe discretionary purchase
Purchase fits bank balance but crosses protected reserve before next income. EOS recommends waiting and quantifies consequences.

### Scenario H — source stale
Main bank data is stale. EOS enters DEGRADED rather than SAFE.

### Scenario I — goal conflict
A flexible savings goal conflicts with an essential obligation. EOS protects the obligation and proposes/records the goal adjustment policy.

### Scenario J — no action needed
Everything is healthy. EOS says “No necesitas hacer nada” and does not generate artificial recommendations.

## Quantitative pilot targets

Initial targets to validate, not permanent SLAs:

- >= 90% of imported movements require no manual user classification;
- zero duplicate economic effects in reconciliation test suite;
- zero false SAFE in deterministic acceptance suite;
- <= 2 material clarification questions per user during initial setup after ingestion;
- after baseline stabilizes, <= 1 unnecessary financial interruption per user/week;
- every Available Real result traces to source components and freshness;
- pilot users can explain what Available Real means without needing to understand the underlying formula.
- the user can answer safety, available amount and action-needed status in ten seconds without opening details;
- month-end learning changes only soft estimates and never silently changes policy or autonomy.

## Qualitative pilot targets

Users should report that:

- they spend less time checking accounts;
- they do not feel required to maintain a budget manually;
- EOS catches things they would otherwise ignore;
- they trust “Available Real” more than raw account balance for spending decisions;
- notifications feel necessary rather than noisy;
- the product reduces financial mental load.

## Definition of pilot success

The pilot is successful when users start behaving as observers rather than data-entry operators.

A successful user should be able to say:

> “I do not keep track of everything myself anymore. EOS already knows what is happening, tells me what I can safely use and only asks me when a real decision is needed.”
