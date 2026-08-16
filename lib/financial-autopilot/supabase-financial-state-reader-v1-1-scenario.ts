import { financialContextIntegrityRef } from "./financial-context-integrity";
import { resolveFinancialState } from "./financial-state-resolver";
import type {
  FinancialStateReader,
  PersistedFinancialContextRecord,
} from "./financial-state-resolver";
import { protectedObligationExplanationRef } from "./protected-obligations-fingerprint";
import { SupabaseFinancialStateReaderV1_1 } from "./supabase-financial-state-reader-v1-1";
import type { FinancialObligation } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000092";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000093";
const REVISION = `ctx:${"a".repeat(64)}`;
const NOW = "2026-08-16T12:30:00.000Z";

const OBLIGATION: FinancialObligation = {
  id: "resolver-rent",
  userId: USER_ID,
  type: "housing",
  amountMinor: 2100000,
  currency: "PYG",
  dueAt: "2026-08-25T00:00:00.000Z",
  priority: 100,
  mustProtect: true,
  confidence: 0.95,
  source: "reader_v1_1_fixture",
};

function record(
  patch: Partial<PersistedFinancialContextRecord> = {},
  preserveOriginalIntegrity = false,
): PersistedFinancialContextRecord {
  const base: PersistedFinancialContextRecord = {
    userId: USER_ID,
    revision: REVISION,
    currency: "PYG",
    status: "SAFE",
    horizonUntil: "2026-09-01T12:00:00.000Z",
    liquidityUsableMinor: 8000000,
    protectedCommitmentsMinor: 2100000,
    essentialSpendExpectedMinor: 1000000,
    protectedReserveMinor: 3000000,
    criticalProvisionsMinor: 0,
    confirmedIncomeMinor: 1000000,
    uncertaintyBufferMinor: 1260000,
    availableRealSafeMinor: 1640000,
    minimumProjectedCashMinor: 6005000,
    minimumProjectedCashAt: "2026-08-25T00:00:00.000Z",
    confidence: {
      sourceFreshness: 0.98,
      incomePredictability: 0.95,
      expensePredictability: 0.82,
      obligationCompleteness: 0.96,
      reconciliationQuality: 1,
      overall: 0.94,
    },
    explanationRefs: [],
    sourcesFresh: true,
    generatedAt: "2026-08-16T12:00:00.000Z",
    validUntil: "2026-08-17T12:00:00.000Z",
  };

  const originalIntegrity = financialContextIntegrityRef(base);
  const next = { ...base, ...patch };
  return {
    ...next,
    explanationRefs: [
      protectedObligationExplanationRef(OBLIGATION),
      preserveOriginalIntegrity
        ? originalIntegrity
        : financialContextIntegrityRef(next),
    ],
  };
}

class FixtureBaseReader implements FinancialStateReader {
  contextCalls = 0;
  obligationCalls = 0;

  constructor(
    private readonly obligations: FinancialObligation[] = [OBLIGATION],
    private readonly contextRecord: PersistedFinancialContextRecord = record(),
  ) {}

  async getLatestContext(_userId: string) {
    this.contextCalls += 1;
    return this.contextRecord;
  }

  async getOpenObligations(_input: {
    userId: string;
    currency: string;
    horizonUntil: string;
  }) {
    this.obligationCalls += 1;
    return this.obligations;
  }
}

class FakeRiskQuery {
  selected: string | null = null;
  predicates: Array<[string, unknown]> = [];

  constructor(
    private readonly response: { data: unknown; error: { code?: string } | null },
  ) {}

  select(value: string) {
    this.selected = value;
    return this;
  }

  eq(column: string, value: unknown) {
    this.predicates.push([column, value]);
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.response);
  }
}

class FakeRiskClient {
  queries: Array<{ table: string; query: FakeRiskQuery }> = [];

  constructor(
    private readonly response: { data: unknown; error: { code?: string } | null },
  ) {}

  from(table: string) {
    const query = new FakeRiskQuery(this.response);
    this.queries.push({ table, query });
    return query;
  }
}

async function catchesCode(work: () => unknown | Promise<unknown>, code: string) {
  try {
    await work();
    return false;
  } catch (error) {
    return error instanceof Error && error.message === code;
  }
}

function riskClient() {
  return new FakeRiskClient({
    data: {
      revision: REVISION,
      first_forecast_risk: {
        status: "ATTENTION",
        horizonDays: 60,
        until: "2026-10-15T12:00:00.000Z",
        reserveGapMinor: 750000,
        negativeCashGapMinor: 0,
      },
    },
    error: null,
  });
}

async function resolveWithObligationDrift(
  patch: Partial<FinancialObligation>,
) {
  const driftedReader = new SupabaseFinancialStateReaderV1_1(
    riskClient() as never,
    USER_ID,
    new FixtureBaseReader([{ ...OBLIGATION, ...patch }]),
  );
  const resolution = await resolveFinancialState({
    trustedUserId: USER_ID,
    reader: driftedReader,
    nowIso: NOW,
  });
  return resolution.kind === "STATE" ? resolution.state : null;
}

function isFailClosedDriftState(
  state: Awaited<ReturnType<typeof resolveWithObligationDrift>>,
) {
  return (
    state?.status === "DEGRADED" &&
    state.canAssertSafety === false &&
    state.money.availableRealMinor === null &&
    state.firstForecastRisk === null &&
    state.attention.outcome === "CONNECTION_REQUIRED"
  );
}

export async function runSupabaseFinancialStateReaderV1_1Scenario() {
  const base = new FixtureBaseReader();
  const client = riskClient();
  const reader = new SupabaseFinancialStateReaderV1_1(
    client as never,
    USER_ID,
    base,
  );

  const latest = await reader.getLatestContext(USER_ID);
  const hydratedObligations = await reader.getOpenObligations({
    userId: USER_ID,
    currency: "PYG",
    horizonUntil: "2026-09-01T12:00:00.000Z",
  });
  const resolved = await resolveFinancialState({
    trustedUserId: USER_ID,
    reader,
    nowIso: NOW,
  });

  // All of these preserve the stable source key and amount. They prove the
  // material obligation identity catches semantic drift that the old id+sum
  // comparison could not see.
  const dueDateDriftState = await resolveWithObligationDrift({
    dueAt: "2026-08-26T00:00:00.000Z",
  });
  const priorityDriftState = await resolveWithObligationDrift({ priority: 90 });
  const confidenceDriftState = await resolveWithObligationDrift({ confidence: 0.9 });
  const typeDriftState = await resolveWithObligationDrift({ type: "housing_lease" });
  const sourceDriftState = await resolveWithObligationDrift({
    source: "reader_v1_1_fixture_changed",
  });

  // Aggregate mutation with the original integrity ref simulates stored context
  // drift after persistence. It must be rejected before the first-risk query.
  const aggregateDriftClient = riskClient();
  const aggregateDriftReader = new SupabaseFinancialStateReaderV1_1(
    aggregateDriftClient as never,
    USER_ID,
    new FixtureBaseReader(
      [OBLIGATION],
      record({ confirmedIncomeMinor: 1500000 }, true),
    ),
  );
  const aggregateDriftBlocked = await catchesCode(
    () => aggregateDriftReader.getLatestContext(USER_ID),
    "financial_state_context_integrity_mismatch",
  );
  const aggregateDriftBlockedBeforeExtensionRead =
    aggregateDriftClient.queries.length === 0;

  const missingIntegrityClient = riskClient();
  const missingIntegrityRecord = record();
  missingIntegrityRecord.explanationRefs = missingIntegrityRecord.explanationRefs.filter(
    (ref) => !ref.startsWith("context-integrity:"),
  );
  const missingIntegrityBlocked = await catchesCode(
    () =>
      new SupabaseFinancialStateReaderV1_1(
        missingIntegrityClient as never,
        USER_ID,
        new FixtureBaseReader([OBLIGATION], missingIntegrityRecord),
      ).getLatestContext(USER_ID),
    "financial_state_context_integrity_mismatch",
  );
  const missingIntegrityBlockedBeforeExtensionRead =
    missingIntegrityClient.queries.length === 0;

  const query = client.queries[0];
  const crossUserCallsBefore = base.contextCalls;
  const crossUserBlocked = await catchesCode(
    () => reader.getLatestContext(OTHER_USER_ID),
    "financial_state_user_mismatch",
  );
  const crossUserDidNotTouchBase = base.contextCalls === crossUserCallsBefore;

  const malformedClient = new FakeRiskClient({
    data: {
      revision: REVISION,
      first_forecast_risk: {
        status: "SAFE",
        horizonDays: 60,
        until: "2026-10-15T12:00:00.000Z",
        reserveGapMinor: 0,
        negativeCashGapMinor: 0,
      },
    },
    error: null,
  });
  const malformedRiskBlocked = await catchesCode(
    () =>
      new SupabaseFinancialStateReaderV1_1(
        malformedClient as never,
        USER_ID,
        new FixtureBaseReader(),
      ).getLatestContext(USER_ID),
    "financial_state_invalid_first_forecast_risk",
  );

  const errorClient = new FakeRiskClient({
    data: null,
    error: { code: "42501" },
  });
  const readErrorBlocked = await catchesCode(
    () =>
      new SupabaseFinancialStateReaderV1_1(
        errorClient as never,
        USER_ID,
        new FixtureBaseReader(),
      ).getLatestContext(USER_ID),
    "financial_state_forecast_risk_read_failed:42501",
  );

  const state = resolved.kind === "STATE" ? resolved.state : null;
  const checks = {
    persistedRiskHydratesContext:
      latest?.firstForecastRisk?.status === "ATTENTION" &&
      latest.firstForecastRisk.horizonDays === 60 &&
      latest.firstForecastRisk.reserveGapMinor === 750000,
    persistedRiskSurvivesUserProjection:
      state?.firstForecastRisk?.status === "ATTENTION" &&
      state.firstForecastRisk.horizonDays === 60 &&
      state.firstForecastRisk.reserveGapMinor === 750000,
    aggregateContextIntegrityRequired:
      latest?.explanationRefs.some((ref) => ref.startsWith("context-integrity:")) === true,
    aggregateContextDriftFailsBeforeExtensionRead:
      aggregateDriftBlocked && aggregateDriftBlockedBeforeExtensionRead,
    missingAggregateIntegrityFailsBeforeExtensionRead:
      missingIntegrityBlocked && missingIntegrityBlockedBeforeExtensionRead,
    obligationReadUsesMaterialContextIdentity:
      hydratedObligations[0]?.id !== OBLIGATION.id &&
      latest?.explanationRefs.includes(`obligation:${hydratedObligations[0]?.id}`) === true,
    dueDateDriftAtSameSourceAndAmountFailsClosed:
      isFailClosedDriftState(dueDateDriftState),
    priorityDriftAtSameSourceAndAmountFailsClosed:
      isFailClosedDriftState(priorityDriftState),
    confidenceDriftAtSameSourceAndAmountFailsClosed:
      isFailClosedDriftState(confidenceDriftState),
    typeDriftAtSameSourceAndAmountFailsClosed:
      isFailClosedDriftState(typeDriftState),
    sourceDriftAtSameSourceKeyAndAmountFailsClosed:
      isFailClosedDriftState(sourceDriftState),
    extensionReadIsOwnerAndRevisionScoped:
      query?.table === "eos_financial_contexts_v1" &&
      query.query.selected === "revision,first_forecast_risk" &&
      query.query.predicates.some(
        ([column, value]) => column === "usuario_id" && value === USER_ID,
      ) &&
      query.query.predicates.some(
        ([column, value]) => column === "revision" && value === REVISION,
      ),
    extensionNeverReadsRawLedger:
      client.queries.every(
        ({ table }) =>
          table !== "eos_financial_ledger_v1" &&
          table !== "eos_financial_ingestion_events_v1",
      ),
    crossUserFailsBeforeAnyRead: crossUserBlocked && crossUserDidNotTouchBase,
    malformedRiskFailsClosed: malformedRiskBlocked,
    databaseReadErrorFailsClosed: readErrorBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    latestRisk: latest?.firstForecastRisk ?? null,
    projectedRisk: state?.firstForecastRisk ?? null,
    materialObligationId: hydratedObligations[0]?.id ?? null,
    driftedStates: {
      dueDate: dueDateDriftState,
      priority: priorityDriftState,
      confidence: confidenceDriftState,
      type: typeDriftState,
      source: sourceDriftState,
    },
    queryAudit: client.queries.map(({ table, query: item }) => ({
      table,
      selected: item.selected,
      predicates: item.predicates,
    })),
  };
}
