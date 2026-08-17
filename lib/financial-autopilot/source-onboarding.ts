import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import type { TrustedSourceCoverageResolution } from "./source-coverage";

export const FINANCIAL_READ_CONSENT_VERSION = "financial-read-consent-v1" as const;

export type FinancialReadScope =
  | "ACCOUNTS_READ"
  | "BALANCES_READ"
  | "TRANSACTIONS_READ"
  | "LIABILITIES_READ";

export interface FinancialReadConsentV1 {
  version: typeof FINANCIAL_READ_CONSENT_VERSION;
  userId: string;
  providerKey: string;
  grantedAt: string;
  validUntil: string;
  revokedAt: string | null;
  readScopes: FinancialReadScope[];
  movementAuthority: false;
  fingerprint: string;
}

export type FinancialSourceOnboardingState =
  | "CONSENT_REQUIRED"
  | "DISCOVERING"
  | "SOURCE_REQUIRED"
  | "REFRESH_REQUIRED"
  | "COVERAGE_READY";

export interface FinancialSourceOnboardingModel {
  version: "financial-source-onboarding-v1";
  state: FinancialSourceOnboardingState;
  progressPercent: number;
  headline: string;
  detail: string;
  userAction: "AUTHORIZE_READ" | "CONNECT_SOURCE" | "REFRESH_SOURCE" | "NOTHING";
  actionLabel: string | null;
  interrupt: boolean;
  mayBuildBaseline: boolean;
  mayAssertSafety: boolean;
}

const REQUIRED_READ_SCOPES: FinancialReadScope[] = [
  "ACCOUNTS_READ",
  "BALANCES_READ",
  "LIABILITIES_READ",
  "TRANSACTIONS_READ",
];

function validDate(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function normalize(value: string, code: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function consentMaterial(input: Omit<FinancialReadConsentV1, "fingerprint">) {
  return {
    version: input.version,
    userId: input.userId,
    providerKey: input.providerKey,
    grantedAt: input.grantedAt,
    validUntil: input.validUntil,
    revokedAt: input.revokedAt,
    readScopes: [...input.readScopes].sort(),
    movementAuthority: input.movementAuthority,
  };
}

export function buildFinancialReadConsentV1(input: {
  trustedUserId: string;
  providerKey: string;
  grantedAt: string;
  validUntil: string;
  readScopes: FinancialReadScope[];
}): FinancialReadConsentV1 {
  const userId = normalize(input.trustedUserId, "financial_consent_missing_user");
  const providerKey = normalize(input.providerKey, "financial_consent_missing_provider");
  const grantedAt = validDate(input.grantedAt);
  const validUntil = validDate(input.validUntil);
  if (grantedAt === null || validUntil === null || validUntil <= grantedAt) {
    throw new Error("financial_consent_invalid_window");
  }
  const readScopes = [...new Set(input.readScopes)].sort();
  if (!REQUIRED_READ_SCOPES.every((scope) => readScopes.includes(scope))) {
    throw new Error("financial_consent_missing_read_scope");
  }
  const material = consentMaterial({
    version: FINANCIAL_READ_CONSENT_VERSION,
    userId,
    providerKey,
    grantedAt: new Date(grantedAt).toISOString(),
    validUntil: new Date(validUntil).toISOString(),
    revokedAt: null,
    readScopes,
    movementAuthority: false,
  });
  return { ...material, fingerprint: sha256FinancialFingerprint(material) };
}

export function isFinancialReadConsentCurrent(input: {
  trustedUserId: string;
  consent: FinancialReadConsentV1 | null;
  nowIso: string;
}) {
  const now = validDate(input.nowIso);
  if (now === null || !input.consent) return false;
  const consent = input.consent;
  if (consent.userId !== input.trustedUserId || consent.movementAuthority !== false) return false;
  if (consent.revokedAt !== null) return false;
  const grantedAt = validDate(consent.grantedAt);
  const validUntil = validDate(consent.validUntil);
  if (grantedAt === null || validUntil === null || grantedAt > now || validUntil <= now) return false;
  if (!REQUIRED_READ_SCOPES.every((scope) => consent.readScopes.includes(scope))) return false;
  return sha256FinancialFingerprint(consentMaterial(consent)) === consent.fingerprint;
}

function model(value: Omit<FinancialSourceOnboardingModel, "version" | "mayAssertSafety">) {
  return {
    version: "financial-source-onboarding-v1" as const,
    ...value,
    // Onboarding can establish evidence; only Financial State may assert SAFE.
    mayAssertSafety: false as const,
  };
}

export function buildFinancialSourceOnboarding(input: {
  trustedUserId: string;
  nowIso: string;
  consent: FinancialReadConsentV1 | null;
  coverage: TrustedSourceCoverageResolution | null;
  missingSourceLabel?: string | null;
}): FinancialSourceOnboardingModel {
  if (!isFinancialReadConsentCurrent(input)) {
    return model({
      state: "CONSENT_REQUIRED",
      progressPercent: 0,
      headline: "Autoriza la lectura de tu información financiera.",
      detail: "EOS solo solicita acceso de lectura. Este piloto no puede mover dinero.",
      userAction: "AUTHORIZE_READ",
      actionLabel: "Autorizar lectura",
      interrupt: true,
      mayBuildBaseline: false,
    });
  }

  if (!input.coverage) {
    return model({
      state: "DISCOVERING",
      progressPercent: 25,
      headline: "EOS está buscando tus fuentes financieras.",
      detail: "Estoy identificando cuentas, tarjetas y obligaciones. No necesitas cargarlas manualmente.",
      userAction: "NOTHING",
      actionLabel: null,
      interrupt: false,
      mayBuildBaseline: false,
    });
  }

  if (!input.coverage.criticalSourcesComplete) {
    const label = input.missingSourceLabel?.trim() || "una fuente importante";
    return model({
      state: "SOURCE_REQUIRED",
      progressPercent: Math.min(75, Math.max(25, 25 + input.coverage.connectedMaterialCount * 10)),
      headline: `Necesito conectar ${label}.`,
      detail: "Es necesaria para calcular tu Disponible Real con seguridad.",
      userAction: "CONNECT_SOURCE",
      actionLabel: "Conectar fuente",
      interrupt: true,
      mayBuildBaseline: false,
    });
  }

  if (!input.coverage.criticalSourcesFresh) {
    return model({
      state: "REFRESH_REQUIRED",
      progressPercent: 90,
      headline: "Necesito actualizar una conexión financiera.",
      detail: "La cobertura está identificada, pero sus datos ya no son suficientemente recientes.",
      userAction: "REFRESH_SOURCE",
      actionLabel: "Actualizar conexión",
      interrupt: true,
      mayBuildBaseline: false,
    });
  }

  return model({
    state: "COVERAGE_READY",
    progressPercent: 100,
    headline: "Fuentes financieras listas.",
    detail: "EOS puede comenzar a organizar la información. No necesitas clasificar nada.",
    userAction: "NOTHING",
    actionLabel: null,
    interrupt: false,
    mayBuildBaseline: true,
  });
}
