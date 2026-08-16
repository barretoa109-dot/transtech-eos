import {
  FINANCIAL_STATE_API_FLAG,
  FINANCIAL_STATE_V1_2_FLAG,
  classifyFinancialStateReadFailure,
  financialStateApiHeaders,
  isFinancialStateApiEnabled,
  isFinancialStateDemoAllowed,
  isFinancialStateSurfaceVisible,
  isFinancialStateV1_2Enabled,
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
    v1_2DisabledByDefault: !isFinancialStateV1_2Enabled({}),
    v1_2ExactTrueEnablesReaderSelection: isFinancialStateV1_2Enabled({
      [FINANCIAL_STATE_V1_2_FLAG]: "true",
    }),
    v1_2NearValuesStayDisabled:
      !isFinancialStateV1_2Enabled({ [FINANCIAL_STATE_V1_2_FLAG]: "TRUE" }) &&
      !isFinancialStateV1_2Enabled({ [FINANCIAL_STATE_V1_2_FLAG]: "1" }) &&
      !isFinancialStateV1_2Enabled({ [FINANCIAL_STATE_V1_2_FLAG]: "yes" }),
    v1_2FlagDoesNotExposeProductionSurfaceByItself:
      !isFinancialStateSurfaceVisible({
        VERCEL_ENV: "production",
        NODE_ENV: "production",
        [FINANCIAL_STATE_V1_2_FLAG]: "true",
      }),
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
    ambiguousRuntimeFailsClosed:
      !isFinancialStateDemoAllowed({}) &&
      !isFinancialStateDemoAllowed({ NODE_ENV: "test" }) &&
      !isFinancialStateDemoAllowed({ VERCEL_ENV: "unknown" }),
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
    readFailuresAreSanitized:
      classifyFinancialStateReadFailure(
        new Error("financial_state_context_read_failed:42P01"),
      ) === "source_read_failed" &&
      classifyFinancialStateReadFailure(
        new Error("financial_state_owner_mismatch"),
      ) === "security_boundary_violation" &&
      classifyFinancialStateReadFailure(
        new Error("financial_state_invalid_context_row"),
      ) === "persisted_state_invalid" &&
      classifyFinancialStateReadFailure(new Error("some_provider_secret")) ===
        "unexpected" &&
      classifyFinancialStateReadFailure("raw text") === "unexpected",
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
  };
}
