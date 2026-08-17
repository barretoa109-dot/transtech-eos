import type { TrustedSourceCoverageResolution } from "./source-coverage";
import type { FinancialSourceOnboardingModel } from "./source-onboarding";
import {
  resolveSourceOnboardingReadModel,
  type PersistedSourceOnboardingState,
} from "./source-onboarding-reader";

export interface SourceOnboardingStateReader {
  getCurrent(userId: string): Promise<PersistedSourceOnboardingState | null>;
}

/** Authenticated server orchestration. The session identity is the only owner input. */
export async function resolveAuthenticatedSourceOnboarding(input: {
  sessionUserId: string | null;
  reader: SourceOnboardingStateReader;
  nowIso: string;
  coverage: TrustedSourceCoverageResolution | null;
  missingSourceLabel?: string | null;
}): Promise<FinancialSourceOnboardingModel> {
  if (!input.sessionUserId) {
    throw new Error("financial_source_onboarding_auth_required");
  }
  const persisted = await input.reader.getCurrent(input.sessionUserId);
  return resolveSourceOnboardingReadModel({
    trustedUserId: input.sessionUserId,
    nowIso: input.nowIso,
    persisted,
    coverage: input.coverage,
    missingSourceLabel: input.missingSourceLabel,
  });
}

export function sourceOnboardingReadFailureModel(): FinancialSourceOnboardingModel {
  return {
    version: "financial-source-onboarding-v1",
    state: "REFRESH_REQUIRED",
    progressPercent: 0,
    headline: "No pude verificar tus fuentes financieras.",
    detail: "EOS no mostrará una conclusión financiera hasta recuperar una lectura íntegra.",
    userAction: "REFRESH_SOURCE",
    actionLabel: "Volver a intentar",
    interrupt: true,
    mayBuildBaseline: false,
    mayAssertSafety: false,
  };
}
