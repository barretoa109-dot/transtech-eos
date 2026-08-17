import { financialSourceCoverageRef, trustedFinancialSourceInventoryFingerprint, trustedFinancialSourceInventoryMaterial, type TrustedFinancialSourceInventory, type TrustedSourceCoverageResolution } from "./source-coverage";
import { buildFinancialReadConsentV1, financialReadConsentMaterial } from "./source-onboarding";
import { parsePersistedSourceOnboardingState, resolveSourceOnboardingReadModel, SupabaseSourceOnboardingReader } from "./source-onboarding-reader";

const USER = "00000000-0000-4000-8000-000000000051";
const OTHER = "00000000-0000-4000-8000-000000000099";
const NOW = "2026-08-17T02:00:00.000Z";

function fixtures() {
  const consent = buildFinancialReadConsentV1({ trustedUserId: USER, providerKey: "mock", grantedAt: "2026-08-17T01:00:00.000Z", validUntil: "2026-09-17T01:00:00.000Z", readScopes: ["ACCOUNTS_READ", "BALANCES_READ", "TRANSACTIONS_READ", "LIABILITIES_READ"] });
  const inventory: TrustedFinancialSourceInventory = { version: "trusted-financial-source-inventory-v1", userId: USER, asOf: "2026-08-17T01:10:00.000Z", validUntil: "2026-08-18T01:10:00.000Z", authority: "user_confirmed", scope: "global_user_finances", discoveryComplete: true, confidence: 0.98, unresolvedMaterialSourceCount: 0, expectedSources: [{ sourceRef: financialSourceCoverageRef({ userId: USER, providerKey: "mock", connectionId: "connection", externalAccountId: "account" }), materiality: "critical", confidence: 0.99 }] };
  const row = { usuario_id: USER, version: 1, consent: financialReadConsentMaterial(consent), consent_fingerprint: consent.fingerprint, inventory: trustedFinancialSourceInventoryMaterial(inventory), inventory_fingerprint: trustedFinancialSourceInventoryFingerprint(inventory), created_at: "2026-08-17T01:15:00.000Z" };
  return { row };
}

function coverage(complete: boolean): TrustedSourceCoverageResolution {
  return { criticalSourcesComplete: complete, criticalSourcesFresh: true, expectedMaterialCount: 1, connectedMaterialCount: complete ? 1 : 0, missingMaterialCount: complete ? 0 : 1, staleConnectedSourceCount: 0, connectedSourceCount: complete ? 1 : 0, reasonCodes: complete ? [] : ["material_source_missing"], freshnessReasonCodes: [], inventoryFingerprint: "a".repeat(64), coverageValidUntil: "2026-08-18T01:10:00.000Z" };
}

class FakeQuery {
  columns = "";
  predicates: Array<[string, unknown]> = [];
  constructor(private readonly response: { data: unknown; error: { code?: string } | null }) {}
  select(value: string) { this.columns = value; return this; }
  eq(column: string, value: unknown) { this.predicates.push([column, value]); return this; }
  is(column: string, value: unknown) { this.predicates.push([column, value]); return this; }
  limit() { return this; }
  maybeSingle() { return Promise.resolve(this.response); }
}
class FakeClient {
  table = "";
  query: FakeQuery | null = null;
  constructor(private readonly response: { data: unknown; error: { code?: string } | null }) {}
  from(table: string) { this.table = table; this.query = new FakeQuery(this.response); return this.query; }
}

async function catches(run: () => unknown | Promise<unknown>, code: string) {
  try { await run(); return false; } catch (error) { return error instanceof Error && error.message === code; }
}

export async function runSourceOnboardingReaderScenario() {
  const { row } = fixtures();
  const client = new FakeClient({ data: row, error: null });
  const persisted = await new SupabaseSourceOnboardingReader(client as never, USER).getCurrent(USER);
  const noCoverage = resolveSourceOnboardingReadModel({ trustedUserId: USER, nowIso: NOW, persisted, coverage: null });
  const incomplete = resolveSourceOnboardingReadModel({ trustedUserId: USER, nowIso: NOW, persisted, coverage: coverage(false), missingSourceLabel: "la tarjeta terminada en 4821" });
  const ready = resolveSourceOnboardingReadModel({ trustedUserId: USER, nowIso: NOW, persisted, coverage: coverage(true) });
  const tampered = { ...row, inventory: { ...(row.inventory as Record<string, unknown>), confidence: 0.5 } };
  const tamperBlocked = await catches(() => Promise.resolve(parsePersistedSourceOnboardingState(tampered, USER)), "financial_source_onboarding_inventory_integrity_mismatch");
  const crossUserBlocked = await catches(() => new SupabaseSourceOnboardingReader(client as never, USER).getCurrent(OTHER), "financial_source_onboarding_user_mismatch");
  const checks = {
    ownerScopedServerRead: client.table === "eos_financial_source_onboarding_commits_v1" && client.query?.predicates.some(([key, value]) => key === "usuario_id" && value === USER),
    readerSelectExcludesSensitivePayloads: !client.query?.columns.split(",").includes("id") && !client.query?.columns.split(",").includes("superseded_at"),
    absentCoverageCannotSelfPromote: noCoverage.state === "DISCOVERING" && !noCoverage.mayBuildBaseline && !noCoverage.mayAssertSafety,
    incompleteCoverageRequestsOneSource: incomplete.state === "SOURCE_REQUIRED" && incomplete.userAction === "CONNECT_SOURCE",
    trustedCompleteCoverageMayBuildBaseline: ready.state === "COVERAGE_READY" && ready.mayBuildBaseline && !ready.mayAssertSafety,
    fingerprintTamperBlocked: tamperBlocked,
    crossUserReadBlocked: crossUserBlocked,
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}
