import type { AvailableRealInput, AvailableRealResult } from "./types";

function assertFiniteNonNegative(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
}

export function calculateAvailableReal(input: AvailableRealInput): AvailableRealResult {
  const threshold = input.safeConfidenceThreshold ?? 0.8;

  const numericFields: Array<[string, number]> = [
    ["liquidityUsableMinor", input.liquidityUsableMinor],
    ["protectedCommitmentsMinor", input.protectedCommitmentsMinor],
    ["essentialSpendExpectedMinor", input.essentialSpendExpectedMinor],
    ["protectedReserveMinor", input.protectedReserveMinor],
    ["criticalProvisionsMinor", input.criticalProvisionsMinor],
    ["confirmedIncomeMinor", input.confirmedIncomeMinor],
    ["uncertaintyBufferMinor", input.uncertaintyBufferMinor],
  ];

  for (const [name, value] of numericFields) assertFiniteNonNegative(name, value);

  if (!Number.isFinite(input.minimumProjectedCashMinor)) {
    throw new Error("minimumProjectedCashMinor must be finite");
  }

  const degradedReasons: string[] = [];
  if (!input.sourcesFresh) degradedReasons.push("critical_source_stale");
  if (!input.criticalObligationsComplete) degradedReasons.push("critical_obligations_incomplete");
  if (input.confidence.overall < threshold) degradedReasons.push("overall_confidence_below_safe_threshold");

  const availableRealRawMinor =
    input.liquidityUsableMinor -
    input.protectedCommitmentsMinor -
    input.essentialSpendExpectedMinor -
    input.protectedReserveMinor -
    input.criticalProvisionsMinor +
    input.confirmedIncomeMinor;

  const availableAfterUncertainty = availableRealRawMinor - input.uncertaintyBufferMinor;
  const availableRealSafeMinor = Math.max(0, Math.trunc(availableAfterUncertainty));
  const shortfallMinor = Math.max(0, Math.trunc(-availableAfterUncertainty));

  if (degradedReasons.length > 0) {
    return {
      status: "DEGRADED",
      currency: input.currency,
      availableRealRawMinor: Math.trunc(availableRealRawMinor),
      availableRealSafeMinor,
      shortfallMinor,
      needsUserAction: false,
      degradedReasons,
    };
  }

  if (shortfallMinor > 0 || input.minimumProjectedCashMinor < input.protectedReserveMinor) {
    return {
      status: "ACTION_REQUIRED",
      currency: input.currency,
      availableRealRawMinor: Math.trunc(availableRealRawMinor),
      availableRealSafeMinor,
      shortfallMinor,
      needsUserAction: true,
      degradedReasons: [],
    };
  }

  const attentionFloor = Math.max(
    input.protectedReserveMinor,
    Math.trunc(input.essentialSpendExpectedMinor * 0.25),
  );

  if (availableRealSafeMinor <= attentionFloor) {
    return {
      status: "ATTENTION",
      currency: input.currency,
      availableRealRawMinor: Math.trunc(availableRealRawMinor),
      availableRealSafeMinor,
      shortfallMinor: 0,
      needsUserAction: false,
      degradedReasons: [],
    };
  }

  return {
    status: "SAFE",
    currency: input.currency,
    availableRealRawMinor: Math.trunc(availableRealRawMinor),
    availableRealSafeMinor,
    shortfallMinor: 0,
    needsUserAction: false,
    degradedReasons: [],
  };
}
