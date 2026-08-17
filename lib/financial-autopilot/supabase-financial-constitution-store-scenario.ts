import { buildFinancialConstitutionV1 } from "./financial-constitution";
import {
  SupabaseFinancialConstitutionStore,
  type FinancialConstitutionRpcClient,
} from "./supabase-financial-constitution-store";

const USER_ID = "00000000-0000-4000-8000-000000000111";

export async function runSupabaseFinancialConstitutionStoreScenario() {
  const constitution = buildFinancialConstitutionV1({
    currency: "PYG",
    protectedLiquidityMinor: 5_000_000,
    minimumSavingsRateBps: 1_500,
    debtPolicy: "PAY_CARD_FULL",
    primaryGoal: { id: "emergency-fund", label: "Fondo de emergencia", priority: "HIGH" },
    approvalThresholdMinor: 2_000_000,
    autonomyLevel: "RECOMMEND",
    confirmedAt: "2026-08-16T17:00:00.000-03:00",
  });
  let capturedFunctionName: Parameters<FinancialConstitutionRpcClient["rpc"]>[0] | null = null;
  let capturedArgs: Parameters<FinancialConstitutionRpcClient["rpc"]>[1] | null = null;
  const client: FinancialConstitutionRpcClient = {
    async rpc(functionName, args) {
      capturedFunctionName = functionName;
      capturedArgs = args;
      return {
        data: {
          constitutionId: "00000000-0000-4000-8000-000000000211",
          version: 1,
          policyFingerprint: constitution.policyFingerprint,
          replayed: false,
        },
        error: null,
      };
    },
  };
  const store = new SupabaseFinancialConstitutionStore(client, USER_ID);
  const receipt = await store.persist({ constitution, expectedCurrentVersion: 0 });

  let tamperRejected = false;
  try {
    await store.persist({
      constitution: { ...constitution, protectedLiquidityMinor: 1 },
      expectedCurrentVersion: 0,
    });
  } catch (error) {
    tamperRejected =
      error instanceof Error &&
      error.message === "financial_constitution_fingerprint_mismatch";
  }

  const errorStore = new SupabaseFinancialConstitutionStore(
    {
      async rpc() {
        return { data: null, error: { code: "40001", message: "unsafe detail" } };
      },
    },
    USER_ID,
  );
  let safeError = false;
  try {
    await errorStore.persist({ constitution, expectedCurrentVersion: 0 });
  } catch (error) {
    safeError =
      error instanceof Error &&
      error.message === "financial_constitution_rpc_failed:40001" &&
      !error.message.includes("unsafe detail");
  }

  const args = capturedArgs as Parameters<FinancialConstitutionRpcClient["rpc"]>[1] | null;
  const checks = {
    serverBindsTrustedUser:
      capturedFunctionName === "eos_financial_persist_constitution_v1" &&
      args?.p_usuario_id === USER_ID,
    exactPolicyAndFingerprintSent:
      args?.p_policy_fingerprint === constitution.policyFingerprint &&
      args?.p_policy.executionAuthorityMinor === 0 &&
      args?.p_confirmed_at === constitution.confirmedAt,
    receiptValidated:
      receipt.version === 1 &&
      receipt.policyFingerprint === constitution.policyFingerprint &&
      !receipt.replayed,
    tamperedPolicyRejectedBeforeRpc: tamperRejected,
    databaseDetailsAreNotLeaked: safeError,
  };

  return { ok: Object.values(checks).every(Boolean), checks, receipt };
}
