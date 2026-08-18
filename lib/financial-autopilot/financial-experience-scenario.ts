import { buildFinancialConstitutionV1 } from "./financial-constitution";
import { buildFinancialExperienceModel } from "./financial-experience";
import type { FinancialStateView } from "./financial-state";
import { buildFinancialSurfaceModel } from "./financial-surface";

const REVISION = `ctx:${"e".repeat(64)}`;

function state(
  status: FinancialStateView["status"] = "SAFE",
  outcome: FinancialStateView["attention"]["outcome"] = "NO_ACTION",
): FinancialStateView {
  const degraded = status === "DEGRADED";
  const action = status === "ACTION_REQUIRED";
  return {
    version: "financial-state-v1",
    contextRevision: REVISION,
    status,
    currency: "PYG",
    asOf: "2026-08-16T16:30:00.000-03:00",
    validUntil: degraded ? null : "2026-08-17T16:30:00.000-03:00",
    headline: action ? "Necesito una decisión tuya." : degraded ? "Necesito actualizar tus datos financieros." : "Todo está bajo control.",
    detail: action ? "Elige cómo proteger tus prioridades." : degraded ? "La conexión principal está vencida." : "No necesitas hacer nada.",
    canAssertSafety: !degraded,
    money: {
      availableRealMinor: degraded ? null : 2_460_000,
      protectedCommitmentsMinor: 4_500_000,
      protectedReserveMinor: 5_000_000,
    },
    nextProtectedCommitment: degraded
      ? null
      : {
          type: "card",
          amountMinor: 2_400_000,
          currency: "PYG",
          dueAt: "2026-08-25T12:00:00.000-03:00",
        },
    firstForecastRisk: null,
    attention: {
      required: action || degraded,
      interrupt: action || degraded,
      outcome,
      message: action ? "Necesito que elijas una alternativa." : degraded ? "Actualiza la conexión principal." : "No necesitas hacer nada.",
    },
    freshness: {
      status: degraded ? "STALE" : "FRESH",
      sourcesFresh: !degraded,
      freshUntil: "2026-08-17T16:30:00.000-03:00",
    },
    trace: { explanationAvailable: true, explanationRefCount: 8 },
  };
}

export function runFinancialExperienceScenario() {
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
  const safeSurface = buildFinancialSurfaceModel({ kind: "STATE", state: state() });
  const base = {
    consentGranted: true,
    criticalSourcesComplete: true,
    baselineComplete: true,
    constitution,
    surface: safeSurface,
  } as const;

  const noConsent = buildFinancialExperienceModel({ ...base, consentGranted: false });
  const missingSource = buildFinancialExperienceModel({
    ...base,
    criticalSourcesComplete: false,
    missingSourceLabel: "la tarjeta terminada en 4821",
  });
  const baseline = buildFinancialExperienceModel({ ...base, baselineComplete: false });
  const constitutionRequired = buildFinancialExperienceModel({ ...base, constitution: null });
  const safe = buildFinancialExperienceModel(base);
  const silent = buildFinancialExperienceModel({
    ...base,
    surface: buildFinancialSurfaceModel({
      kind: "STATE",
      state: state("ATTENTION", "SILENT_ADJUSTMENT"),
    }),
  });
  const decision = buildFinancialExperienceModel({
    ...base,
    surface: buildFinancialSurfaceModel({
      kind: "STATE",
      state: state("ACTION_REQUIRED", "USER_DECISION_REQUIRED"),
    }),
  });
  const degraded = buildFinancialExperienceModel({
    ...base,
    surface: buildFinancialSurfaceModel({
      kind: "STATE",
      state: state("DEGRADED", "CONNECTION_REQUIRED"),
    }),
  });
  const paused = buildFinancialExperienceModel({ ...base, pausedReason: "SECURITY" });

  let executionRejected = false;
  try {
    buildFinancialConstitutionV1({
      ...constitution,
      executionAuthorityMinor: 1,
    });
  } catch (error) {
    executionRejected =
      error instanceof Error &&
      error.message === "financial_constitution_pilot_execution_must_be_zero";
  }

  const checks = {
    constitutionIsVersionedAndConfirmed:
      constitution.policyVersion === 1 &&
      constitution.policyFingerprint.startsWith("policy:") &&
      constitution.confirmedAt !== null,
    pilotExecutionAuthorityIsZero: constitution.executionAuthorityMinor === 0,
    nonZeroExecutionIsRejected: executionRejected,
    noConsentNeedsOneAuthorization: noConsent.phase === "CONNECTING" && noConsent.userNeed === "AUTHORIZE_SOURCE" && noConsent.interventionLevel === "I4",
    incompleteCoverageNeverClaimsSafety: missingSource.phase === "CONNECTING" && !missingSource.canShowFinancialSafety && missingSource.userNeed === "CONNECT_SOURCE",
    baselineWorkDoesNotInterrupt: baseline.phase === "BUILDING_BASELINE" && baseline.userNeed === "NOTHING" && !baseline.interrupt,
    constitutionIsAskedOnceBeforeReady: constitutionRequired.phase === "CONSTITUTION_REQUIRED" && constitutionRequired.userNeed === "CONFIRM_CONSTITUTION" && constitutionRequired.interventionLevel === "I3",
    safeNeedsNothing: safe.phase === "READY" && safe.userNeed === "NOTHING" && safe.interventionLevel === "I0" && safe.canShowFinancialSafety,
    silentAdjustmentStaysSilent: silent.phase === "READY" && silent.interventionLevel === "I2" && silent.userNeed === "NOTHING" && !silent.interrupt,
    hardConflictNeedsOneDecision: decision.phase === "READY" && decision.userNeed === "MAKE_DECISION" && decision.interventionLevel === "I3" && decision.interrupt,
    degradedNeedsConnectionAndHidesSafety: degraded.userNeed === "REFRESH_CONNECTION" && degraded.interventionLevel === "I4" && !degraded.canShowFinancialSafety,
    securityPauseWinsOverHealthyState: paused.phase === "PAUSED" && paused.userNeed === "SECURITY_REVIEW" && !paused.canShowFinancialSafety,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    constitution,
    experiences: { noConsent, missingSource, baseline, constitutionRequired, safe, silent, decision, degraded, paused },
  };
}
