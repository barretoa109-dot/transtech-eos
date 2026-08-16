import {
  FINANCIAL_STATE_API_FLAG,
  financialStateApiHeaders,
  isFinancialStateApiEnabled,
  isFinancialStateDemoAllowed,
  isFinancialStateSurfaceVisible,
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
    productionDemoDisabled: !isFinancialStateDemoAllowed({
      VERCEL_ENV: "production",
      NODE_ENV: "production",
    }),
    previewDemoAllowed: isFinancialStateDemoAllowed({
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
    }),
    localDevelopmentDemoAllowed: isFinancialStateDemoAllowed({
      NODE_ENV: "development",
    }),
    localProductionFailsClosed: !isFinancialStateDemoAllowed({
      NODE_ENV: "production",
    }),
    productionSurfaceHiddenByDefault: !isFinancialStateSurfaceVisible({
      VERCEL_ENV: "production",
      NODE_ENV: "production",
    }),
    productionSurfaceVisibleWhenApiEnabled: isFinancialStateSurfaceVisible({
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      [FINANCIAL_STATE_API_FLAG]: "true",
    }),
    previewSurfaceVisibleWithoutApi: isFinancialStateSurfaceVisible({
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
    }),
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
