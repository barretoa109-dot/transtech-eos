import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import {
  resolveTrustedSourceCoverage,
  type SourceFreshnessReasonCode,
  type TrustedFinancialSourceInventory,
} from "./source-coverage";
import type { FinancialConnectorSnapshot } from "./types";

export const TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION =
  "trusted-global-source-closure-v1" as const;
export const GLOBAL_SOURCE_CLOSURE_MIN_CONFIDENCE = 0.9;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const GLOBAL_AUTHORITIES = new Set(["user_confirmed", "verified_document"]);

export type TrustedGlobalSourceClosureAuthority =
  | "user_confirmed"
  | "verified_document";

export interface TrustedGlobalSourceClosure {
  version: typeof TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION;
  userId: string;
  asOf: string;
  validUntil: string;
  authority: TrustedGlobalSourceClosureAuthority;
  confidence: number;
  /** Explicit closure: the bound inventories exhaust the user's known material sources. */
  confirmsNoOtherMaterialSources: boolean;
  /** Exact SHA-256 fingerprints of the scoped/global inventories covered by this closure. */
  coveredInventoryFingerprints: string[];
}

export interface TrustedScopedSourceBundle {
  snapshot: FinancialConnectorSnapshot;
  inventory: TrustedFinancialSourceInventory;
}

export type GlobalSourceCoverageReasonCode =
  | "global_coverage_requires_evidence"
  | "global_closure_invalid"
  | "global_closure_authority_insufficient"
  | "global_closure_confidence_below_threshold"
  | "global_closure_not_current"
  | "global_closure_not_exhaustive"
  | "global_closure_binding_mismatch"
  | "duplicate_inventory_fingerprint"
  | "overlapping_source_identity"
  | "scoped_inventory_invalid";

export interface TrustedGlobalSourceCoverageResolution {
  version: "trusted-global-source-coverage-resolution-v1";
  criticalSourcesComplete: boolean;
  criticalSourcesFresh: boolean;
  expectedMaterialCount: number;
  connectedMaterialCount: number;
  missingMaterialCount: number;
  staleConnectedSourceCount: number;
  connectedSourceCount: number;
  reasonCodes: GlobalSourceCoverageReasonCode[];
  freshnessReasonCodes: SourceFreshnessReasonCode[];
  /** Global compact evidence identity. Does not expose provider/account material. */
  inventoryFingerprint: string | null;
  /** Independent closure identity binding authority + exact leaf inventory set. */
  closureFingerprint: string | null;
  leafInventoryFingerprints: string[];
  /** Global evidence can never outlive its shortest trusted evidence window. */
  coverageValidUntil: string | null;
}

function parseTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function finiteConfidence(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function canonicalIso(value: number) {
  return new Date(value).toISOString();
}

function exactStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function failure(input: {
  reasons: GlobalSourceCoverageReasonCode[];
  criticalSourcesFresh?: boolean;
  freshnessReasonCodes?: SourceFreshnessReasonCode[];
  expectedMaterialCount?: number;
  connectedMaterialCount?: number;
  missingMaterialCount?: number;
  staleConnectedSourceCount?: number;
  connectedSourceCount?: number;
  closureFingerprint?: string | null;
  leafInventoryFingerprints?: string[];
  coverageValidUntil?: string | null;
}): TrustedGlobalSourceCoverageResolution {
  return {
    version: "trusted-global-source-coverage-resolution-v1",
    criticalSourcesComplete: false,
    criticalSourcesFresh: input.criticalSourcesFresh ?? false,
    expectedMaterialCount: input.expectedMaterialCount ?? 0,
    connectedMaterialCount: input.connectedMaterialCount ?? 0,
    missingMaterialCount: input.missingMaterialCount ?? 0,
    staleConnectedSourceCount: input.staleConnectedSourceCount ?? 0,
    connectedSourceCount: input.connectedSourceCount ?? 0,
    reasonCodes: [...new Set(input.reasons)].sort(),
    freshnessReasonCodes: [
      ...new Set(input.freshnessReasonCodes ?? []),
    ].sort(),
    inventoryFingerprint: null,
    closureFingerprint: input.closureFingerprint ?? null,
    leafInventoryFingerprints: [...(input.leafInventoryFingerprints ?? [])].sort(),
    coverageValidUntil: input.coverageValidUntil ?? null,
  };
}

/**
 * Aggregates independently scoped provider/institution evidence into one global
 * coverage decision only when an independent trusted closure binds the exact
 * leaf inventory fingerprint set.
 *
 * This layer intentionally does not merge provider snapshots or persist rows.
 * It produces a compact global coverage commitment for later Zero Entry / v1.3
 * orchestration without pretending that one connector knows the user's entire
 * financial life.
 */
export function aggregateTrustedGlobalSourceCoverage(input: {
  trustedUserId: string;
  bundles: TrustedScopedSourceBundle[];
  closure: TrustedGlobalSourceClosure;
  nowIso: string;
}): TrustedGlobalSourceCoverageResolution {
  if (!input.trustedUserId) {
    throw new Error("financial_global_source_coverage_missing_trusted_user");
  }
  if (input.closure.userId !== input.trustedUserId) {
    throw new Error("financial_global_source_coverage_closure_owner_mismatch");
  }
  for (const bundle of input.bundles) {
    if (bundle.inventory.userId !== input.trustedUserId) {
      throw new Error("financial_global_source_coverage_inventory_owner_mismatch");
    }
    if (
      bundle.snapshot.accounts.some(
        (account) => account.userId !== input.trustedUserId,
      ) ||
      bundle.snapshot.ledgerEntries.some(
        (entry) => entry.userId !== input.trustedUserId,
      )
    ) {
      throw new Error("financial_global_source_coverage_snapshot_owner_mismatch");
    }
  }

  if (input.bundles.length === 0) {
    return failure({ reasons: ["global_coverage_requires_evidence"] });
  }

  const now = parseTime(input.nowIso);
  const closureAsOf = parseTime(input.closure.asOf);
  const closureValidUntil = parseTime(input.closure.validUntil);
  const closureFingerprints = Array.isArray(
    input.closure.coveredInventoryFingerprints,
  )
    ? [...input.closure.coveredInventoryFingerprints].sort()
    : [];
  const closureShapeValid =
    input.closure.version === TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION &&
    now !== null &&
    closureAsOf !== null &&
    closureValidUntil !== null &&
    finiteConfidence(input.closure.confidence) &&
    typeof input.closure.confirmsNoOtherMaterialSources === "boolean" &&
    Array.isArray(input.closure.coveredInventoryFingerprints) &&
    closureFingerprints.every((fingerprint) => SHA256_HEX.test(fingerprint)) &&
    new Set(closureFingerprints).size === closureFingerprints.length;

  if (
    !closureShapeValid ||
    now === null ||
    closureAsOf === null ||
    closureValidUntil === null
  ) {
    return failure({ reasons: ["global_closure_invalid"] });
  }

  const closureFingerprint = sha256FinancialFingerprint({
    contract: TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
    userId: input.trustedUserId,
    asOf: canonicalIso(closureAsOf),
    validUntil: canonicalIso(closureValidUntil),
    authority: input.closure.authority,
    confidence: input.closure.confidence,
    confirmsNoOtherMaterialSources: input.closure.confirmsNoOtherMaterialSources,
    coveredInventoryFingerprints: closureFingerprints,
  });

  const closureReasons: GlobalSourceCoverageReasonCode[] = [];
  if (!GLOBAL_AUTHORITIES.has(input.closure.authority)) {
    closureReasons.push("global_closure_authority_insufficient");
  }
  if (input.closure.confidence < GLOBAL_SOURCE_CLOSURE_MIN_CONFIDENCE) {
    closureReasons.push("global_closure_confidence_below_threshold");
  }
  if (
    closureAsOf > now + 5 * 60 * 1000 ||
    closureValidUntil <= now ||
    closureValidUntil <= closureAsOf
  ) {
    closureReasons.push("global_closure_not_current");
  }
  if (!input.closure.confirmsNoOtherMaterialSources) {
    closureReasons.push("global_closure_not_exhaustive");
  }

  const leafResolutions = input.bundles.map((bundle) => ({
    bundle,
    resolution: resolveTrustedSourceCoverage({
      trustedUserId: input.trustedUserId,
      snapshot: bundle.snapshot,
      inventory: bundle.inventory,
      nowIso: input.nowIso,
    }),
  }));

  const expectedMaterialCount = leafResolutions.reduce(
    (sum, leaf) => sum + leaf.resolution.expectedMaterialCount,
    0,
  );
  const connectedMaterialCount = leafResolutions.reduce(
    (sum, leaf) => sum + leaf.resolution.connectedMaterialCount,
    0,
  );
  const missingMaterialCount = leafResolutions.reduce(
    (sum, leaf) => sum + leaf.resolution.missingMaterialCount,
    0,
  );
  const staleConnectedSourceCount = leafResolutions.reduce(
    (sum, leaf) => sum + leaf.resolution.staleConnectedSourceCount,
    0,
  );
  const connectedSourceCount = leafResolutions.reduce(
    (sum, leaf) => sum + leaf.resolution.connectedSourceCount,
    0,
  );
  const criticalSourcesFresh = leafResolutions.every(
    (leaf) => leaf.resolution.criticalSourcesFresh,
  );
  const freshnessReasonCodes = leafResolutions.flatMap(
    (leaf) => leaf.resolution.freshnessReasonCodes,
  );

  const leafInventoryFingerprints = leafResolutions
    .map((leaf) => leaf.resolution.inventoryFingerprint)
    .filter((value): value is string => value !== null)
    .sort();

  const allLeafFingerprintsPresent =
    leafInventoryFingerprints.length === leafResolutions.length;
  const duplicateInventoryFingerprint =
    new Set(leafInventoryFingerprints).size !== leafInventoryFingerprints.length;

  const leafSourceRefs = input.bundles.flatMap((bundle) =>
    bundle.inventory.expectedSources.map((source) => source.sourceRef),
  );
  const overlappingSourceIdentity =
    new Set(leafSourceRefs).size !== leafSourceRefs.length;

  const locallyValid = leafResolutions.every(({ bundle, resolution }) => {
    if (!resolution.inventoryFingerprint || !resolution.coverageValidUntil) {
      return false;
    }

    if (bundle.inventory.scope === "global_user_finances") {
      return (
        resolution.criticalSourcesComplete && resolution.reasonCodes.length === 0
      );
    }

    return (
      resolution.reasonCodes.length === 1 &&
      resolution.reasonCodes[0] === "inventory_scope_insufficient"
    );
  });

  const leafValidUntilTimes = leafResolutions.map((leaf) =>
    leaf.resolution.coverageValidUntil
      ? parseTime(leaf.resolution.coverageValidUntil)
      : null,
  );
  const allLeafValidityPresent = leafValidUntilTimes.every(
    (value): value is number => value !== null,
  );
  const coverageValidUntil = allLeafValidityPresent
    ? canonicalIso(
        Math.min(
          closureValidUntil,
          ...(leafValidUntilTimes as number[]),
        ),
      )
    : null;

  const reasons = [...closureReasons];
  if (!allLeafFingerprintsPresent || !locallyValid || !allLeafValidityPresent) {
    reasons.push("scoped_inventory_invalid");
  }
  if (duplicateInventoryFingerprint) {
    reasons.push("duplicate_inventory_fingerprint");
  }
  if (overlappingSourceIdentity) {
    reasons.push("overlapping_source_identity");
  }
  if (
    allLeafFingerprintsPresent &&
    !exactStringSet(closureFingerprints, leafInventoryFingerprints)
  ) {
    reasons.push("global_closure_binding_mismatch");
  }

  if (reasons.length > 0 || coverageValidUntil === null) {
    return failure({
      reasons,
      criticalSourcesFresh,
      freshnessReasonCodes,
      expectedMaterialCount,
      connectedMaterialCount,
      missingMaterialCount,
      staleConnectedSourceCount,
      connectedSourceCount,
      closureFingerprint,
      leafInventoryFingerprints,
      coverageValidUntil,
    });
  }

  const inventoryFingerprint = sha256FinancialFingerprint({
    contract: "trusted-global-source-coverage-resolution-v1",
    userId: input.trustedUserId,
    closureFingerprint,
    leafInventoryFingerprints,
    coverageValidUntil,
  });

  return {
    version: "trusted-global-source-coverage-resolution-v1",
    criticalSourcesComplete: true,
    criticalSourcesFresh,
    expectedMaterialCount,
    connectedMaterialCount,
    missingMaterialCount,
    staleConnectedSourceCount,
    connectedSourceCount,
    reasonCodes: [],
    freshnessReasonCodes: [...new Set(freshnessReasonCodes)].sort(),
    inventoryFingerprint,
    closureFingerprint,
    leafInventoryFingerprints,
    coverageValidUntil,
  };
}
