import { createHash } from "node:crypto";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function stableFinancialFingerprintMaterial(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export function sha256FinancialFingerprint(value: unknown) {
  return createHash("sha256")
    .update(stableFinancialFingerprintMaterial(value), "utf8")
    .digest("hex");
}
