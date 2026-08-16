export interface FinancialCsvMapping {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  currency?: string;
  externalId?: string;
  defaultCurrency: string;
  defaultExponent?: number;
  delimiter?: "," | ";" | "\t";
}

export interface FinancialImportCandidate {
  rowNumber: number;
  occurredAt: string;
  descriptionRaw: string;
  amountMinor: number;
  currency: string;
  direction: "credit" | "debit";
  externalId: string | null;
  sourceFingerprintMaterial: string;
}

function detectDelimiter(header: string): "," | ";" | "\t" {
  const candidates = [",", ";", "\t"] as const;
  return candidates
    .map((delimiter) => ({ delimiter, count: header.split(delimiter).length - 1 }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ",";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("missing transaction date");

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return direct.toISOString();
  }

  const match = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) throw new Error(`unsupported transaction date: ${trimmed}`);

  const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
  const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  if (
    date.getUTCFullYear() !== +year ||
    date.getUTCMonth() !== +month - 1 ||
    date.getUTCDate() !== +day
  ) {
    throw new Error(`invalid transaction date: ${trimmed}`);
  }
  return date.toISOString();
}

function currencyExponent(currency: string, configured?: number) {
  if (configured !== undefined) return configured;
  return currency.toUpperCase() === "PYG" ? 0 : 2;
}

function parseAmount(value: string, exponent: number): number {
  let normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/[₲$€£]/g, "")
    .replace(/[^0-9,.-]/g, "");

  if (!normalized) throw new Error("missing amount");

  const negativeByParens = value.includes("(") && value.includes(")");
  const sign = normalized.startsWith("-") || negativeByParens ? -1 : 1;
  normalized = normalized.replace(/-/g, "");

  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  let decimalSeparator: "," | "." | null = null;

  if (exponent > 0) {
    if (lastComma >= 0 && lastDot >= 0) decimalSeparator = lastComma > lastDot ? "," : ".";
    else if (lastComma >= 0 && normalized.length - lastComma - 1 <= exponent) decimalSeparator = ",";
    else if (lastDot >= 0 && normalized.length - lastDot - 1 <= exponent) decimalSeparator = ".";
  }

  if (decimalSeparator) {
    const parts = normalized.split(decimalSeparator);
    const decimal = parts.pop() ?? "";
    const whole = parts.join("").replace(/[.,]/g, "");
    const padded = decimal.padEnd(exponent, "0").slice(0, exponent);
    const minor = Number(`${whole || "0"}${padded}`);
    if (!Number.isSafeInteger(minor)) throw new Error(`unsafe amount: ${value}`);
    return sign * minor;
  }

  const whole = normalized.replace(/[.,]/g, "");
  const minor = Number(whole) * 10 ** exponent;
  if (!Number.isSafeInteger(minor)) throw new Error(`unsafe amount: ${value}`);
  return sign * minor;
}

export function parseFinancialCsv(csv: string, mapping: FinancialCsvMapping): FinancialImportCandidate[] {
  const clean = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!clean) return [];

  const lines = clean.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = mapping.delimiter ?? detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter);
  const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));

  const required = [mapping.date, mapping.description];
  if (!mapping.amount && !(mapping.debit && mapping.credit)) {
    throw new Error("mapping requires amount or debit+credit columns");
  }
  required.push(...(mapping.amount ? [mapping.amount] : [mapping.debit!, mapping.credit!]));
  for (const header of required) {
    if (!headerIndex.has(header)) throw new Error(`missing CSV column: ${header}`);
  }

  const read = (cells: string[], header?: string) =>
    header === undefined ? "" : cells[headerIndex.get(header) ?? -1] ?? "";

  const candidates: FinancialImportCandidate[] = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = parseCsvLine(lines[lineIndex], delimiter);
    const currency = (read(cells, mapping.currency) || mapping.defaultCurrency).toUpperCase();
    const exponent = currencyExponent(currency, mapping.defaultExponent);

    let direction: "credit" | "debit";
    let amountMinor: number;

    if (mapping.amount) {
      const signed = parseAmount(read(cells, mapping.amount), exponent);
      direction = signed < 0 ? "debit" : "credit";
      amountMinor = Math.abs(signed);
    } else {
      const debitText = read(cells, mapping.debit);
      const creditText = read(cells, mapping.credit);
      const debit = debitText ? Math.abs(parseAmount(debitText, exponent)) : 0;
      const credit = creditText ? Math.abs(parseAmount(creditText, exponent)) : 0;
      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        throw new Error(`row ${lineIndex + 1}: expected exactly one debit or credit amount`);
      }
      direction = debit > 0 ? "debit" : "credit";
      amountMinor = debit > 0 ? debit : credit;
    }

    const occurredAt = parseDate(read(cells, mapping.date));
    const descriptionRaw = read(cells, mapping.description).trim();
    const externalId = read(cells, mapping.externalId).trim() || null;

    candidates.push({
      rowNumber: lineIndex + 1,
      occurredAt,
      descriptionRaw,
      amountMinor,
      currency,
      direction,
      externalId,
      sourceFingerprintMaterial: [
        externalId ?? "",
        occurredAt,
        direction,
        amountMinor,
        currency,
        descriptionRaw.toLowerCase(),
      ].join("|"),
    });
  }

  return candidates;
}
