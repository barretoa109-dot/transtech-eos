import type { TransactionType } from "./types";

export interface TransactionClassification {
  type: TransactionType;
  confidence: number;
  reasonCode: string;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, tokens: string[]) {
  return tokens.some((token) => text.includes(token));
}

export function classifyImportedTransaction(input: {
  direction: "credit" | "debit";
  descriptionRaw: string;
}): TransactionClassification {
  const text = normalize(input.descriptionRaw);

  if (hasAny(text, ["devolucion", "reembolso", "refund", "reversal", "reverso"])) {
    return { type: "refund", confidence: 0.92, reasonCode: "refund_text_match" };
  }

  if (
    input.direction === "credit" &&
    hasAny(text, ["haberes", "salario", "sueldo", "nomina", "payroll", "salary"])
  ) {
    return { type: "income", confidence: 0.97, reasonCode: "salary_text_match" };
  }

  if (
    input.direction === "debit" &&
    hasAny(text, ["pago tarjeta", "pago de tarjeta", "card payment", "pago tc", "tarjeta credito"])
  ) {
    return { type: "card_payment", confidence: 0.9, reasonCode: "card_payment_text_match" };
  }

  if (
    input.direction === "debit" &&
    hasAny(text, ["cuota prestamo", "pago prestamo", "loan payment", "cuota credito"])
  ) {
    return { type: "debt_payment", confidence: 0.9, reasonCode: "debt_payment_text_match" };
  }

  if (
    input.direction === "credit" &&
    hasAny(text, ["desembolso prestamo", "desembolso credito", "loan disbursement", "credito desembolsado"])
  ) {
    return { type: "debt_draw", confidence: 0.9, reasonCode: "debt_draw_text_match" };
  }

  if (
    input.direction === "debit" &&
    hasAny(text, ["cajero", "atm", "extraccion efectivo", "retiro efectivo"])
  ) {
    return { type: "cash_withdrawal", confidence: 0.88, reasonCode: "cash_withdrawal_text_match" };
  }

  if (
    input.direction === "credit" &&
    hasAny(text, ["deposito efectivo", "cash deposit"])
  ) {
    return { type: "cash_deposit", confidence: 0.88, reasonCode: "cash_deposit_text_match" };
  }

  if (
    input.direction === "debit" &&
    hasAny(text, ["comision", "commission", "cargo bancario", "bank fee", "mantenimiento cuenta"])
  ) {
    return { type: "fee", confidence: 0.9, reasonCode: "fee_text_match" };
  }

  if (
    input.direction === "debit" &&
    hasAny(text, ["impuesto", "tributo", "tax", "iva "])
  ) {
    return { type: "tax", confidence: 0.85, reasonCode: "tax_text_match" };
  }

  if (
    input.direction === "debit" &&
    hasAny(text, ["aporte inversion", "investment contribution", "aporte fondo"])
  ) {
    return {
      type: "investment_contribution",
      confidence: 0.85,
      reasonCode: "investment_contribution_text_match",
    };
  }

  if (
    input.direction === "credit" &&
    hasAny(text, ["retiro inversion", "investment withdrawal", "rescate fondo"])
  ) {
    return {
      type: "investment_withdrawal",
      confidence: 0.85,
      reasonCode: "investment_withdrawal_text_match",
    };
  }

  // Generic transfers deliberately keep directional economics here. If a
  // matching opposite movement exists in another owned account, reconciliation
  // later overrides both rows to internal_transfer. This avoids double counting
  // own transfers without hiding true third-party transfers by default.
  if (hasAny(text, ["transferencia", "transfer", "sip ", "spi "])) {
    return input.direction === "credit"
      ? { type: "income", confidence: 0.58, reasonCode: "generic_transfer_credit_pending_reconciliation" }
      : { type: "expense", confidence: 0.62, reasonCode: "generic_transfer_debit_pending_reconciliation" };
  }

  return input.direction === "credit"
    ? { type: "income", confidence: 0.55, reasonCode: "generic_credit" }
    : { type: "expense", confidence: 0.65, reasonCode: "generic_debit" };
}
