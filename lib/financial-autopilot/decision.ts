import type { FinancialStatus } from "./types";

export type FinancialDecisionOutcome =
  | "NO_ACTION"
  | "SILENT_ADJUSTMENT"
  | "INFORM_NO_ACTION"
  | "USER_DECISION_REQUIRED"
  | "CONNECTION_REQUIRED";

export interface FinancialDecisionCandidate {
  id: string;
  kind: string;
  message: string;
  safetyImpact: number;
  goalImpact: number;
  urgency: number;
  materiality: number;
  confidence: number;
  reversibility: number;
  userEffort: number;
  psychologicalCost: number;
  autonomyEligible: boolean;
  requiresUserDecision: boolean;
  violatesHardConstraint?: boolean;
}

export interface NextBestFinancialAction {
  outcome: FinancialDecisionOutcome;
  candidateId: string | null;
  message: string;
  interrupt: boolean;
  score: number | null;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function scoreFinancialCandidate(candidate: FinancialDecisionCandidate) {
  const safety = clamp01(candidate.safetyImpact);
  const goal = clamp01(candidate.goalImpact);
  const urgency = clamp01(candidate.urgency);
  const materiality = clamp01(candidate.materiality);
  const confidence = clamp01(candidate.confidence);
  const reversibility = clamp01(candidate.reversibility);
  const effort = clamp01(candidate.userEffort);
  const psychologicalCost = clamp01(candidate.psychologicalCost);

  return (
    0.3 * safety +
    0.2 * urgency +
    0.2 * materiality +
    0.1 * goal +
    0.15 * confidence +
    0.05 * reversibility -
    0.1 * effort -
    0.1 * psychologicalCost
  );
}

export function selectNextBestFinancialAction(
  status: FinancialStatus,
  candidates: FinancialDecisionCandidate[],
): NextBestFinancialAction {
  if (status === "DEGRADED") {
    return {
      outcome: "CONNECTION_REQUIRED",
      candidateId: null,
      message: "Necesito información financiera actualizada antes de darte una respuesta material.",
      interrupt: true,
      score: null,
    };
  }

  const eligible = candidates
    .filter((candidate) => !candidate.violatesHardConstraint)
    .filter((candidate) => candidate.confidence >= 0.6)
    .map((candidate) => ({ candidate, score: scoreFinancialCandidate(candidate) }))
    .sort((a, b) => b.score - a.score);

  const top = eligible[0];
  if (!top || top.score < 0.25) {
    return {
      outcome: "NO_ACTION",
      candidateId: null,
      message: "Todo está bajo control. No necesitas hacer nada.",
      interrupt: false,
      score: top?.score ?? null,
    };
  }

  if (top.candidate.requiresUserDecision || status === "ACTION_REQUIRED") {
    return {
      outcome: "USER_DECISION_REQUIRED",
      candidateId: top.candidate.id,
      message: top.candidate.message,
      interrupt: true,
      score: top.score,
    };
  }

  if (top.candidate.autonomyEligible) {
    return {
      outcome: "SILENT_ADJUSTMENT",
      candidateId: top.candidate.id,
      message: top.candidate.message,
      interrupt: false,
      score: top.score,
    };
  }

  return {
    outcome: "INFORM_NO_ACTION",
    candidateId: top.candidate.id,
    message: top.candidate.message,
    interrupt: status === "ATTENTION" && top.candidate.urgency >= 0.8,
    score: top.score,
  };
}
