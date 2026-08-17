import type { SupabaseClient } from "@supabase/supabase-js";
import {
  trustedFinancialSourceInventoryFingerprint,
  type ExpectedFinancialSourceEvidence,
  type TrustedFinancialSourceInventory,
  type TrustedSourceCoverageResolution,
} from "./source-coverage";
import {
  buildFinancialSourceOnboarding,
  financialReadConsentMaterial,
  type FinancialReadConsentV1,
  type FinancialReadScope,
  type FinancialSourceOnboardingModel,
} from "./source-onboarding";
import { sha256FinancialFingerprint } from "./persistence-fingerprint";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const SOURCE_REF = /^fin-source:[0-9a-f]{64}$/;
const READ_SCOPES = new Set<FinancialReadScope>(["ACCOUNTS_READ", "BALANCES_READ", "TRANSACTIONS_READ", "LIABILITIES_READ"]);
const COLUMNS = "usuario_id,version,consent,consent_fingerprint,inventory,inventory_fingerprint,created_at";

export interface PersistedSourceOnboardingState {
  userId: string;
  version: number;
  consent: FinancialReadConsentV1;
  inventory: TrustedFinancialSourceInventory;
  createdAt: string;
}

function iso(value: unknown, code: string) {
  if (typeof value !== "string") throw new Error(code);
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(code);
  return new Date(time).toISOString();
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function parseConsent(value: unknown, userId: string, fingerprint: string): FinancialReadConsentV1 {
  const row = object(value, "financial_source_onboarding_invalid_consent");
  if (!Array.isArray(row.readScopes) || !row.readScopes.every((scope) => typeof scope === "string" && READ_SCOPES.has(scope as FinancialReadScope))) {
    throw new Error("financial_source_onboarding_invalid_consent_scopes");
  }
  const consent: FinancialReadConsentV1 = {
    version: "financial-read-consent-v1",
    userId: String(row.userId ?? ""),
    providerKey: String(row.providerKey ?? ""),
    grantedAt: iso(row.grantedAt, "financial_source_onboarding_invalid_consent_window"),
    validUntil: iso(row.validUntil, "financial_source_onboarding_invalid_consent_window"),
    revokedAt: row.revokedAt === null ? null : iso(row.revokedAt, "financial_source_onboarding_invalid_consent_revocation"),
    readScopes: row.readScopes as FinancialReadScope[],
    movementAuthority: false,
    fingerprint,
  };
  if (row.version !== consent.version || consent.userId !== userId || !consent.providerKey.trim() || row.movementAuthority !== false) {
    throw new Error("financial_source_onboarding_consent_integrity_mismatch");
  }
  if (sha256FinancialFingerprint(financialReadConsentMaterial(consent)) !== fingerprint) {
    throw new Error("financial_source_onboarding_consent_fingerprint_mismatch");
  }
  return consent;
}

function parseInventory(value: unknown, userId: string, fingerprint: string): TrustedFinancialSourceInventory {
  const row = object(value, "financial_source_onboarding_invalid_inventory");
  if (!Array.isArray(row.expectedSources)) throw new Error("financial_source_onboarding_invalid_inventory_sources");
  const expectedSources: ExpectedFinancialSourceEvidence[] = row.expectedSources.map((value) => {
    const source = object(value, "financial_source_onboarding_invalid_inventory_source");
    const sourceRef = String(source.sourceRef ?? "");
    const materiality = source.materiality;
    const confidence = source.confidence;
    if (!SOURCE_REF.test(sourceRef) || (materiality !== "critical" && materiality !== "material" && materiality !== "optional") || typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error("financial_source_onboarding_invalid_inventory_source");
    }
    return { sourceRef, materiality, confidence };
  });
  const authority = row.authority;
  const scope = row.scope;
  if ((authority !== "user_confirmed" && authority !== "provider_discovery" && authority !== "verified_document") || (scope !== "global_user_finances" && scope !== "institution" && scope !== "provider_connection")) {
    throw new Error("financial_source_onboarding_invalid_inventory_scope");
  }
  if (typeof row.discoveryComplete !== "boolean" || typeof row.confidence !== "number" || !Number.isFinite(row.confidence) || !Number.isSafeInteger(row.unresolvedMaterialSourceCount)) {
    throw new Error("financial_source_onboarding_invalid_inventory_values");
  }
  const inventory: TrustedFinancialSourceInventory = {
    version: "trusted-financial-source-inventory-v1",
    userId: String(row.userId ?? ""),
    asOf: iso(row.asOf, "financial_source_onboarding_invalid_inventory_window"),
    validUntil: iso(row.validUntil, "financial_source_onboarding_invalid_inventory_window"),
    authority,
    scope,
    discoveryComplete: row.discoveryComplete,
    confidence: row.confidence,
    unresolvedMaterialSourceCount: row.unresolvedMaterialSourceCount as number,
    expectedSources,
  };
  if (row.contract !== inventory.version || inventory.userId !== userId || trustedFinancialSourceInventoryFingerprint(inventory) !== fingerprint) {
    throw new Error("financial_source_onboarding_inventory_integrity_mismatch");
  }
  return inventory;
}

export function parsePersistedSourceOnboardingState(value: unknown, trustedUserId: string): PersistedSourceOnboardingState {
  const row = object(value, "financial_source_onboarding_invalid_persisted_state");
  const userId = String(row.usuario_id ?? "");
  const version = row.version;
  const consentFingerprint = String(row.consent_fingerprint ?? "");
  const inventoryFingerprint = String(row.inventory_fingerprint ?? "");
  if (userId !== trustedUserId) throw new Error("financial_source_onboarding_owner_mismatch");
  if (!Number.isSafeInteger(version) || (version as number) <= 0 || !SHA.test(consentFingerprint) || !SHA.test(inventoryFingerprint)) {
    throw new Error("financial_source_onboarding_invalid_persisted_identity");
  }
  return {
    userId,
    version: version as number,
    consent: parseConsent(row.consent, userId, consentFingerprint),
    inventory: parseInventory(row.inventory, userId, inventoryFingerprint),
    createdAt: iso(row.created_at, "financial_source_onboarding_invalid_created_at"),
  };
}

export class SupabaseSourceOnboardingReader {
  constructor(private readonly client: Pick<SupabaseClient, "from">, private readonly trustedUserId: string) {
    if (!UUID.test(trustedUserId)) throw new Error("financial_source_onboarding_invalid_trusted_user");
  }

  async getCurrent(userId: string): Promise<PersistedSourceOnboardingState | null> {
    if (userId !== this.trustedUserId) throw new Error("financial_source_onboarding_user_mismatch");
    const { data, error } = await this.client.from("eos_financial_source_onboarding_commits_v1").select(COLUMNS).eq("usuario_id", this.trustedUserId).is("superseded_at", null).limit(1).maybeSingle();
    if (error) throw new Error(`financial_source_onboarding_read_failed:${error.code || "unknown"}`);
    return data ? parsePersistedSourceOnboardingState(data, this.trustedUserId) : null;
  }
}

/** Coverage must come from the trusted coverage resolver; persisted inventory alone can never self-promote to ready. */
export function resolveSourceOnboardingReadModel(input: {
  trustedUserId: string;
  nowIso: string;
  persisted: PersistedSourceOnboardingState | null;
  coverage: TrustedSourceCoverageResolution | null;
  missingSourceLabel?: string | null;
}): FinancialSourceOnboardingModel {
  if (input.persisted && input.persisted.userId !== input.trustedUserId) throw new Error("financial_source_onboarding_owner_mismatch");
  return buildFinancialSourceOnboarding({
    trustedUserId: input.trustedUserId,
    nowIso: input.nowIso,
    consent: input.persisted?.consent ?? null,
    coverage: input.coverage,
    missingSourceLabel: input.missingSourceLabel,
  });
}
