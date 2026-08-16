import type {
  FinancialStateCommitmentView,
  FinancialStateDataFreshness,
  FinancialStateRiskView,
  FinancialStateView,
} from "./financial-state";
import type { FinancialStatus } from "./types";

const PUBLIC_CURRENCY = /^[A-Z]{3}$/;

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

function publicPositiveInteger(value: number | null | undefined) {
  const parsed = publicMinor(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function publicCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function publicCurrency(value: string) {
  return PUBLIC_CURRENCY.test(value) ? value : null;
}

function publicIso(value: string | null | undefined) {
  if (!value || value.length > 64) return null;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}

function publicText(value: string, maxLength = 160) {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function statusLabel(status: FinancialStatus) {
  if (status === "DEGRADED") return "Datos desactualizados";
  if (status === "ACTION_REQUIRED") return "Decisión necesaria";
  if (status === "ATTENTION") return "En vigilancia";
  return "Seguro";
}

function freshnessCopy(state: FinancialStateView) {
  const freshUntil = publicIso(state.freshness.freshUntil);

  if (
    state.freshness.status === "FRESH" &&
    state.freshness.sourcesFresh &&
    freshUntil
  ) {
    return {
      status: "FRESH" as const,
      label: "Datos al día",
      detail: "EOS cuenta con una ventana de datos vigente para este estado.",
      freshUntil,
    };
  }

  if (state.freshness.status === "STALE" || !state.freshness.sourcesFresh) {
    return {
      status: "STALE" as const,
      label: "Datos que necesitan actualización",
      detail: "EOS no afirmará seguridad financiera hasta recuperar información vigente.",
      freshUntil,
    };
  }

  return {
    status: "UNKNOWN" as const,
    label: "Vigencia por confirmar",
    detail: "EOS no tiene una ventana de frescura suficiente para afirmar seguridad.",
    freshUntil,
  };
}

function publicCommitment(
  value: FinancialStateCommitmentView | null,
  expectedCurrency: string | null,
  projectionTrusted: boolean,
): FinancialStateCommitmentView | null {
  if (!value || !expectedCurrency || !projectionTrusted) return null;
  const type = publicText(value.type, 128);
  const amountMinor = publicMinor(value.amountMinor);
  const dueAt = publicIso(value.dueAt);
  if (
    !type ||
    amountMinor === null ||
    value.currency !== expectedCurrency ||
    !dueAt
  ) {
    return null;
  }
  return {
    type,
    amountMinor,
    currency: expectedCurrency,
    dueAt,
  };
}

function publicRisk(
  value: FinancialStateRiskView | null,
  projectionTrusted: boolean,
): FinancialStateRiskView | null {
  if (!value || !projectionTrusted) return null;
  if (value.status !== "ATTENTION" && value.status !== "ACTION_REQUIRED") {
    return null;
  }
  const horizonDays = publicPositiveInteger(value.horizonDays);
  const until = publicIso(value.until);
  const reserveGapMinor = publicMinor(value.reserveGapMinor);
  const negativeCashGapMinor = publicMinor(value.negativeCashGapMinor);
  if (
    horizonDays === null ||
    !until ||
    reserveGapMinor === null ||
    negativeCashGapMinor === null
  ) {
    return null;
  }
  return {
    status: value.status,
    horizonDays,
    until,
    reserveGapMinor,
    negativeCashGapMinor,
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
 * provider metadata. User-visible money/projection fields are recalculated
 * fail-closed so an inconsistent/stale upstream object cannot accidentally
 * render false safety or fabricated zeroes.
 */
export function buildFinancialSurfaceModel(
  input: FinancialSurfaceInput,
): FinancialSurfaceModel {
  if (input.kind === "NO_DATA" || input.kind === "ERROR") {
    return emptySurface(input.kind);
  }

  const state = input.state;
  const freshness = freshnessCopy(state);
  const currency = publicCurrency(state.currency);
  const asOf = publicIso(state.asOf);
  const availableMinor = publicMinor(state.money.availableRealMinor);
  const protectedCommitmentsMinor = publicMinor(
    state.money.protectedCommitmentsMinor,
  );
  const protectedReserveMinor = publicMinor(state.money.protectedReserveMinor);
  const safetyAggregatesTrusted =
    protectedCommitmentsMinor !== null && protectedReserveMinor !== null;
  const projectionTrusted =
    state.status !== "DEGRADED" &&
    freshness.status === "FRESH" &&
    Boolean(currency) &&
    safetyAggregatesTrusted;
  const visible =
    projectionTrusted &&
    state.canAssertSafety &&
    availableMinor !== null &&
    asOf !== null;

  const needsAttention = state.attention.required || state.status === "ACTION_REQUIRED";
  const supportingText = visible
    ? needsAttention
      ? state.attention.message
      : "No necesitas hacer nada."
    : "EOS no mostrará un monto seguro mientras los datos no sean suficientemente confiables.";
  const explanationRefCount = publicCount(state.trace.explanationRefCount);

  return {
    version: "financial-surface-v1",
    kind: "STATE",
    status: state.status,
    statusLabel: statusLabel(state.status),
    headline: state.headline,
    detail: state.detail,
    currency,
    asOf,
    validUntil: visible ? publicIso(state.validUntil) : null,
    availableReal: {
      visible,
      amountMinor: visible ? availableMinor : null,
      label: visible ? "Puedes usar hasta" : "Pendiente de actualización",
      supportingText,
    },
    nextProtectedCommitment: publicCommitment(
      state.nextProtectedCommitment,
      currency,
      projectionTrusted,
    ),
    firstForecastRisk: publicRisk(state.firstForecastRisk, projectionTrusted),
    freshness,
    attention: {
      required: needsAttention,
      interrupt: state.attention.interrupt || state.status === "DEGRADED",
      message: state.attention.message,
    },
    why: projectionTrusted
      ? {
          protectedCommitmentsMinor: protectedCommitmentsMinor!,
          protectedReserveMinor: protectedReserveMinor!,
          explanationAvailable:
            Boolean(state.trace.explanationAvailable) && explanationRefCount > 0,
          explanationRefCount,
        }
      : null,
  };
}
