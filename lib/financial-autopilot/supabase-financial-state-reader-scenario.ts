import {
  SupabaseFinancialStateReader,
  parsePersistedFinancialContextRow,
  parsePersistedFinancialObligationRow,
} from "./supabase-financial-state-reader";

const USER_ID = "00000000-0000-4000-8000-000000000080";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000081";
const CONTEXT_REVISION = `ctx:${"a".repeat(64)}`;

function contextRow(overrides: Record<string, unknown> = {}) {
  return {
    usuario_id: USER_ID,
    revision: CONTEXT_REVISION,
    currency: "PYG",
    status: "SAFE",
    horizon_until: "2026-09-01T12:00:00.000Z",
    liquidity_usable_minor: 8000000,
    protected_commitments_minor: 2100000,
    protected_reserve_minor: 3000000,
    available_real_safe_minor: 1640000,
    minimum_projected_cash_minor: 6005000,
    minimum_projected_cash_at: "2026-08-25T00:00:00.000Z",
    confidence: {
      sourceFreshness: 0.98,
      incomePredictability: 1,
      expensePredictability: 0.73,
      obligationCompleteness: 0.96,
      reconciliationQuality: 1,
      overall: 0.932,
    },
    explanation_refs: ["account:checking", "obligation:rent"],
    sources_fresh: true,
    generated_at: "2026-08-16T04:00:00.000Z",
    valid_until: "2026-08-17T12:00:00.000Z",
    ...overrides,
  };
}

function obligationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "40000000-0000-4000-8000-000000000080",
    usuario_id: USER_ID,
    obligation_type: "housing",
    amount_minor: 2100000,
    currency: "PYG",
    due_at: "2026-08-25T00:00:00.000Z",
    priority: 100,
    must_protect: true,
    confidence: 0.95,
    source: "reader_fixture",
    ...overrides,
  };
}

class FakeQuery {
  readonly predicates: Array<[string, unknown]> = [];
  readonly orders: Array<[string, boolean]> = [];
  selected: string | null = null;
  limitValue: number | null = null;
  ltePredicate: [string, unknown] | null = null;

  constructor(
    readonly table: string,
    private readonly response: { data: unknown; error: { code?: string } | null },
  ) {}

  select(columns: string) {
    this.selected = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.predicates.push([column, value]);
    return this;
  }

  lte(column: string, value: unknown) {
    this.ltePredicate = [column, value];
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.orders.push([column, options.ascending]);
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.response);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { code?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

class FakeSupabaseClient {
  readonly queries: FakeQuery[] = [];

  constructor(
    private readonly responses: Record<
      string,
      { data: unknown; error: { code?: string } | null }
    >,
  ) {}

  from(table: string) {
    const query = new FakeQuery(
      table,
      this.responses[table] ?? { data: null, error: { code: "missing_fixture" } },
    );
    this.queries.push(query);
    return query;
  }
}

function catchesCode(work: () => unknown | Promise<unknown>, code: string) {
  return Promise.resolve()
    .then(work)
    .then(
      () => false,
      (error) => error instanceof Error && error.message === code,
    );
}

export async function runSupabaseFinancialStateReaderScenario() {
  const parsedContext = parsePersistedFinancialContextRow(contextRow(), USER_ID);
  const parsedObligation = parsePersistedFinancialObligationRow(
    obligationRow(),
    USER_ID,
    "PYG",
  );

  const fake = new FakeSupabaseClient({
    eos_financial_contexts_v1: { data: contextRow(), error: null },
    eos_financial_obligations_v1: { data: [obligationRow()], error: null },
  });
  const reader = new SupabaseFinancialStateReader(fake as never, USER_ID);
  const latest = await reader.getLatestContext(USER_ID);
  const obligations = await reader.getOpenObligations({
    userId: USER_ID,
    currency: "PYG",
    horizonUntil: "2026-09-01T12:00:00.000Z",
  });

  const contextQuery = fake.queries.find((query) => query.table === "eos_financial_contexts_v1");
  const obligationQuery = fake.queries.find(
    (query) => query.table === "eos_financial_obligations_v1",
  );

  const ownerMismatchBlocked = await catchesCode(
    () => parsePersistedFinancialContextRow(contextRow({ usuario_id: OTHER_USER_ID }), USER_ID),
    "financial_state_owner_mismatch",
  );
  const malformedRevisionBlocked = await catchesCode(
    () => parsePersistedFinancialContextRow(contextRow({ revision: "ctx:not-a-hash" }), USER_ID),
    "financial_state_invalid_revision",
  );
  const unsafeIntegerBlocked = await catchesCode(
    () =>
      parsePersistedFinancialContextRow(
        contextRow({ liquidity_usable_minor: Number.MAX_SAFE_INTEGER + 1 }),
        USER_ID,
      ),
    "financial_state_invalid_liquidity",
  );
  const malformedConfidenceBlocked = await catchesCode(
    () =>
      parsePersistedFinancialContextRow(
        contextRow({ confidence: { ...contextRow().confidence, overall: 4 } }),
        USER_ID,
      ),
    "financial_state_invalid_confidence",
  );
  const obligationOwnerMismatchBlocked = await catchesCode(
    () =>
      parsePersistedFinancialObligationRow(
        obligationRow({ usuario_id: OTHER_USER_ID }),
        USER_ID,
        "PYG",
      ),
    "financial_state_obligation_owner_mismatch",
  );
  const obligationCurrencyMismatchBlocked = await catchesCode(
    () =>
      parsePersistedFinancialObligationRow(obligationRow({ currency: "USD" }), USER_ID, "PYG"),
    "financial_state_obligation_currency_mismatch",
  );
  const crossUserReadBlocked = await catchesCode(
    () => reader.getLatestContext(OTHER_USER_ID),
    "financial_state_user_mismatch",
  );

  const readErrorClient = new FakeSupabaseClient({
    eos_financial_contexts_v1: { data: null, error: { code: "42501" } },
  });
  const readErrorBlocked = await catchesCode(
    () =>
      new SupabaseFinancialStateReader(readErrorClient as never, USER_ID).getLatestContext(USER_ID),
    "financial_state_context_read_failed:42501",
  );

  const checks = {
    contextParserMapsStrictly:
      parsedContext.userId === USER_ID &&
      parsedContext.revision === CONTEXT_REVISION &&
      parsedContext.availableRealSafeMinor === 1640000,
    obligationParserMapsStrictly:
      parsedObligation.userId === USER_ID &&
      parsedObligation.type === "housing" &&
      parsedObligation.amountMinor === 2100000,
    readerReturnsStrictParsedRows:
      latest?.revision === CONTEXT_REVISION &&
      obligations.length === 1 &&
      obligations[0]?.type === "housing",
    contextReadIsOwnerScopedAndMinimal:
      contextQuery?.predicates.some(
        ([column, value]) => column === "usuario_id" && value === USER_ID,
      ) === true &&
      contextQuery.limitValue === 1 &&
      contextQuery.orders.some(
        ([column, ascending]) => column === "generated_at" && ascending === false,
      ) &&
      !contextQuery.selected?.includes("source_fingerprint") &&
      !contextQuery.selected?.includes("essential_spend_expected_minor"),
    obligationsReadIsOwnerCurrencyStatusAndHorizonScoped:
      obligationQuery?.predicates.some(
        ([column, value]) => column === "usuario_id" && value === USER_ID,
      ) === true &&
      obligationQuery.predicates.some(
        ([column, value]) => column === "currency" && value === "PYG",
      ) &&
      obligationQuery.predicates.some(
        ([column, value]) => column === "status" && value === "open",
      ) &&
      obligationQuery.ltePredicate?.[0] === "due_at",
    rawLedgerNeverQueried:
      fake.queries.every(
        (query) =>
          query.table !== "eos_financial_ledger_v1" &&
          query.table !== "eos_financial_ingestion_events_v1",
      ),
    ownerMismatchFailsClosed: ownerMismatchBlocked,
    malformedRevisionFailsClosed: malformedRevisionBlocked,
    unsafeIntegerFailsClosed: unsafeIntegerBlocked,
    malformedConfidenceFailsClosed: malformedConfidenceBlocked,
    obligationOwnerMismatchFailsClosed: obligationOwnerMismatchBlocked,
    obligationCurrencyMismatchFailsClosed: obligationCurrencyMismatchBlocked,
    crossUserReadFailsBeforeQuery: crossUserReadBlocked,
    databaseReadErrorFailsClosed: readErrorBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    parsedContext,
    parsedObligation,
    queryAudit: fake.queries.map((query) => ({
      table: query.table,
      predicates: query.predicates,
      lte: query.ltePredicate,
      orders: query.orders,
      limit: query.limitValue,
      selected: query.selected,
    })),
  };
}
