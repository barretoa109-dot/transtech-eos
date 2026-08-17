import { buildFinancialReadConsentV1, buildFinancialSourceOnboarding } from "./source-onboarding";
import type { TrustedSourceCoverageResolution } from "./source-coverage";

const USER_ID = "00000000-0000-4000-8000-000000000031";
const NOW = "2026-08-17T01:00:00.000Z";

function coverage(overrides: Partial<TrustedSourceCoverageResolution> = {}): TrustedSourceCoverageResolution {
  return {
    criticalSourcesComplete: true,
    criticalSourcesFresh: true,
    expectedMaterialCount: 2,
    connectedMaterialCount: 2,
    missingMaterialCount: 0,
    staleConnectedSourceCount: 0,
    connectedSourceCount: 2,
    reasonCodes: [],
    freshnessReasonCodes: [],
    inventoryFingerprint: "a".repeat(64),
    coverageValidUntil: "2026-08-18T01:00:00.000Z",
    ...overrides,
  };
}

function rejects(run: () => unknown, code: string) {
  try {
    run();
    return false;
  } catch (error) {
    return error instanceof Error && error.message === code;
  }
}

export function runFinancialSourceOnboardingScenario() {
  const consent = buildFinancialReadConsentV1({
    trustedUserId: USER_ID,
    providerKey: "mock-read-provider",
    grantedAt: "2026-08-17T00:00:00.000Z",
    validUntil: "2026-09-17T00:00:00.000Z",
    readScopes: ["TRANSACTIONS_READ", "ACCOUNTS_READ", "LIABILITIES_READ", "BALANCES_READ"],
  });
  const needsConsent = buildFinancialSourceOnboarding({ trustedUserId: USER_ID, nowIso: NOW, consent: null, coverage: null });
  const discovering = buildFinancialSourceOnboarding({ trustedUserId: USER_ID, nowIso: NOW, consent, coverage: null });
  const missing = buildFinancialSourceOnboarding({
    trustedUserId: USER_ID,
    nowIso: NOW,
    consent,
    coverage: coverage({ criticalSourcesComplete: false, connectedMaterialCount: 1, missingMaterialCount: 1, reasonCodes: ["material_source_missing"] }),
    missingSourceLabel: "la tarjeta terminada en 4821",
  });
  const stale = buildFinancialSourceOnboarding({
    trustedUserId: USER_ID,
    nowIso: NOW,
    consent,
    coverage: coverage({ criticalSourcesFresh: false, staleConnectedSourceCount: 1, freshnessReasonCodes: ["connected_source_stale_or_unknown"] }),
  });
  const ready = buildFinancialSourceOnboarding({ trustedUserId: USER_ID, nowIso: NOW, consent, coverage: coverage() });
  const tamperedConsent = { ...consent, userId: "00000000-0000-4000-8000-000000000099" };
  const tampered = buildFinancialSourceOnboarding({ trustedUserId: USER_ID, nowIso: NOW, consent: tamperedConsent, coverage: coverage() });

  const checks = {
    consentIsReadOnlyAndFingerprintBound: consent.movementAuthority === false && /^[a-f0-9]{64}$/.test(consent.fingerprint),
    incompleteReadScopeRejected: rejects(() => buildFinancialReadConsentV1({ trustedUserId: USER_ID, providerKey: "mock", grantedAt: NOW, validUntil: "2026-09-17T00:00:00.000Z", readScopes: ["ACCOUNTS_READ"] }), "financial_consent_missing_read_scope"),
    missingConsentRequestsOneAction: needsConsent.state === "CONSENT_REQUIRED" && needsConsent.userAction === "AUTHORIZE_READ" && needsConsent.interrupt,
    discoveryRequiresNoBookkeeping: discovering.state === "DISCOVERING" && discovering.userAction === "NOTHING" && !discovering.interrupt,
    missingMaterialSourceBlocksBaseline: missing.state === "SOURCE_REQUIRED" && !missing.mayBuildBaseline && missing.userAction === "CONNECT_SOURCE",
    staleKnownSourceBlocksBaseline: stale.state === "REFRESH_REQUIRED" && !stale.mayBuildBaseline,
    completeFreshCoverageStartsBaseline: ready.state === "COVERAGE_READY" && ready.mayBuildBaseline && ready.userAction === "NOTHING",
    onboardingNeverClaimsSafety: [needsConsent, discovering, missing, stale, ready].every((item) => !item.mayAssertSafety),
    crossUserConsentFailsClosed: tampered.state === "CONSENT_REQUIRED" && !tampered.mayBuildBaseline,
  };

  return { ok: Object.values(checks).every(Boolean), checks };
}
