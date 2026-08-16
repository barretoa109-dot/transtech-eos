import type {
  FinancialStateCommitmentView,
  FinancialStateDataFreshness,
  FinancialStateRiskView,
  FinancialStateView,
} from "./financial-state";
import type { FinancialStatus } from "./types";

export type FinancialSurfaceKind = "STATE" | "NO_DATA" | "ERROR";
export type FinancialSurfaceStatus = FinancialStatus | "NO_DATA" | "ERROR";

export type FinancialSurfaceInput =
  | { kind: "STATE"; state: FinancialStateView }
  | { kind: "NO_DATA" }
  | { kind: "ERROR" };

export interface FinancialSurfaceModel {
  version: "financial-surface-v1";
  kind: FinancialSurfaceKind;
  status: FinancialSurfaceStatus;
  statusLabel: string;
  headline: string;
  detail: string;
  currency: string | null;
  asOf: string | null;
  validUntil: string | null;
  availableReal: {
    visible: boolean;
    amountMinor: number | null;
    label: string;
    supportingText: string;
  };
  nextProtectedCommitment: FinancialStateCommitmentView | null;
  firstForecastRisk: FinancialStateRiskView | null;
  freshness: {
    status: FinancialStateDataFreshness;
    label: string;
    detail: string;
    freshUntil: string | null;
  };
  attention: {
    required: boolean;
    interrupt: boolean;
    message: string;
  };
  why: {
    protectedCommitmentsMinor: number;
    protectedReserveMinor: number;
    explanationAvailable: boolean;
    explanationRefCount: number;
  } | null;
}

function publicMinor(value: number | null | undefined) {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function publicCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function statusLabel(status: FinancialStatus) {
  if (status === "DEGRADED") return "Datos desactualizados";
  if (status === "ACTION_REQUIRED") return "Decisión necesaria";
  if (status === "ATTENTION") return "En vigilancia";
  return "Seguro";
}

function freshnessCopy(state: FinancialStateView) {
  if (
    state.freshness.status === "FRESH" &&
    state.freshness.sourcesFresh &&
    state.freshness.freshUntil
  ) {
    return {
      status: "FRESH" as const,
      label: "Datos al día",
      detail: "EOS cuenta con una ventana de datos vigente para este estado.",
      freshUntil: state.freshness.freshUntil,
    };
  }

  if (state.freshness.status === "STALE" || !state.freshness.sourcesFresh) {
    return {
      status: "STALE" as const,
      label: "Datos que necesitan actualización",
      detail: "EOS no afirmará seguridad financiera hasta recuperar información vigente.",
      freshUntil: state.freshness.freshUntil,
    };
  }

  return {
    status: "UNKNOWN" as const,
    label: "Vigencia por confirmar",
    detail: "EOS no tiene una ventana de frescura suficiente para afirmar seguridad.",
    freshUntil: state.freshness.freshUntil,
  };
}

function emptySurface(kind: "NO_DATA" | "ERROR"): FinancialSurfaceModel {
  const noData = kind === "NO_DATA";
  return {
    version: "financial-surface-v1",
    kind,
    status: kind,
    statusLabel: noData ? "Pendiente de contexto" : "Lectura no disponible",
    headline: noData
      ? "Aún no tengo suficiente contexto financiero."
      : "No puedo validar tu estado financiero ahora.",
    detail: noData
      ? "Por seguridad, EOS no calcula ni muestra un Disponible Real hasta tener una primera lectura financiera validada."
      : "Voy a ocultar cualquier monto hasta recuperar una lectura confiable. Así evitamos mostrar un falso estado Seguro.",
    currency: null,
    asOf: null,
    validUntil: null,
    availableReal: {
      visible: false,
      amountMinor: null,
      label: "Oculto hasta validar",
      supportingText: noData
        ? "En cuanto exista un contexto financiero confiable, esta pantalla se completará automáticamente."
        : "Tus últimos montos no se reutilizan como si siguieran siendo seguros cuando la lectura actual falla.",
    },
    nextProtectedCommitment: null,
    firstForecastRisk: null,
    freshness: {
      status: "UNKNOWN",
      label: noData ? "Sin primera lectura validada" : "Lectura actual no disponible",
      detail: "EOS prefiere no afirmar seguridad antes que reutilizar un estado que no puede validar.",
      freshUntil: null,
    },
    attention: {
      required: true,
      interrupt: true,
      message: noData
        ? "Necesito una primera lectura financiera validada."
        : "Necesito recuperar una lectura financiera confiable.",
    },
    why: null,
  };
}

/**
 * Final, deterministic presentation contract shared by Web/App surfaces.
 *
 * It receives only the already-sanitized Financial State contract. It never
 * carries context revisions, Ledger rows, explanation refs, source event IDs or
 * provider metadata. Money visibility is recalculated fail-closed so an
 * inconsistent/stale upstream state cannot accidentally render a false SAFE.
 */
export function buildFinancialSurfaceModel(
  input: FinancialSurfaceInput,
): FinancialSurfaceModel {
  if (input.kind === "NO_DATA" || input.kind === "ERROR") {
    return emptySurface(input.kind);
  }

  const state = input.state;
  const freshness = freshnessCopy(state);
  const availableMinor = publicMinor(state.money.availableRealMinor);
  const protectedCommitmentsMinor =
    publicMinor(state.money.protectedCommitmentsMinor) ?? 0;
  const protectedReserveMinor = publicMinor(state.money.protectedReserveMinor) ?? 0;
  const visible =
    state.status !== "DEGRADED" &&
    state.canAssertSafety &&
    freshness.status === "FRESH" &&
    availableMinor !== null;

  const needsAttention = state.attention.required || state.status === "ACTION_REQUIRED";
  const supportingText = visible
    ? needsAttention
      ? state.attention.message
      : "No necesitas hacer nada."
    : "EOS no mostrará un monto seguro mientras los datos no sean suficientemente confiables.";

  return {
    version: "financial-surface-v1",
    kind: "STATE",
    status: state.status,
    statusLabel: statusLabel(state.status),
    headline: state.headline,
    detail: state.detail,
    currency: state.currency,
    asOf: state.asOf,
    validUntil: visible ? state.validUntil : null,
    availableReal: {
      visible,
      amountMinor: visible ? availableMinor : null,
      label: visible ? "Puedes usar hasta" : "Pendiente de actualización",
      supportingText,
    },
    nextProtectedCommitment: state.nextProtectedCommitment,
    firstForecastRisk: state.firstForecastRisk,
    freshness,
    attention: {
      required: needsAttention,
      interrupt: state.attention.interrupt || state.status === "DEGRADED",
      message: state.attention.message,
    },
    why: {
      protectedCommitmentsMinor,
      protectedReserveMinor,
      explanationAvailable: Boolean(state.trace.explanationAvailable),
      explanationRefCount: publicCount(state.trace.explanationRefCount),
    },
  };
}
