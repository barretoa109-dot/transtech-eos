import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import type { FinancialAccount, FinancialConnectorSnapshot } from "./types";

export const TRUSTED_SOURCE_INVENTORY_VERSION =
  "trusted-financial-source-inventory-v1" as const;
export const SOURCE_COVERAGE_INVENTORY_MIN_CONFIDENCE = 0.9;
export const SOURCE_COVERAGE_EXPECTED_SOURCE_MIN_CONFIDENCE = 0.8;

const SOURCE_REF = /^fin-source:[a-f0-9]{64}$/;
const TRUSTED_AUTHORITIES = new Set<TrustedFinancialSourceInventory["authority"]>([
  "user_confirmed",
  "provider_discovery",
  "verified_document",
]);
const GLOBAL_COVERAGE_SCOPE: TrustedFinancialSourceInventoryScope =
  "global_user_finances";

export type FinancialSourceMateriality = "critical" | "material" | "optional";
export type TrustedFinancialSourceInventoryAuthority =
  | "user_confirmed"
  | "provider_discovery"
  | "verified_document";
export type TrustedFinancialSourceInventoryScope =
  | "global_user_finances"
  | "institution"
  | "provider_connection";

export interface ExpectedFinancialSourceEvidence {
  /** Opaque SHA-256 identity. Never a display name, account number or provider payload. */
  sourceRef: string;
  materiality: FinancialSourceMateriality;
  confidence: number;
}

export interface TrustedFinancialSourceInventory {
  version: typeof TRUSTED_SOURCE_INVENTORY_VERSION;
  userId: string;
  asOf: string;
  validUntil: string;
  authority: TrustedFinancialSourceInventoryAuthority;
  /** Global coverage is required before this single-inventory resolver may claim SAFE. */
  scope: TrustedFinancialSourceInventoryScope;
  /** Whether the trusted discovery process itself completed for this inventory window/scope. */
  discoveryComplete: boolean;
  /** Confidence in the inventory/discovery result, not in current account freshness. */
  confidence: number;
  /** Material-source hints that could not yet be resolved to a canonical source identity. */
  unresolvedMaterialSourceCount: number;
  expectedSources: ExpectedFinancialSourceEvidence[];
}

export type SourceCoverageReasonCode =
  | "inventory_invalid"
  | "inventory_not_trusted"
  | "inventory_scope_insufficient"
  | "inventory_discovery_incomplete"
  | "inventory_confidence_below_threshold"
  | "inventory_not_current"
  | "unresolved_material_source"
  | "duplicate_expected_source_identity"
  | "duplicate_connected_source_identity"
  | "connected_source_not_in_inventory"
  | "material_source_evidence_below_threshold"
  | "material_source_missing";

export type SourceFreshnessReasonCode = "connected_source_stale_or_unknown";

export interface TrustedSourceCoverageResolution {
  criticalSourcesComplete: boolean;
  /** Freshness of authoritative sources EOS currently knows, including cards/loans. */
  criticalSourcesFresh: boolean;
  expectedMaterialCount: number;
  connectedMaterialCount: number;
  missingMaterialCount: number;
  staleConnectedSourceCount: number;
  connectedSourceCount: number;
  reasonCodes: SourceCoverageReasonCode[];
  freshnessReasonCodes: SourceFreshnessReasonCode[];
  /** Internal integrity aid only. Financial State/Surface must not expose it. */
  inventoryFingerprint: string | null;
  /** The context must never outlive the trusted coverage evidence that justified it. */
  coverageValidUntil: string | null;
}

function normalizeIdentityPart(value: string, code: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error(code);
  return normalized;
}

function finiteConfidence(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function validInventoryScope(
  value: unknown,
): value is TrustedFinancialSourceInventoryScope {
  return (
    value === "global_user_finances" ||
    value === "institution" ||
    value === "provider_connection"
  );
}

function isAuthoritativeOwnership(ownership: FinancialAccount["ownership"]) {
  return ownership === "own" || ownership === "joint";
}

function accountIsFresh(account: FinancialAccount, now: number) {
  const freshUntil = account.freshUntil
    ? new Date(account.freshUntil).getTime()
    : Number.NaN;
  return Number.isFinite(freshUntil) && freshUntil >= now;
}

export function financialSourceCoverageRef(input: {
  userId: string;
  providerKey: string;
  connectionId: string;
  externalAccountId: string;
}) {
  return `fin-source:${sha256FinancialFingerprint({
    contract: "financial-source-coverage-identity-v1",
    userId: normalizeIdentityPart(input.userId, "financial_source_missing_user"),
    providerKey: normalizeIdentityPart(
      input.providerKey,
      "financial_source_missing_provider",
    ),
    connectionId: normalizeIdentityPart(
      input.connectionId,
      "financial_source_missing_connection",
    ),
    externalAccountId: normalizeIdentityPart(
      input.externalAccountId,
      "financial_source_missing_external_account",
    ),
  })}`;
}

export function financialAccountSourceCoverageRef(input: {
  userId: string;
  providerKey: string;
  account: FinancialAccount;
}) {
  return financialSourceCoverageRef({
    userId: input.userId,
    providerKey: input.providerKey,
    connectionId: input.account.connectionId,
    externalAccountId: input.account.externalAccountId,
  });
}

function failCoverage(input: {
  criticalSourcesFresh: boolean;
  staleConnectedSourceCount: number;
  reasonCodes: SourceCoverageReasonCode[];
  freshnessReasonCodes: SourceFreshnessReasonCode[];
  expectedMaterialCount?: number;
  connectedMaterialCount?: number;
  missingMaterialCount?: number;
  connectedSourceCount?: number;
  inventoryFingerprint?: string | null;
  coverageValidUntil?: string | null;
}): TrustedSourceCoverageResolution {
  return {
    criticalSourcesComplete: false,
    criticalSourcesFresh: input.criticalSourcesFresh,
    expectedMaterialCount: input.expectedMaterialCount ?? 0,
    connectedMaterialCount: input.connectedMaterialCount ?? 0,
    missingMaterialCount: input.missingMaterialCount ?? 0,
    staleConnectedSourceCount: input.staleConnectedSourceCount,
    connectedSourceCount: input.connectedSourceCount ?? 0,
    reasonCodes: [...new Set(input.reasonCodes)].sort(),
    freshnessReasonCodes: [...new Set(input.freshnessReasonCodes)].sort(),
    inventoryFingerprint: input.inventoryFingerprint ?? null,
    coverageValidUntil: input.coverageValidUntil ?? null,
  };
}

/**
 * Resolves two deliberately independent questions:
 * 1) are the authoritative sources EOS currently knows fresh?;
 * 2) is a GLOBAL trusted material-source inventory complete enough for safety?
 *
 * Institution/provider-scoped discovery is useful evidence, but one scoped
 * connector must never be mistaken for proof of the user's entire finances.
 */
export function resolveTrustedSourceCoverage(input: {
  trustedUserId: string;
  snapshot: FinancialConnectorSnapshot;
  inventory: TrustedFinancialSourceInventory;
  nowIso: string;
}): TrustedSourceCoverageResolution {
  if (!input.trustedUserId) throw new Error("financial_source_coverage_missing_trusted_user");

  for (const account of input.snapshot.accounts) {
    if (account.userId !== input.trustedUserId) {
      throw new Error("financial_source_coverage_account_owner_mismatch");
    }
  }
  if (input.inventory.userId !== input.trustedUserId) {
    throw new Error("financial_source_coverage_inventory_owner_mismatch");
  }

  const now = parseTime(input.nowIso);
  if (now === null) {
    return failCoverage({
      criticalSourcesFresh: false,
      staleConnectedSourceCount: 0,
      reasonCodes: ["inventory_invalid"],
      freshnessReasonCodes: [],
    });
  }

  const authoritativeAccounts = input.snapshot.accounts.filter((account) =>
    isAuthoritativeOwnership(account.ownership),
  );
  const staleConnectedSourceCount = authoritativeAccounts.filter(
    (account) => !accountIsFresh(account, now),
  ).length;
  const criticalSourcesFresh = staleConnectedSourceCount === 0;
  const freshnessReasonCodes: SourceFreshnessReasonCode[] = criticalSourcesFresh
    ? []
    : ["connected_source_stale_or_unknown"];

  const asOf = parseTime(input.inventory.asOf);
  const validUntil = parseTime(input.inventory.validUntil);
  const baseShapeValid =
    input.inventory.version === TRUSTED_SOURCE_INVENTORY_VERSION &&
    asOf !== null &&
    validUntil !== null &&
    validInventoryScope(input.inventory.scope) &&
    typeof input.inventory.discoveryComplete === "boolean" &&
    finiteConfidence(input.inventory.confidence) &&
    Number.isSafeInteger(input.inventory.unresolvedMaterialSourceCount) &&
    input.inventory.unresolvedMaterialSourceCount >= 0 &&
    Array.isArray(input.inventory.expectedSources);

  if (!baseShapeValid || asOf === null || validUntil === null) {
    return failCoverage({
      criticalSourcesFresh,
      staleConnectedSourceCount,
      reasonCodes: ["inventory_invalid"],
      freshnessReasonCodes,
      connectedSourceCount: authoritativeAccounts.length,
    });
  }

  const coverageValidUntil = new Date(validUntil).toISOString();
  const structurallyValidExpected = input.inventory.expectedSources.every(
    (source) =>
      source !== null &&
      typeof source === "object" &&
      SOURCE_REF.test(source.sourceRef) &&
      (source.materiality === "critical" ||
        source.materiality === "material" ||
        source.materiality === "optional") &&
      finiteConfidence(source.confidence),
  );
  if (!structurallyValidExpected) {
    return failCoverage({
      criticalSourcesFresh,
      staleConnectedSourceCount,
      reasonCodes: ["inventory_invalid"],
      freshnessReasonCodes,
      connectedSourceCount: authoritativeAccounts.length,
      coverageValidUntil,
    });
  }

  const expectedSources = [...input.inventory.expectedSources].sort((a, b) =>
    a.sourceRef.localeCompare(b.sourceRef),
  );
  const inventoryFingerprint = sha256FinancialFingerprint({
    contract: "trusted-financial-source-inventory-v1",
    userId: input.trustedUserId,
    asOf: new Date(asOf).toISOString(),
    validUntil: coverageValidUntil,
    authority: input.inventory.authority,
    scope: input.inventory.scope,
    discoveryComplete: input.inventory.discoveryComplete,
    confidence: input.inventory.confidence,
    unresolvedMaterialSourceCount: input.inventory.unresolvedMaterialSourceCount,
    expectedSources,
  });

  const connectedRows: Array<{ sourceRef: string; account: FinancialAccount }> = [];
  try {
    for (const account of authoritativeAccounts) {
      connectedRows.push({
        sourceRef: financialAccountSourceCoverageRef({
          userId: input.trustedUserId,
          providerKey: input.snapshot.providerKey,
          account,
        }),
        account,
      });
    }
  } catch {
    return failCoverage({
      criticalSourcesFresh,
      staleConnectedSourceCount,
      reasonCodes: ["inventory_invalid"],
      freshnessReasonCodes,
      connectedSourceCount: authoritativeAccounts.length,
      inventoryFingerprint,
      coverageValidUntil,
    });
  }

  const connectedRefs = connectedRows.map((row) => row.sourceRef);
  const connectedSet = new Set(connectedRefs);
  const expectedSet = new Set(expectedSources.map((source) => source.sourceRef));
  const materialSources = expectedSources.filter(
    (source) => source.materiality === "critical" || source.materiality === "material",
  );
  const connectedMaterialCount = materialSources.filter((source) =>
    connectedSet.has(source.sourceRef),
  ).length;
  const missingMaterialCount = materialSources.length - connectedMaterialCount;

  const reasons: SourceCoverageReasonCode[] = [];
  if (!TRUSTED_AUTHORITIES.has(input.inventory.authority)) {
    reasons.push("inventory_not_trusted");
  }
  if (input.inventory.scope !== GLOBAL_COVERAGE_SCOPE) {
    reasons.push("inventory_scope_insufficient");
  }
  if (!input.inventory.discoveryComplete) {
    reasons.push("inventory_discovery_incomplete");
  }
  if (input.inventory.confidence < SOURCE_COVERAGE_INVENTORY_MIN_CONFIDENCE) {
    reasons.push("inventory_confidence_below_threshold");
  }
  if (
    asOf > now + 5 * 60 * 1000 ||
    validUntil <= now ||
    validUntil <= asOf
  ) {
    reasons.push("inventory_not_current");
  }
  if (input.inventory.unresolvedMaterialSourceCount > 0) {
    reasons.push("unresolved_material_source");
  }
  if (expectedSet.size !== expectedSources.length) {
    reasons.push("duplicate_expected_source_identity");
  }
  if (connectedSet.size !== connectedRefs.length) {
    reasons.push("duplicate_connected_source_identity");
  }
  if (connectedRefs.some((sourceRef) => !expectedSet.has(sourceRef))) {
    reasons.push("connected_source_not_in_inventory");
  }
  if (
    materialSources.some(
      (source) =>
        source.confidence < SOURCE_COVERAGE_EXPECTED_SOURCE_MIN_CONFIDENCE,
    )
  ) {
    reasons.push("material_source_evidence_below_threshold");
  }
  if (missingMaterialCount > 0) {
    reasons.push("material_source_missing");
  }

  if (reasons.length > 0) {
    return failCoverage({
      criticalSourcesFresh,
      staleConnectedSourceCount,
      reasonCodes: reasons,
      freshnessReasonCodes,
      expectedMaterialCount: materialSources.length,
      connectedMaterialCount,
      missingMaterialCount,
      connectedSourceCount: connectedSet.size,
      inventoryFingerprint,
      coverageValidUntil,
    });
  }

  return {
    criticalSourcesComplete: true,
    criticalSourcesFresh,
    expectedMaterialCount: materialSources.length,
    connectedMaterialCount,
    missingMaterialCount: 0,
    staleConnectedSourceCount,
    connectedSourceCount: connectedSet.size,
    reasonCodes: [],
    freshnessReasonCodes,
    inventoryFingerprint,
    coverageValidUntil,
  };
}
