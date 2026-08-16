export const FINANCIAL_STATE_API_FLAG = "EOS_FINANCIAL_STATE_V1_ENABLED";

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

  return env.NODE_ENV !== "production";
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
