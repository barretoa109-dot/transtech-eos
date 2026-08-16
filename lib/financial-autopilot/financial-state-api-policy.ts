export const FINANCIAL_STATE_API_FLAG = "EOS_FINANCIAL_STATE_V1_ENABLED";

export function isFinancialStateApiEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env[FINANCIAL_STATE_API_FLAG] === "true";
}

export function financialStateApiHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    Vary: "Cookie",
    "X-Robots-Tag": "noindex",
  } as const;
}
