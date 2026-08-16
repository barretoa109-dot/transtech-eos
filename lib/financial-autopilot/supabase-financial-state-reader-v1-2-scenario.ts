import {
  criticalObligationsCompletenessRef,
} from "./critical-obligations-persistence";
import { financialContextIntegrityRef } from "./financial-context-integrity";
import { resolveFinancialState } from "./financial-state-resolver";
import type {
  FinancialStateReader,
  PersistedFinancialContextRecord,
} from "./financial-state-resolver";
import {
  protectedObligationContextId,
  protectedObligationExplanationRef,
} from "./protected-obligations-fingerprint";
import { SupabaseFinancialStateReaderV1_2 } from "./supabase-financial-state-reader-v1-2";
import type { FinancialObligation } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000094";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000095";
const REVISION = `ctx:${"b".repeat(64)}`;
const NOW = "2026-08-16T12:30:00.000Z";

const RAW_OBLIGATION: FinancialObligation = {
  id: "resolver-rent-v1-2",
  userId: USER_ID,
  type: "housing",
  amountMinor: 2100000,
  currency: "PYG",
  dueAt: "2026-08-25T00:00:00.000Z",
  priority: 100,
  mustProtect: true,
  confidence: 0.95,
  source: "reader_v1_2_fixture",
};

const MATERIAL_OBLIGATION: FinancialObligation = {
  ...RAW_OBLIGATION,
  id: protectedObligationContextId(RAW_OBLIGATION),
};

function record(criticalObligationsComplete: boolean) {
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

  const aggregateIntegrityRef = financialContextIntegrityRef(base);
  return {
    ...base,
    explanationRefs: [
      protectedObligationExplanationRef(RAW_OBLIGATION),
      aggregateIntegrityRef,
      criticalObligationsCompletenessRef({
        criticalObligationsComplete,
        contextIntegrityRef: aggregateIntegrityRef,
      }),
    ],
  };
}

class FixtureV1_1Reader implements FinancialStateReader {
  contextCalls = 0;
  obligationCalls = 0;

  constructor(private readonly contextRecord: PersistedFinancialContextRecord) {}

  async getLatestContext() {
    this.contextCalls += 1;
    return this.contextRecord;
  }

  async getOpenObligations() {
    this.obligationCalls += 1;
    return [MATERIAL_OBLIGATION];
  }
}

class FakeCompletenessQuery {
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

class FakeCompletenessClient {
  queries: Array<{ table: string; query: FakeCompletenessQuery }> = [];

  constructor(
    private readonly response: { data: unknown; error: { code?: string } | null },
  ) {}

  from(table: string) {
    const query = new FakeCompletenessQuery(this.response);
    this.queries.push({ table, query });
    return query;
  }
}

function completenessClient(value: unknown) {
  return new FakeCompletenessClient({
    data: {
      revision: REVISION,
      critical_obligations_complete: value,
    },
    error: null,
  });
}

async function catchesCode(work: () => unknown | Promise<unknown>, code: string) {
  try {
    await work();
    return false;
  } catch (error) {
    return error instanceof Error && error.message === code;
  }
}

async function resolveCompleteness(value: boolean) {
  const client = completenessClient(value);
  const base = new FixtureV1_1Reader(record(value));
  const reader = new SupabaseFinancialStateReaderV1_2(
    client as never,
    USER_ID,
    base,
  );
  const resolution = await resolveFinancialState({
    trustedUserId: USER_ID,
    reader,
    nowIso: NOW,
  });
  return {
    client,
    base,
    state: resolution.kind === "STATE" ? resolution.state : null,
  };
}

export async function runSupabaseFinancialStateReaderV1_2Scenario() {
  const complete = await resolveCompleteness(true);
  const incomplete = await resolveCompleteness(false);

  const tamperedClient = completenessClient(false);
  const tamperedBase = new FixtureV1_1Reader(record(true));
  const tamperedReader = new SupabaseFinancialStateReaderV1_2(
    tamperedClient as never,
    USER_ID,
    tamperedBase,
  );
  const tamperedBlocked = await catchesCode(
    () => tamperedReader.getLatestContext(USER_ID),
    "financial_state_critical_obligations_integrity_mismatch",
  );

  const malformedBlocked = await catchesCode(
    () =>
      new SupabaseFinancialStateReaderV1_2(
        completenessClient("true") as never,
        USER_ID,
        new FixtureV1_1Reader(record(true)),
      ).getLatestContext(USER_ID),
    "financial_state_invalid_critical_obligations_complete",
  );

  const missingCommitmentRecord = record(true);
  missingCommitmentRecord.explanationRefs =
    missingCommitmentRecord.explanationRefs.filter(
      (ref) => !ref.startsWith("critical-obligations-completeness:"),
    );
  const missingCommitmentBlocked = await catchesCode(
    () =>
      new SupabaseFinancialStateReaderV1_2(
        completenessClient(true) as never,
        USER_ID,
        new FixtureV1_1Reader(missingCommitmentRecord),
      ).getLatestContext(USER_ID),
    "financial_state_critical_obligations_integrity_mismatch",
  );

  const crossUserBase = new FixtureV1_1Reader(record(true));
  const crossUserClient = completenessClient(true);
  const crossUserReader = new SupabaseFinancialStateReaderV1_2(
    crossUserClient as never,
    USER_ID,
    crossUserBase,
  );
  const crossUserBlocked = await catchesCode(
    () => crossUserReader.getLatestContext(OTHER_USER_ID),
    "financial_state_user_mismatch",
  );

  const query = complete.client.queries[0];
  const checks = {
    explicitTrueCanPreserveSafe:
      complete.state?.status === "SAFE" &&
      complete.state.canAssertSafety === true &&
      complete.state.money.availableRealMinor === 1640000,
    explicitFalseForcesDegraded:
      incomplete.state?.status === "DEGRADED" &&
      incomplete.state.canAssertSafety === false &&
      incomplete.state.money.availableRealMinor === null &&
      incomplete.state.firstForecastRisk === null &&
      incomplete.state.attention.outcome === "CONNECTION_REQUIRED",
    completenessReadIsOwnerAndRevisionScoped:
      query?.table === "eos_financial_contexts_v1" &&
      query.query.selected === "revision,critical_obligations_complete" &&
      query.query.predicates.some(
        ([column, value]) => column === "usuario_id" && value === USER_ID,
      ) &&
      query.query.predicates.some(
        ([column, value]) => column === "revision" && value === REVISION,
      ),
    completenessReadNeverTouchesRawLedger:
      complete.client.queries.every(
        ({ table }) =>
          table !== "eos_financial_ledger_v1" &&
          table !== "eos_financial_ingestion_events_v1",
      ),
    tamperedBooleanFailsClosed: tamperedBlocked,
    malformedBooleanFailsClosed: malformedBlocked,
    missingCompletenessCommitmentFailsClosed: missingCommitmentBlocked,
    crossUserFailsBeforeAnyRead:
      crossUserBlocked &&
      crossUserBase.contextCalls === 0 &&
      crossUserClient.queries.length === 0,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    completeState: complete.state,
    incompleteState: incomplete.state,
    queryAudit: complete.client.queries.map(({ table, query: item }) => ({
      table,
      selected: item.selected,
      predicates: item.predicates,
    })),
  };
}
