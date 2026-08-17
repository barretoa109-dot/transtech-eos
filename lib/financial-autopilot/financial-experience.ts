import type { FinancialConstitutionV1 } from "./financial-constitution";
import { isFinancialConstitutionConfirmed } from "./financial-constitution";
import type { FinancialSurfaceModel } from "./financial-surface";

export type FinancialExperiencePhase =
  | "CONNECTING"
  | "BUILDING_BASELINE"
  | "CONSTITUTION_REQUIRED"
  | "READY"
  | "PAUSED";

export type FinancialInterventionLevel = "I0" | "I1" | "I2" | "I3" | "I4";

export type FinancialUserNeed =
  | "NOTHING"
  | "AUTHORIZE_SOURCE"
  | "CONNECT_SOURCE"
  | "CONFIRM_CONSTITUTION"
  | "MAKE_DECISION"
  | "REFRESH_CONNECTION"
  | "SECURITY_REVIEW";

export interface FinancialExperienceModel {
  version: "financial-experience-v1";
  phase: FinancialExperiencePhase;
  interventionLevel: FinancialInterventionLevel;
  userNeed: FinancialUserNeed;
  headline: string;
  detail: string;
  interrupt: boolean;
  canShowFinancialSafety: boolean;
}

export interface FinancialExperienceInput {
  consentGranted: boolean;
  criticalSourcesComplete: boolean;
  baselineComplete: boolean;
  constitution: FinancialConstitutionV1 | null;
  surface: FinancialSurfaceModel;
  pausedReason?: "SECURITY" | "CONSENT" | "PROVIDER_INTEGRITY" | null;
  missingSourceLabel?: string | null;
}

function experience(
  value: Omit<FinancialExperienceModel, "version">,
): FinancialExperienceModel {
  return { version: "financial-experience-v1", ...value };
}

/**
 * Resolves onboarding progress independently from financial safety. A READY
 * experience can still carry a DEGRADED financial surface, while a persisted
 * or complete baseline can never self-promote to SAFE.
 */
export function buildFinancialExperienceModel(
  input: FinancialExperienceInput,
): FinancialExperienceModel {
  if (input.pausedReason) {
    return experience({
      phase: "PAUSED",
      interventionLevel: "I4",
      userNeed: "SECURITY_REVIEW",
      headline: "La autonomía financiera está pausada.",
      detail: "EOS detuvo cualquier acción afectada y necesita revisar la seguridad o integridad de la conexión.",
      interrupt: true,
      canShowFinancialSafety: false,
    });
  }

  if (!input.consentGranted) {
    return experience({
      phase: "CONNECTING",
      interventionLevel: "I4",
      userNeed: "AUTHORIZE_SOURCE",
      headline: "Conecta tu primera fuente financiera.",
      detail: "EOS necesita permiso de lectura para comenzar. El piloto no puede mover dinero.",
      interrupt: true,
      canShowFinancialSafety: false,
    });
  }

  if (!input.criticalSourcesComplete) {
    const source = input.missingSourceLabel?.trim();
    return experience({
      phase: "CONNECTING",
      interventionLevel: "I4",
      userNeed: "CONNECT_SOURCE",
      headline: source ? `Necesito conectar ${source}.` : "Falta una fuente financiera importante.",
      detail: "No voy a confirmar tu Disponible Real hasta conocer la cobertura financiera necesaria.",
      interrupt: true,
      canShowFinancialSafety: false,
    });
  }

  if (!input.baselineComplete || input.surface.kind === "NO_DATA") {
    return experience({
      phase: "BUILDING_BASELINE",
      interventionLevel: "I0",
      userNeed: "NOTHING",
      headline: "EOS está organizando tus finanzas.",
      detail: "Estoy conciliando movimientos y detectando compromisos. No necesitas clasificar nada.",
      interrupt: false,
      canShowFinancialSafety: false,
    });
  }

  if (!isFinancialConstitutionConfirmed(input.constitution)) {
    return experience({
      phase: "CONSTITUTION_REQUIRED",
      interventionLevel: "I3",
      userNeed: "CONFIRM_CONSTITUTION",
      headline: "Confirma qué significa seguridad para ti.",
      detail: "EOS preparó cinco reglas para que las confirmes una sola vez antes de administrar recomendaciones dentro de esos límites.",
      interrupt: true,
      canShowFinancialSafety: false,
    });
  }

  if (input.surface.kind === "ERROR" || input.surface.status === "DEGRADED") {
    return experience({
      phase: "READY",
      interventionLevel: "I4",
      userNeed: "REFRESH_CONNECTION",
      headline: input.surface.headline,
      detail: input.surface.attention.message,
      interrupt: true,
      canShowFinancialSafety: false,
    });
  }

  if (input.surface.attention.level === "I3") {
    return experience({
      phase: "READY",
      interventionLevel: "I3",
      userNeed: "MAKE_DECISION",
      headline: input.surface.headline,
      detail: input.surface.attention.message,
      interrupt: true,
      canShowFinancialSafety: input.surface.availableReal.visible,
    });
  }

  return experience({
    phase: "READY",
    interventionLevel: input.surface.attention.level,
    userNeed: "NOTHING",
    headline: input.surface.headline,
    detail:
      input.surface.attention.level === "I2"
        ? "EOS ajustó una variable blanda dentro de tu política. No necesitas hacer nada."
        : input.surface.detail,
    interrupt: false,
    canShowFinancialSafety: input.surface.availableReal.visible,
  });
}
