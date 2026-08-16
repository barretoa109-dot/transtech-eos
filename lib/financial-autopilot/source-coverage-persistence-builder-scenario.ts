import {
  CRITICAL_SOURCES_COMPLETENESS_PREFIX,
  SOURCE_COVERAGE_EVIDENCE_PREFIX,
  buildFinancialPersistencePlanV1_3,
  criticalSourcesCompletenessMatches,
} from "./critical-sources-persistence";
import { financialContextIntegrityMatches } from "./financial-context-integrity";
import {
  TRUSTED_SOURCE_INVENTORY_VERSION,
  financialAccountSourceCoverageRef,
  type TrustedFinancialSourceInventory,
} from "./source-coverage";
import type { FinancialAccount, FinancialConnectorSnapshot } from "./types";
import { buildZeroEntryFinancialAutopilot } from "./zero-entry";

const USER_ID = "00000000-0000-4000-8000-000000000104";
const AS_OF = "2026-08-16T12:00:00.000Z";
const DEFAULT_COVERAGE_VALID_UNTIL = "2026-08-16T18:00:00.000Z";
const SHA256_REVISION = /^ctx:[a-f0-9]{64}$/;

function account(): FinancialAccount {
  return {
    id: "20000000-0000-4000-8000-000000000104",
    userId: USER_ID,
    externalAccountId: "builder-checking-001",
    connectionId: "10000000-0000-4000-8000-000000000104",
    type: "checking",
    institutionName: "Builder Fixture Bank",
    displayName: "Builder checking",
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: 5000000,
    ledgerBalanceMinor: 5000000,
    balanceAsOf: AS_OF,
    freshUntil: "2026-08-17T12:00:00.000Z",
  };
}

function snapshot(): FinancialConnectorSnapshot {
  return {
    providerKey: "mock_source_coverage_builder_v1",
    fetchedAt: AS_OF,
    accounts: [account()],
    ledgerEntries: [],
  };
}

function inventory(
  snapshotValue: FinancialConnectorSnapshot,
  validUntil = DEFAULT_COVERAGE_VALID_UNTIL,
): TrustedFinancialSourceInventory {
  const connected = snapshotValue.accounts[0];
  if (!connected) throw new Error("builder fixture missing account");
  return {
    version: TRUSTED_SOURCE_INVENTORY_VERSION,
    userId: USER_ID,
    asOf: AS_OF,
    validUntil,
    authority: "provider_discovery",
    scope: "global_user_finances",
    discoveryComplete: true,
    confidence: 0.99,
    unresolvedMaterialSourceCount: 0,
    expectedSources: [
      {
        sourceRef: financialAccountSourceCoverageRef({
          userId: USER_ID,
          providerKey: snapshotValue.providerKey,
          account: connected,
        }),
        materiality: "critical",
        confidence: 0.99,
      },
    ],
  };
}

function build(validUntil = DEFAULT_COVERAGE_VALID_UNTIL) {
  const snapshotValue = snapshot();
  const result = buildZeroEntryFinancialAutopilot({
    trustedUserId: USER_ID,
    snapshot: snapshotValue,
    sourceCoverageInventory: inventory(snapshotValue, validUntil),
    currency: "PYG",
    asOf: AS_OF,
    protectedReserveMinor: 1000000,
    criticalObligationsComplete: true,
    criticalProvisionsMinor: 0,
    baseUncertaintyBufferMinor: 0,
  });
  const plan = buildFinancialPersistencePlanV1_3({
    snapshot: snapshotValue,
    result,
  });
  return { snapshotValue, result, plan };
}

export function runSourceCoveragePersistenceBuilderScenario() {
  const first = build();
  const replay = build();
  const laterEvidence = build("2026-08-16T19:00:00.000Z");
  const explanationRefs = first.plan.contextInsert.explanationRefs;

  const checks = {
    resolverProducesCompleteCoverage:
      first.result.sourceCoverage.criticalSourcesComplete === true &&
      first.result.sourceCoverage.criticalSourcesFresh === true &&
      first.result.sourceCoverage.inventoryFingerprint !== null,
    v1_3PersistsDerivedBoolean:
      first.plan.contextInsert.criticalSourcesComplete === true,
    contextValidityIsBoundedBeforeIntegrityHash:
      first.plan.contextInsert.validUntil === DEFAULT_COVERAGE_VALID_UNTIL &&
      financialContextIntegrityMatches(
        first.plan.contextInsert,
        explanationRefs,
      ),
    sourceCoverageCommitmentsArePresentExactlyOnce:
      explanationRefs.filter((ref) =>
        ref.startsWith(SOURCE_COVERAGE_EVIDENCE_PREFIX),
      ).length === 1 &&
      explanationRefs.filter((ref) =>
        ref.startsWith(CRITICAL_SOURCES_COMPLETENESS_PREFIX),
      ).length === 1,
    persistedCompletenessCommitmentMatches:
      criticalSourcesCompletenessMatches({
        criticalSourcesComplete: true,
        explanationRefs,
      }),
    exactEvidenceProducesExactRevision:
      first.plan.contextInsert.revision === replay.plan.contextInsert.revision,
    coverageLifetimeChangeChangesRevision:
      first.plan.contextInsert.revision !==
        laterEvidence.plan.contextInsert.revision &&
      first.result.sourceCoverage.inventoryFingerprint !==
        laterEvidence.result.sourceCoverage.inventoryFingerprint,
    contextRevisionRemainsCompactSha256:
      SHA256_REVISION.test(first.plan.contextInsert.revision),
    coverageRefsDoNotExposeRawSourceIdentity:
      explanationRefs.every(
        (ref) =>
          !ref.includes("builder-checking-001") &&
          !ref.includes("Builder Fixture Bank"),
      ),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    revision: first.plan.contextInsert.revision,
    validUntil: first.plan.contextInsert.validUntil,
    coverageFingerprint: first.result.sourceCoverage.inventoryFingerprint,
  };
}
