export const FINANCIAL_STATE_API_FLAG = "EOS_FINANCIAL_STATE_V1_ENABLED";

export const FINANCIAL_STATE_DEMO_KINDS = [
  "safe",
  "attention",
  "action",
  "degraded",
  "empty",
  "error",
] as const;

export type FinancialStateDemoKind = (typeof FINANCIAL_STATE_DEMO_KINDS)[number];

export function isFinancialStateDemoKind(
  value: string | undefined,
): value is FinancialStateDemoKind {
  return (
    value !== undefined &&
    (FINANCIAL_STATE_DEMO_KINDS as readonly string[]).includes(value)
  );
}

export function isFinancialStateApiEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env[FINANCIAL_STATE_API_FLAG] === "true";
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
