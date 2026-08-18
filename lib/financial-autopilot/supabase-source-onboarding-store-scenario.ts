import { financialSourceCoverageRef, type TrustedFinancialSourceInventory } from "./source-coverage";
import { buildFinancialReadConsentV1 } from "./source-onboarding";
import { SupabaseSourceOnboardingStore, type SourceOnboardingRpcClient } from "./supabase-source-onboarding-store";

const USER = "00000000-0000-4000-8000-000000000041";
const COMMIT = "00000000-0000-4000-8000-000000000042";
const NOW = "2026-08-17T01:30:00.000Z";

function fixture() {
  const consent = buildFinancialReadConsentV1({ trustedUserId: USER, providerKey: "mock", grantedAt: "2026-08-17T01:00:00.000Z", validUntil: "2026-09-17T01:00:00.000Z", readScopes: ["ACCOUNTS_READ", "BALANCES_READ", "TRANSACTIONS_READ", "LIABILITIES_READ"] });
  const inventory: TrustedFinancialSourceInventory = {
    version: "trusted-financial-source-inventory-v1",
    userId: USER,
    asOf: "2026-08-17T01:10:00.000Z",
    validUntil: "2026-08-18T01:10:00.000Z",
    authority: "user_confirmed",
    scope: "global_user_finances",
    discoveryComplete: true,
    confidence: 0.98,
    unresolvedMaterialSourceCount: 0,
    expectedSources: [{ sourceRef: financialSourceCoverageRef({ userId: USER, providerKey: "mock", connectionId: "connection", externalAccountId: "account" }), materiality: "critical", confidence: 0.99 }],
  };
  return { consent, inventory };
}

async function rejects(run: () => Promise<unknown>, code: string) {
  try { await run(); return false; } catch (error) { return error instanceof Error && error.message === code; }
}

export async function runSupabaseSourceOnboardingStoreScenario() {
  const { consent, inventory } = fixture();
  let captured: Record<string, unknown> | null = null;
  const client: SourceOnboardingRpcClient = {
    async rpc(_name, args) {
      captured = args;
      return { data: { commitId: COMMIT, version: 1, consentFingerprint: args.p_consent_fingerprint, inventoryFingerprint: args.p_inventory_fingerprint, replayed: false }, error: null };
    },
  };
  const receipt = await new SupabaseSourceOnboardingStore(client, USER).persist({ consent, inventory, expectedCurrentVersion: 0, nowIso: NOW });
  const otherInventory = { ...inventory, userId: "00000000-0000-4000-8000-000000000099" };
  const crossUserRejected = await rejects(() => new SupabaseSourceOnboardingStore(client, USER).persist({ consent, inventory: otherInventory, expectedCurrentVersion: 0, nowIso: NOW }), "financial_source_onboarding_inventory_owner_mismatch");
  const leakingClient: SourceOnboardingRpcClient = { async rpc() { return { data: null, error: { code: "23505" } }; } };
  const safeError = await rejects(() => new SupabaseSourceOnboardingStore(leakingClient, USER).persist({ consent, inventory, expectedCurrentVersion: 0, nowIso: NOW }), "financial_source_onboarding_rpc_failed:23505");
  const sent = captured as Record<string, unknown> | null;
  const checks = {
    trustedUserBound: sent?.p_usuario_id === USER,
    noCredentialsInPayload: !JSON.stringify(sent).toLowerCase().includes("secret") && !JSON.stringify(sent).toLowerCase().includes("token"),
    receiptVerified: receipt.version === 1 && !receipt.replayed,
    crossUserRejected,
    databaseDetailsNotLeaked: safeError,
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}
