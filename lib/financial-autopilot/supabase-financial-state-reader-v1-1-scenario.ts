import { resolveFinancialState } from "./financial-state-resolver";
import type {
  FinancialStateReader,
  PersistedFinancialContextRecord,
} from "./financial-state-resolver";
import { SupabaseFinancialStateReaderV1_1 } from "./supabase-financial-state-reader-v1-1";
import type { FinancialObligation } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000092";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000093";
const REVISION = `ctx:${"a".repeat(64)}`;
const NOW = "2026-08-16T12:30:00.000Z";

function record(): PersistedFinancialContextRecord {
  return {
    userId: USER_ID,
    revision: REVISION,
    currency: "PYG",
    status: "SAFE",
    horizonUntil: "2026-09-01T12:00:00.000Z",
    liquidityUsableMinor: 8000000,
    protectedCommitmentsMinor: 2100000,
    protectedReserveMinor: 3000000,
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
}

const OBLIGATION: FinancialObligation = {
  id: "40000000-0000-4000-8000-000000000092",
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

class FixtureBaseReader implements FinancialStateReader {
  contextCalls = 0;
  obligationCalls = 0;

  async getLatestContext(_userId: string) {
    this.contextCalls += 1;
    return record();
  }

  async getOpenObligations(_input: {
    userId: string;
    currency: string;
    horizonUntil: string;
  }) {
    this.obligationCalls += 1;
    return [OBLIGATION];
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

export async function runSupabaseFinancialStateReaderV1_1Scenario() {
  const base = new FixtureBaseReader();
  const client = new FakeRiskClient({
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
  const reader = new SupabaseFinancialStateReaderV1_1(
    client as never,
    USER_ID,
    base,
  );

  const latest = await reader.getLatestContext(USER_ID);
  const resolved = await resolveFinancialState({
    trustedUserId: USER_ID,
    reader,
    nowIso: NOW,
  });

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
    queryAudit: client.queries.map(({ table, query: item }) => ({
      table,
      selected: item.selected,
      predicates: item.predicates,
    })),
  };
}
