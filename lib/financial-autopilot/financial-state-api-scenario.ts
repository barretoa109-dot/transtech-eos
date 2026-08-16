import {
  FINANCIAL_STATE_API_FLAG,
  financialStateApiHeaders,
  isFinancialStateApiEnabled,
} from "./financial-state-api-policy";

export function runFinancialStateApiScenario() {
  const headers = financialStateApiHeaders();
  const checks = {
    disabledByDefault: !isFinancialStateApiEnabled({}),
    exactTrueEnables: isFinancialStateApiEnabled({
      [FINANCIAL_STATE_API_FLAG]: "true",
    }),
    nearValuesStayDisabled:
      !isFinancialStateApiEnabled({ [FINANCIAL_STATE_API_FLAG]: "TRUE" }) &&
      !isFinancialStateApiEnabled({ [FINANCIAL_STATE_API_FLAG]: "1" }) &&
      !isFinancialStateApiEnabled({ [FINANCIAL_STATE_API_FLAG]: "yes" }),
    responseIsPrivateNoStore:
      headers["Cache-Control"].includes("private") &&
      headers["Cache-Control"].includes("no-store") &&
      headers.Vary === "Cookie",
    responseIsNotIndexable: headers["X-Robots-Tag"] === "noindex",
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
  };
}
