import type { BuiltFinancialContext } from "./context";
import type { FinancialDecisionCandidate } from "./decision";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export interface DecisionCandidateContext {
  financialContext: BuiltFinancialContext;
  protectedReserveMinor: number;
}

export function generateFinancialDecisionCandidates(
  input: DecisionCandidateContext,
): FinancialDecisionCandidate[] {
  const context = input.financialContext;
  const status = context.available.status;

  if (status === "SAFE" || status === "DEGRADED") return [];

  const base = Math.max(1, context.liquidityUsableMinor);
  const shortfall = context.available.shortfallMinor;
  const reserveGap = Math.max(0, input.protectedReserveMinor - context.minimumProjectedCashMinor);
  const severity = clamp01(Math.max(shortfall, reserveGap) / base);

  if (status === "ACTION_REQUIRED") {
    return [
      {
        id: "protect-critical-liquidity",
        kind: "protect_critical_liquidity",
        message:
          "Necesito ajustar una decisión antes de continuar para mantener cubiertos tus compromisos y tu reserva.",
        safetyImpact: 1,
        goalImpact: 0.6,
        urgency: clamp01(0.65 + severity),
        materiality: clamp01(0.7 + severity),
        confidence: 0.95,
        reversibility: 0.9,
        userEffort: 0.25,
        psychologicalCost: 0.2,
        autonomyEligible: false,
        requiresUserDecision: true,
      },
    ];
  }

  return [
    {
      id: "tighten-safe-available",
      kind: "tighten_safe_available",
      message:
        "Detecté una desviación y ajusté tu disponible recomendado. Tus compromisos siguen protegidos.",
      safetyImpact: 0.8,
      goalImpact: 0.25,
      urgency: clamp01(0.35 + severity),
      materiality: clamp01(0.35 + severity),
      confidence: 0.9,
      reversibility: 1,
      userEffort: 0,
      psychologicalCost: 0.05,
      autonomyEligible: true,
      requiresUserDecision: false,
    },
  ];
}
