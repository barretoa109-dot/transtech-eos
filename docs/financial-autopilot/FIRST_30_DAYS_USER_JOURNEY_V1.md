# EOS Financial Autopilot — First 30 Days v1

> Product/experience contract for the post-RC1 pilot. This document does not authorize production migrations, real provider credentials, real financial-data writes or money movement. PR #58 remains draft and **DO NOT MERGE** while EOS 4.0 RC1 is frozen.

## Product rule

**In finance, EOS works; the user observes.**

The first 30 days must prove that EOS can assume the recurring work of understanding a user's finances without turning that user into a bookkeeper. The intended loop is:

```text
detect -> understand -> organize -> forecast -> decide -> act within policy -> verify -> learn
```

During the read-only pilot, `act within policy` means safely changing EOS recommendations, provisions, forecasts and goal pacing. It never means moving real money.

The end-state message is not a chart or a recommendation list. It is:

> **Everything is under control.**
> You do not need to do anything.

## Persona and month-one example

The reference user earns `Gs. 12,000,000` monthly, uses more than one account/card and rarely reviews the complete financial picture. They do not want to categorize coffee, maintain a budget or calculate card settlement manually.

Example Financial Constitution:

| Rule | User policy |
| --- | --- |
| Minimum protected liquidity | `Gs. 5,000,000` |
| Minimum savings protection | `15%` of confirmed income |
| Debt policy | Pay card statement in full |
| Primary goal | Emergency fund, high priority |
| Approval threshold | Ask above `Gs. 2,000,000` |
| Pilot execution authority | `Gs. 0`; read-only/prepare only |

The amounts are examples, not product defaults. Monetary values are stored in integer minor units and displayed using the user's currency conventions.

## Definition of success on day 30

By day 30, a healthy pilot user should be able to open EOS for ten seconds and see:

> **FINANCE — SAFE ✓**
>
> Everything is under control.
>
> **Available Real**
> Gs. 2,460,000
>
> **Upcoming commitments**
> Covered ✓
>
> **Reserve**
> Protected ✓
>
> **Goals**
> On track ✓
>
> **Next expected income**
> 30 August
>
> **EOS needs from you**
> Nothing

This state is allowed only when critical source coverage, critical obligations, freshness and economic safety all pass. A complete transactional commit does not itself authorize `SAFE`.

Successful month-one user effort is limited to:

1. authorizing available read-only sources;
2. confirming the Financial Constitution once;
3. answering at most two genuinely material ambiguities after ingestion;
4. making a decision only if EOS cannot protect all hard constraints itself.

There is no transaction-by-transaction categorization, daily budget maintenance or manual salary/debt updating in the primary path.

## Experience state model

Onboarding progress and financial safety are different dimensions. `READY` does not mean `SAFE`, and persisted data does not mean trustworthy data.

| Experience state | Meaning | User-facing behavior |
| --- | --- | --- |
| `CONNECTING` | EOS does not yet know the complete source inventory | Ask for the missing connection or import; do not show Available Real as authoritative |
| `BUILDING_BASELINE` | Sources are connected and EOS is reconciling/learning | Show progress and what EOS is doing; avoid user bookkeeping |
| `READY` | A current Financial Context can be served | Show its independent financial status |
| `DEGRADED` | Coverage, obligations or freshness cannot support a safety claim | Explain the single blocking fact and offer one repair action |
| `SAFE` | Hard constraints are protected and data is trustworthy | Reassure; default to “You do not need to do anything” |
| `ATTENTION` | A material deviation exists but EOS can absorb it inside policy | Adjust silently or provide a calm informational update |
| `ACTION_REQUIRED` | No policy-compliant path protects all hard constraints | Ask for one bounded decision with consequences and at most two recommended options |
| `PAUSED` | Security, consent, connector or execution control requires a stop | Freeze affected autonomy; retain safe read-only behavior where possible |

## The exact first 30 days

### Day 0 — Trust before data

**EOS works**

- explains the product promise in one screen: connect once, EOS maintains the model;
- separates permission to read data from permission to move money;
- states that the pilot cannot move money;
- requests only the minimum read scopes and records consent/version/provenance;
- discovers which institutions and source types the selected connector can cover.

**The user does**

- signs in;
- authorizes the first financial source;
- chooses whether to continue connecting other known sources now or resume later.

**The user sees**

> Connect your financial information once. EOS will organize it and tell you only when something important needs your attention. No money will be moved in this pilot.

**Exit gate**

At least one usable source is authorized, but EOS remains `CONNECTING` until it can establish the required source inventory. It must not infer global coverage from a provider-scoped connection.

### Day 1 — Establish source coverage

**EOS works**

- inventories accounts, cards, loans and other material products per provider;
- records provider scope, sync health, oldest/newest event and freshness window;
- identifies missing critical source classes;
- imports immutable raw events and preserves their provenance;
- schedules refresh according to connector capability.

**The user does**

- connects a second source only when EOS can explain why it is material.

**The user sees**

Healthy path:

> I found your accounts and cards. I am organizing them now. You do not need to classify anything.

Incomplete path:

> I still need the card ending in 4821 before I can confirm what is safely available. Connect card.

**Exit gate**

`criticalSourcesComplete = true` and every authoritative source has explicit freshness evidence. Otherwise the experience remains `DEGRADED`/`CONNECTION_REQUIRED`; it cannot claim `SAFE`.

### Days 2–3 — Reconstruct the financial truth silently

**EOS works**

- normalizes transactions into the canonical Ledger;
- deduplicates webhook/poll/import overlap;
- links pending and posted versions;
- identifies own-account transfers;
- matches card purchases and card settlements without double-counting expense;
- links refunds/reversals;
- detects likely income, recurrence and obligation candidates;
- assigns confidence and keeps low-impact uncertainty out of the user's way.

**The user does**

- nothing by default;
- answers only an ambiguity that could materially alter Available Real, an obligation or source ownership.

**Question rule**

EOS must defer or resolve low-impact classification uncertainty itself. A material question contains the observed evidence, why it matters and the consequence of either answer. Month-one target: no more than two such questions after ingestion.

**Exit gate**

Reconciliation invariants pass and EOS has an initial candidate set of liquidity, income, critical obligations, essential spend and internal transfers.

### Day 4 — Confirm the Financial Constitution once

EOS proposes answers from connected evidence when safe, but learned behavior never becomes monetary authorization. The user confirms five policy cards in one short session:

1. **Liquidity floor:** “How much do you always want to keep available?”
2. **Savings protection:** “What minimum part of confirmed income should EOS protect?”
3. **Debt priority:** “Which debts must EOS prioritize, and should cards be paid in full?”
4. **Goals:** “Which objective must EOS protect first?”
5. **Approval boundary:** “Above what amount must EOS ask before preparing or, in the future, executing an action?”

Every card includes `Use EOS suggestion`, `Change` and a plain-language consequence. The pilot then displays and locks:

> Real money actions: disabled. EOS may observe, forecast, recommend and prepare only.

**Exit gate**

The Constitution is versioned, auditable and linked to the user. Hard rules require explicit confirmation; optional preferences may retain safe conservative defaults. EOS does not ask these questions again unless the user edits policy or circumstances materially invalidate an answer.

### Day 5 — Produce the first trustworthy Financial Context

**EOS works**

- builds a versioned Financial Context from the reconciled global source view;
- derives protected commitments, reserve and goal provisions;
- forecasts until the next sufficiently confirmed income or falls back to a rolling 30-day horizon;
- computes Available Real Base and a conservative uncertainty buffer;
- selects exactly one Next Best Financial Action;
- commits the context last and binds it to its source/coverage evidence.

**The user sees**

If all gates pass, the first calm dashboard is shown. If a gate fails, EOS names the blocker rather than showing false precision:

> I cannot confirm your Available Real yet because the balance from Banco B is out of date. Your information remains protected; refresh the connection to continue.

**Exit gate**

A reproducible context exists with `generated_at`, `valid_until`, source fingerprint, coverage fingerprint, confidence and an independent safety status.

### Days 6–7 — Establish the zero-entry baseline

**EOS works**

- refreshes sources in the background;
- compares new events with expected recurrences;
- updates Available Real and forecast incrementally;
- records explanation components for every material result;
- measures how many manual inputs and interruptions were required.

**The user does**

- opens the dashboard if desired;
- does not maintain categories, budgets or balances.

**Healthy behavior**

EOS does not create a weekly “insight” merely to generate engagement. If nothing material changed, the dashboard updates and EOS remains silent.

### Days 8–14 — Learn the real monthly rhythm

**EOS works**

- confirms or rejects candidate recurrences as more evidence arrives;
- narrows amount/date ranges for salary, rent, utilities, subscriptions and card settlement;
- distinguishes deterministic obligations from behavioral estimates;
- observes variable essential spend and recalibrates the uncertainty buffer;
- detects an unexpected pattern without moralizing about the category;
- protects hard constraints before flexible goals.

**Intervention examples**

No material impact: no message.

Material but absorbable:

> I detected higher spending this month. You do not need to change anything yet; I adjusted your recommended Available Real to keep your commitments and goal protected.

Unable to absorb safely:

> I need one decision. At this pace, the projected gap before your next income is Gs. 620,000. I can temporarily reduce the contribution to Travel or lower your weekly available amount.

Actions shown:

- `Adjust available amount`
- `Reduce this month's contribution`

### Day 15 — Mid-cycle safety check

EOS runs a formal forecast-vs-actual checkpoint even when the user does not open the application.

It verifies:

- source and obligation freshness;
- income timing/confidence;
- minimum projected cash;
- reserve and commitment protection;
- goal pacing;
- forecast error and remaining uncertainty;
- whether a silent policy-compliant adjustment is sufficient.

The default result is `NO_ACTION` with no notification. An informational message is allowed only when it reduces uncertainty or confirms a meaningful automatic adjustment. A decision notification is allowed only for `ACTION_REQUIRED` or `CONNECTION_REQUIRED`.

### Days 16–21 — Protect priorities as reality changes

**EOS works**

- absorbs normal variance by updating soft spend envelopes and goal pacing;
- never weakens the liquidity floor, critical obligations or debt hard rules silently;
- simulates alternatives against a copy of Financial Context;
- logs the chosen rationale and learns from user overrides without expanding authority;
- immediately degrades if a material source becomes stale or critical obligations become incomplete.

**The user experiences**

Most users receive nothing. If asked, they receive one decision, not an alarm dashboard. Each option states the effect on Available Real, reserve, obligations and goal date.

### Days 22–27 — Rehearse the end of the cycle

**EOS works**

- forecasts the lowest cash point before the next income;
- verifies upcoming statement, rent, debt and essential-spend provisions;
- runs a late-income scenario;
- prepares a proposed payday allocation under the Constitution;
- verifies that every proposed action would be inside its future authorization boundary;
- precomputes the fallback if income is late or lower than expected.

**The user sees**

When safe:

> Your commitments are covered until the next expected income. EOS needs nothing from you.

When income confidence drops:

> Your expected income has not been confirmed yet. I paused the assumption and adjusted your Available Real. No money action was taken.

### Days 28–30 — Close the loop and make EOS easy to trust

When salary/income arrives, EOS detects and reconciles it. In the read-only pilot EOS then **simulates** the future Autopilot allocation:

1. protect upcoming commitments;
2. protect the liquidity floor;
3. provision the card/debt policy;
4. protect the minimum savings contribution;
5. advance the primary goal;
6. calculate the remaining Available Real;
7. verify the post-plan forecast.

It does not execute transfers. The month-end result says:

> EOS organized your month.
>
> Everything is covered. Gs. 2,460,000 remains available for free use. Your Home goal advanced 3.2%, and your reserve remains protected.
>
> You do not need to do anything.

EOS also compares forecast with actual outcomes, updates only soft estimates, preserves the evidence behind changes and starts the next cycle without repeating onboarding.

## Intervention ladder

EOS chooses the lowest sufficient level. Product engagement is never a reason to escalate.

| Level | Internal result | User interruption | Example |
| --- | --- | --- | --- |
| `I0` | `NO_ACTION` | None | Context refreshes silently |
| `I1` | `INFORM_NO_ACTION` | Optional calm update | “Your salary arrived and everything remains covered.” |
| `I2` | `SILENT_ADJUSTMENT` | None by default; visible in activity | “Available Real adjusted to protect your goal.” |
| `I3` | `USER_DECISION_REQUIRED` | One decision with up to two recommended options | Choose which flexible target absorbs a projected gap |
| `I4` | `CONNECTION_REQUIRED` / security pause | Immediate, one repair action | Refresh a stale critical connection |

Escalation rules:

- category variance alone never justifies a notification;
- a soft-goal pacing change inside policy normally remains silent;
- a hard-constraint conflict always requires a decision;
- insufficient trustworthy data always blocks a `SAFE` claim;
- a security, consent or provider-integrity issue freezes affected autonomy immediately;
- repeated reminders are suppressed unless urgency or consequence materially changes.

## Autonomy during and after the pilot

| Level | Capability | Month-one pilot |
| --- | --- | --- |
| `L0 Observe` | Read, reconcile, forecast and explain | Enabled |
| `L1 Recommend` | Propose the safest next action | Enabled |
| `L2 Prepare` | Build an expiring action command for user review | Design/sandbox only |
| `L3 Execute within Constitution` | Execute under limits with preflight and exact-once controls | Excluded |
| `L4 Advanced autonomy` | Chained policy-bound actions | Excluded |
| `Freeze` | Stop monetary autonomy while safe read-only monitoring continues | Required control before execution |

No amount of observed behavior can promote a user to a higher autonomy level. Enabling execution requires explicit consent, provider capability, legal/compliance review, step-up authentication, limits, circuit breakers, reconciliation and a kill switch.

## How EOS core capabilities participate

| EOS capability | Financial responsibility | Boundary |
| --- | --- | --- |
| Memory | Retain confirmed policies, facts, decisions and their provenance | Never treat an inferred habit as authorization |
| Objectives | Represent goals, priority, target and protected contribution | Hard obligations outrank flexible goals |
| Decisions | Record material alternatives, consequences and user choice | Ask only when policy cannot resolve the conflict |
| Autonomy | Evaluate Constitution, limits, scope, freshness and action permission | Fail closed; old approval plus changed context requires revalidation |
| Learning | Recalibrate recurrence, amount/date ranges, forecast error and communication usefulness | May change soft estimates, never hard policy or permission |

## Automation backlog discovered by the journey

### P0 — Required for the read-only 30-day pilot

1. consented source discovery and explicit global coverage inventory;
2. automatic ingestion, normalization, deduplication and reconciliation;
3. income, recurrence and critical-obligation inference with confidence;
4. versioned Financial Constitution confirmation;
5. Financial Context, Available Real and 30-day/next-income forecast;
6. source/obligation freshness gates with zero false `SAFE` tolerance;
7. Next Best Financial Action and intervention-ladder policy;
8. one-screen reassurance dashboard plus single-action degraded/decision states;
9. event-driven refresh and month-end forecast-vs-actual learning;
10. auditable explanation and month-one outcome telemetry.

### P1 — Required before prepare/approve execution

1. Financial Action Command and expiring authorization objects;
2. preflight simulation against the latest context and policy;
3. stable idempotency/effect keys and provider sandbox harness;
4. step-up approval UX, per-action limits and approved destinations;
5. post-execution observation/reconciliation;
6. per-user/global kill switch and provider circuit breakers.

### P2 — Required before bounded real Autopilot

1. real read and execution connectors with measured reliability;
2. legal/compliance and fraud/anomaly controls per market/provider;
3. staged rollout with low monetary caps and explicit opt-in;
4. ambiguous-timeout recovery and operational runbooks;
5. measured trust, override and reconciliation thresholds before expansion.

## Features deliberately removed or deferred

The journey does not justify building these as core interactions:

- mandatory manual transaction entry;
- mandatory category correction queues;
- manual monthly budget construction;
- chart-heavy home screens;
- generic overspending alerts;
- guilt language, scores, streaks or financial gamification;
- notifications created to increase engagement;
- duplicate manual debt/salary maintenance when a trustworthy source exists;
- dozens of simultaneous recommendations;
- automatic money movement hidden behind a general consent screen.

Details, categories and charts may exist as optional evidence drill-downs. They must never become required maintenance.

## Month-one measurement contract

Primary metric:

**Manual Financial Input Rate -> 0**

Guardrail and outcome metrics:

| Metric | Pilot target |
| --- | --- |
| False `SAFE` | `0` |
| Duplicate economic effects | `0` in deterministic acceptance suite |
| Automatically handled imported movements | `>= 90%` without user classification |
| Material post-ingestion clarifications | `<= 2` per user in month one |
| Unnecessary interruptions after baseline | `<= 1` per user/week, trending to zero |
| Traceable Available Real | `100%` to source, freshness and protected components |
| Source/obligation critical coverage | Explicitly known before `SAFE` |
| Time to first trustworthy context | Measured from final critical connection, not from sign-up |
| Days without required intervention | Increase without hiding risk |
| Decision override rate | Measured by reason; never used to silently expand authority |
| Forecast error | Tracked by obligation/income/essential-spend layer |
| Ten-second reassurance success | User can answer safe/available/action-needed without opening details |
| Reported financial mental load | Lower on day 30 than day 0 |

Time in app, notification opens and chart views are diagnostic metrics, not success metrics.

## Deterministic month-one acceptance scenarios

The pilot cannot be called complete unless all of these pass:

1. two-provider fresh/complete data reaches a reproducible context and can show `SAFE` when economically safe;
2. one missing critical provider remains `DEGRADED` and asks for that connection;
3. a stale non-liquidity material source prevents `SAFE`;
4. card purchase plus card settlement produces one economic expense;
5. own-account transfer changes location, not spending;
6. late salary degrades the income assumption before a false safety claim;
7. higher discretionary spending with no hard impact produces silence or a silent adjustment;
8. a projected hard-constraint conflict produces one decision with concrete alternatives;
9. a flexible goal yields before an essential obligation according to policy;
10. the same source plan replay produces the same result without duplicate effects;
11. context/commit inconsistency fails closed and publishes no new authoritative context;
12. month-end learning changes soft estimates but cannot mutate the Constitution or autonomy level.

## Release boundary

This 30-day journey is the acceptance contract for Architecture Track 3 and guides Tracks 1–2. It remains isolated from EOS 4.0 RC1.

Promotion beyond design/read-only pilot requires, in order:

1. close the existing EOS 4.0 RC1 Auth, E2E, Worker Gate, payments, security and rollback gates;
2. approve and apply the reviewed financial persistence stack through a controlled non-production-to-production migration path;
3. complete the read-only 30-day pilot with the measurement and acceptance contract above;
4. pass separate execution-readiness, provider, compliance, security and rollback gates.

Until then: no production financial schema, no real banking credentials, no real financial-data writes and no money movement.
