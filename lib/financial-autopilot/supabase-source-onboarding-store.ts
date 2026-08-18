import type { TrustedFinancialSourceInventory } from "./source-coverage";
import {
  trustedFinancialSourceInventoryFingerprint,
  trustedFinancialSourceInventoryMaterial,
} from "./source-coverage";
import type { FinancialReadConsentV1 } from "./source-onboarding";
import {
  financialReadConsentMaterial,
  isFinancialReadConsentCurrent,
} from "./source-onboarding";
import { sha256FinancialFingerprint } from "./persistence-fingerprint";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;

export interface SourceOnboardingRpcClient {
  rpc(
    functionName: "eos_financial_persist_source_onboarding_v1",
    args: {
      p_usuario_id: string;
      p_consent: ReturnType<typeof financialReadConsentMaterial>;
      p_consent_fingerprint: string;
      p_inventory: ReturnType<typeof trustedFinancialSourceInventoryMaterial>;
      p_inventory_fingerprint: string;
      p_expected_current_version: number;
    },
  ): Promise<{ data: unknown; error: { code?: string | null } | null }>;
}

export interface SourceOnboardingPersistenceReceipt {
  commitId: string;
  version: number;
  consentFingerprint: string;
  inventoryFingerprint: string;
  replayed: boolean;
}

function parseReceipt(value: unknown): SourceOnboardingPersistenceReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("financial_source_onboarding_rpc_invalid_response");
  }
  const row = value as Record<string, unknown>;
  if (
    !UUID.test(String(row.commitId ?? "")) ||
    !Number.isSafeInteger(row.version) ||
    (row.version as number) <= 0 ||
    !SHA.test(String(row.consentFingerprint ?? "")) ||
    !SHA.test(String(row.inventoryFingerprint ?? "")) ||
    typeof row.replayed !== "boolean"
  ) {
    throw new Error("financial_source_onboarding_rpc_invalid_response");
  }
  return {
    commitId: String(row.commitId),
    version: row.version as number,
    consentFingerprint: String(row.consentFingerprint),
    inventoryFingerprint: String(row.inventoryFingerprint),
    replayed: row.replayed,
  };
}

/** Server-only adapter. Provider credentials never enter this contract. */
export class SupabaseSourceOnboardingStore {
  constructor(
    private readonly client: SourceOnboardingRpcClient,
    private readonly trustedUserId: string,
  ) {
    if (!UUID.test(trustedUserId)) {
      throw new Error("financial_source_onboarding_invalid_trusted_user");
    }
  }

  async persist(input: {
    consent: FinancialReadConsentV1;
    inventory: TrustedFinancialSourceInventory;
    expectedCurrentVersion: number;
    nowIso: string;
  }): Promise<SourceOnboardingPersistenceReceipt> {
    if (!Number.isSafeInteger(input.expectedCurrentVersion) || input.expectedCurrentVersion < 0) {
      throw new Error("financial_source_onboarding_invalid_expected_version");
    }
    if (!isFinancialReadConsentCurrent({ trustedUserId: this.trustedUserId, consent: input.consent, nowIso: input.nowIso })) {
      throw new Error("financial_source_onboarding_consent_not_current");
    }
    if (input.inventory.userId !== this.trustedUserId) {
      throw new Error("financial_source_onboarding_inventory_owner_mismatch");
    }
    if (input.consent.movementAuthority !== false) {
      throw new Error("financial_source_onboarding_movement_authority_forbidden");
    }

    const consent = financialReadConsentMaterial(input.consent);
    const consentFingerprint = sha256FinancialFingerprint(consent);
    if (consentFingerprint !== input.consent.fingerprint) {
      throw new Error("financial_source_onboarding_consent_fingerprint_mismatch");
    }
    const inventory = trustedFinancialSourceInventoryMaterial(input.inventory);
    const inventoryFingerprint = trustedFinancialSourceInventoryFingerprint(input.inventory);

    const { data, error } = await this.client.rpc(
      "eos_financial_persist_source_onboarding_v1",
      {
        p_usuario_id: this.trustedUserId,
        p_consent: consent,
        p_consent_fingerprint: consentFingerprint,
        p_inventory: inventory,
        p_inventory_fingerprint: inventoryFingerprint,
        p_expected_current_version: input.expectedCurrentVersion,
      },
    );
    if (error) {
      throw new Error(`financial_source_onboarding_rpc_failed:${error.code || "unknown"}`);
    }
    const receipt = parseReceipt(data);
    if (
      receipt.consentFingerprint !== consentFingerprint ||
      receipt.inventoryFingerprint !== inventoryFingerprint
    ) {
      throw new Error("financial_source_onboarding_rpc_fingerprint_mismatch");
    }
    if (!receipt.replayed && receipt.version !== input.expectedCurrentVersion + 1) {
      throw new Error("financial_source_onboarding_rpc_version_mismatch");
    }
    return receipt;
  }
}
