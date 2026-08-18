import type { PersistedSourceOnboardingState } from "./source-onboarding-reader";
import { resolveAuthenticatedSourceOnboarding, type SourceOnboardingStateReader } from "./source-onboarding-service";
import { isFinancialOnboardingEnabled } from "./financial-state-api-policy";

const USER_A = "00000000-0000-4000-8000-000000000061";
const USER_B = "00000000-0000-4000-8000-000000000062";

class IsolatedReader implements SourceOnboardingStateReader {
  calls: string[] = [];
  constructor(private readonly rows: Map<string, PersistedSourceOnboardingState | null>) {}
  async getCurrent(userId: string) { this.calls.push(userId); return this.rows.get(userId) ?? null; }
}

async function catches(run: () => Promise<unknown>, code: string) {
  try { await run(); return false; } catch (error) { return error instanceof Error && error.message === code; }
}

export async function runSourceOnboardingServiceScenario() {
  const reader = new IsolatedReader(new Map([[USER_A, null], [USER_B, null]]));
  const a = await resolveAuthenticatedSourceOnboarding({ sessionUserId: USER_A, reader, nowIso: "2026-08-17T02:30:00.000Z", coverage: null });
  const b = await resolveAuthenticatedSourceOnboarding({ sessionUserId: USER_B, reader, nowIso: "2026-08-17T02:30:00.000Z", coverage: null });
  const unauthenticatedBlocked = await catches(() => resolveAuthenticatedSourceOnboarding({ sessionUserId: null, reader, nowIso: "2026-08-17T02:30:00.000Z", coverage: null }), "financial_source_onboarding_auth_required");
  const checks = {
    userAReadsOnlyOwnIdentity: reader.calls[0] === USER_A,
    userBReadsOnlyOwnIdentity: reader.calls[1] === USER_B,
    noCallerSelectedOwnerParameter: reader.calls.length === 2,
    noDataRequestsReadConsent: a.state === "CONSENT_REQUIRED" && b.state === "CONSENT_REQUIRED",
    unauthenticatedBlocked,
    responseNeverAssertsSafety: !a.mayAssertSafety && !b.mayAssertSafety,
    featureFlagDefaultsOff: !isFinancialOnboardingEnabled({}),
    featureFlagRequiresExactTrue: isFinancialOnboardingEnabled({ EOS_FINANCIAL_ONBOARDING_V1_ENABLED: "true" }) && !isFinancialOnboardingEnabled({ EOS_FINANCIAL_ONBOARDING_V1_ENABLED: "1" }),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}
