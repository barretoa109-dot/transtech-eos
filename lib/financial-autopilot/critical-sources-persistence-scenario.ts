import {
  CRITICAL_SOURCES_COMPLETENESS_PREFIX,
  SOURCE_COVERAGE_EVIDENCE_PREFIX,
  parsePersistedCriticalSourcesComplete,
  upgradeFinancialPersistencePlanWithCriticalSources,
  type FinancialPersistencePlanV1_3,
  type PersistableSourceCoverageEvidence,
} from "./critical-sources-persistence";
import { upgradeFinancialPersistencePlanWithCriticalObligations } from "./critical-obligations-persistence";
import { upgradeFinancialPersistencePlanWithFirstForecastRisk } from "./first-forecast-risk-persistence";
import type { FinancialPersistencePlan } from "./persistence";
import {
  SupabaseFinancialPersistenceStoreV1_3,
  type FinancialPersistenceRpcClientV1_3,
} from "./supabase-persistence-store-v1-3";
import type { FinancialStatus } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000100";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000101";
const BASE_FINGERPRINT = "3".repeat(64);
const COVERAGE_FINGERPRINT = "4".repeat(64);
const COVERAGE_VALID_UNTIL = "2026-08-17T06:00:00.000Z";
const SHA256_HEX = /^[a-f0-9]{64}$/;

function basePlan(
  userId = USER_ID,
  status: FinancialStatus = "SAFE",
): FinancialPersistencePlan {
  return {
    version: "financial-persistence-plan-v1",
    userId,
    providerKey: "mock_critical_sources_v1_3",
    connectionUpserts: [],
    accountUpserts: [],
    ingestionEventUpserts: [],
    ledgerUpserts: [],
    reconciliationInserts: [],
    recurrenceUpserts: [],
    obligationUpserts: [],
    contextInsert: {
      userId,
      revision: `ctx:${BASE_FINGERPRINT}`,
      sourceFingerprint: BASE_FINGERPRINT,
      currency: "PYG",
      status,
      horizonUntil: "2026-09-01T12:00:00.000Z",
      horizonReason: "rolling_fallback",
      liquidityUsableMinor: 8000000,
      protectedCommitmentsMinor: 2100000,
      essentialSpendExpectedMinor: 800000,
      protectedReserveMinor: 3000000,
      criticalProvisionsMinor: 100000,
      confirmedIncomeMinor: 0,
      uncertaintyBufferMinor: 360000,
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
      validUntil: COVERAGE_VALID_UNTIL,
    },
  };
}

function v1_2Plan(
  userId = USER_ID,
  status: FinancialStatus = "SAFE",
) {
  const v1_1 = upgradeFinancialPersistencePlanWithFirstForecastRisk({
    plan: basePlan(userId, status),
    firstRisk: null,
  });
  return upgradeFinancialPersistencePlanWithCriticalObligations({
    plan: v1_1,
    criticalObligationsComplete: true,
  });
}

function coverage(
  criticalSourcesComplete: boolean,
  patch: Partial<PersistableSourceCoverageEvidence> = {},
): PersistableSourceCoverageEvidence {
  return {
    criticalSourcesComplete,
    inventoryFingerprint: COVERAGE_FINGERPRINT,
    coverageValidUntil: COVERAGE_VALID_UNTIL,
    ...patch,
  };
}

class FakeRpcClient implements FinancialPersistenceRpcClientV1_3 {
  calls: Array<{
    functionName: string;
    trustedUserId: string;
    batch: FinancialPersistencePlanV1_3;
  }> = [];

  mode: "success" | "error" | "revision_mismatch" = "success";

  async rpc(
    functionName: "eos_financial_persist_snapshot_v1_3",
    args: { p_usuario_id: string; p_batch: FinancialPersistencePlanV1_3 },
  ) {
    this.calls.push({
      functionName,
      trustedUserId: args.p_usuario_id,
      batch: args.p_batch,
    });

    if (this.mode === "error") {
      return { data: null, error: { code: "XX003", message: "fixture error" } };
    }

    return {
      data: {
        replayed: false,
        contextRevision:
          this.mode === "revision_mismatch"
            ? `ctx:${"f".repeat(64)}`
            : args.p_batch.contextInsert.revision,
        ledgerRowsTouched: 0,
        ingestionRowsTouched: 0,
        reconciliationRowsTouched: 0,
      },
      error: null,
    };
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

export async function runCriticalSourcesPersistenceScenario() {
  const complete = upgradeFinancialPersistencePlanWithCriticalSources({
    plan: v1_2Plan(),
    sourceCoverage: coverage(true),
  });
  const replay = upgradeFinancialPersistencePlanWithCriticalSources({
    plan: v1_2Plan(),
    sourceCoverage: coverage(true),
  });
  const degradedComplete = upgradeFinancialPersistencePlanWithCriticalSources({
    plan: v1_2Plan(USER_ID, "DEGRADED"),
    sourceCoverage: coverage(true),
  });
  const incomplete = upgradeFinancialPersistencePlanWithCriticalSources({
    plan: v1_2Plan(USER_ID, "DEGRADED"),
    sourceCoverage: coverage(false),
  });
  const differentEvidence = upgradeFinancialPersistencePlanWithCriticalSources({
    plan: v1_2Plan(),
    sourceCoverage: coverage(true, { inventoryFingerprint: "5".repeat(64) }),
  });

  const inconsistentSafeIncompleteBlocked = await catchesCode(
    () =>
      upgradeFinancialPersistencePlanWithCriticalSources({
        plan: v1_2Plan(),
        sourceCoverage: coverage(false),
      }),
    "financial_persistence_critical_sources_conflict_with_status",
  );
  const malformedBooleanBlocked = await catchesCode(
    () => parsePersistedCriticalSourcesComplete("true"),
    "financial_state_invalid_critical_sources_complete",
  );
  const missingEvidenceForSafeBlocked = await catchesCode(
    () =>
      upgradeFinancialPersistencePlanWithCriticalSources({
        plan: v1_2Plan(),
        sourceCoverage: coverage(true, {
          inventoryFingerprint: null,
          coverageValidUntil: null,
        }),
      }),
    "financial_persistence_invalid_source_coverage_evidence",
  );
  const expiredEvidenceForSafeBlocked = await catchesCode(
    () =>
      upgradeFinancialPersistencePlanWithCriticalSources({
        plan: v1_2Plan(),
        sourceCoverage: coverage(true, {
          coverageValidUntil: "2026-08-16T12:00:00.000Z",
        }),
      }),
    "financial_persistence_invalid_source_coverage_evidence",
  );

  const noObligationCommitment = v1_2Plan();
  noObligationCommitment.contextInsert.explanationRefs =
    noObligationCommitment.contextInsert.explanationRefs.filter(
      (ref) => !ref.startsWith("critical-obligations-completeness:"),
    );
  const missingObligationCommitmentBlocked = await catchesCode(
    () =>
      upgradeFinancialPersistencePlanWithCriticalSources({
        plan: noObligationCommitment,
        sourceCoverage: coverage(true),
      }),
    "financial_persistence_critical_obligations_ref_missing",
  );

  const client = new FakeRpcClient();
  const store = new SupabaseFinancialPersistenceStoreV1_3(client, USER_ID);
  const success = await store.persist(complete);
  const callsAfterSuccess = client.calls.length;

  const crossUser = upgradeFinancialPersistencePlanWithCriticalSources({
    plan: v1_2Plan(OTHER_USER_ID),
    sourceCoverage: coverage(true),
  });
  const crossUserBlocked = await catchesCode(
    () => store.persist(crossUser),
    "financial_persistence_user_mismatch",
  );
  const callsAfterCrossUser = client.calls.length;

  client.mode = "revision_mismatch";
  const revisionMismatchBlocked = await catchesCode(
    () => store.persist(complete),
    "financial_persistence_context_revision_mismatch",
  );

  client.mode = "error";
  const rpcErrorBlocked = await catchesCode(
    () => store.persist(complete),
    "financial_persistence_rpc_failed:XX003",
  );

  const coverageRefs = complete.contextInsert.explanationRefs.filter((ref) =>
    ref.startsWith(CRITICAL_SOURCES_COMPLETENESS_PREFIX),
  );
  const evidenceRefs = complete.contextInsert.explanationRefs.filter((ref) =>
    ref.startsWith(SOURCE_COVERAGE_EVIDENCE_PREFIX),
  );
  const checks = {
    explicitBooleanPersisted:
      complete.contextInsert.criticalSourcesComplete === true &&
      incomplete.contextInsert.criticalSourcesComplete === false,
    sourceCoverageEvidenceCommitsToContextIdentity:
      coverageRefs.length === 1 &&
      evidenceRefs.length === 1 &&
      SHA256_HEX.test(complete.contextInsert.sourceFingerprint) &&
      complete.contextInsert.revision ===
        `ctx:${complete.contextInsert.sourceFingerprint}`,
    contextCannotOutliveCoverageEvidence:
      new Date(complete.contextInsert.validUntil).getTime() <=
      new Date(COVERAGE_VALID_UNTIL).getTime(),
    exactInputProducesExactIdentity:
      complete.contextInsert.sourceFingerprint === replay.contextInsert.sourceFingerprint,
    evidenceChangeChangesV1_3Revision:
      complete.contextInsert.revision !== differentEvidence.contextInsert.revision,
    booleanAloneChangesV1_3Revision:
      degradedComplete.contextInsert.revision !== incomplete.contextInsert.revision,
    falseCannotBePersistedAsSafe: inconsistentSafeIncompleteBlocked,
    malformedBooleanFailsClosed: malformedBooleanBlocked,
    safeRequiresCoverageEvidence: missingEvidenceForSafeBlocked,
    safeRequiresUnexpiredCoverageEvidence: expiredEvidenceForSafeBlocked,
    obligationCompletenessCommitmentIsRequired:
      missingObligationCommitmentBlocked,
    wrapperRpcIsFixed:
      client.calls[0]?.functionName === "eos_financial_persist_snapshot_v1_3",
    trustedUserPassedSeparately:
      client.calls[0]?.trustedUserId === USER_ID &&
      client.calls[0]?.batch.userId === USER_ID,
    crossUserBlockedBeforeRpc:
      crossUserBlocked &&
      callsAfterSuccess === 1 &&
      callsAfterCrossUser === callsAfterSuccess,
    persistenceReturnsMatchingRevision:
      success.contextRevision === complete.contextInsert.revision,
    revisionMismatchFailsClosed: revisionMismatchBlocked,
    rpcErrorFailsClosed: rpcErrorBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    completeRevision: complete.contextInsert.revision,
    degradedCompleteRevision: degradedComplete.contextInsert.revision,
    incompleteRevision: incomplete.contextInsert.revision,
    coverageRef: coverageRefs[0] ?? null,
    evidenceRef: evidenceRefs[0] ?? null,
    rpcCalls: client.calls.length,
  };
}
