export const FINANCIAL_STATE_API_FLAG = "EOS_FINANCIAL_STATE_V1_ENABLED";
export const FINANCIAL_STATE_V1_2_FLAG = "EOS_FINANCIAL_STATE_V1_2_ENABLED";

export const FINANCIAL_STATE_DEMO_KINDS = [
  "safe",
  "attention",
  "action",
  "degraded",
  "empty",
  "error",
] as const;

export type FinancialStateDemoKind = (typeof FINANCIAL_STATE_DEMO_KINDS)[number];
export type FinancialStateReadFailureCategory =
  | "security_boundary_violation"
  | "persisted_state_invalid"
  | "source_read_failed"
  | "unexpected";

const FINANCIAL_STATE_SECURITY_FAILURES = new Set([
  "financial_state_invalid_trusted_user",
  "financial_state_user_mismatch",
  "financial_state_owner_mismatch",
  "financial_state_obligation_owner_mismatch",
]);

export function isFinancialStateDemoKind(
  value: string | undefined,
): value is FinancialStateDemoKind {
  return (
    value !== undefined &&
    (FINANCIAL_STATE_DEMO_KINDS as readonly string[]).includes(value)
  );
}

export function classifyFinancialStateReadFailure(
  error: unknown,
): FinancialStateReadFailureCategory {
  if (!(error instanceof Error)) return "unexpected";

  const code = error.message.split(":", 1)[0];
  if (FINANCIAL_STATE_SECURITY_FAILURES.has(code)) {
    return "security_boundary_violation";
  }
  if (code.endsWith("_read_failed")) return "source_read_failed";
  if (code.startsWith("financial_state_")) return "persisted_state_invalid";
  return "unexpected";
}

export function isFinancialStateApiEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env[FINANCIAL_STATE_API_FLAG] === "true";
}

/**
 * Secondary, server-only rollout switch for the v1.2 persisted critical-
 * obligation completeness contract. It never enables the API by itself; the
 * primary Financial State API flag must already be on.
 */
export function isFinancialStateV1_2Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env[FINANCIAL_STATE_V1_2_FLAG] === "true";
}

export function isFinancialStateDemoAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const vercelEnv = env.VERCEL_ENV;

  if (vercelEnv === "preview" || vercelEnv === "development") {
    return true;
  }

  if (vercelEnv === "production") {
    return false;
  }

  // Fail closed whenever the runtime is ambiguous. Local Next.js development
  // sets NODE_ENV=development explicitly, so there is no need to treat a
  // missing/unknown environment as demo-safe.
  return env.NODE_ENV === "development";
}

export function isFinancialStateSurfaceVisible(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return isFinancialStateApiEnabled(env) || isFinancialStateDemoAllowed(env);
}

export function financialStateApiHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    Vary: "Cookie",
    "X-Robots-Tag": "noindex",
  } as const;
}
