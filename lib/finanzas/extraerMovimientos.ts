/**
 * Convierte los hallazgos crudos del pipeline de documentos
 * (`eos_document_findings_v11`) en movimientos financieros candidatos.
 *
 * El detector existente (`money-regex-v1`) solo guarda el texto tal cual
 * aparece ("Gs. 1.500.000"), sin número ni dirección. Acá se hace el trabajo
 * que falta: normalizar el importe, inferir si es ingreso/gasto/compromiso y
 * asociarle una fecha.
 *
 * Deliberadamente puro (sin I/O) para poder razonarlo y testearlo aislado:
 * un error acá contamina el disponible real del usuario.
 */

export type MoneyFinding = {
  id: string;
  document_id: string;
  value_text: string | null;
  evidence_text: string | null;
  created_at?: string;
};

export type DateFinding = {
  value_text: string | null;
  evidence_text: string | null;
};

export type MovimientoCandidato = {
  finding_id: string;
  document_id: string;
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number;
  moneda: "PYG" | "USD";
  descripcion: string;
  fecha: string | null;
  confianza: number;
  evidencia: string;
};

const MESES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/** Palabras que indican dinero entrando. */
const INGRESO = [
  "cobro",
  "cobrado",
  "cobramos",
  "ingreso",
  "ingresos",
  "venta",
  "ventas",
  "vendido",
  "facturado",
  "facturación",
  "recibido",
  "recibimos",
  "abono",
  "depósito",
  "deposito",
  "acreditación",
  "acreditacion",
  "salario",
  "sueldo",
  "honorarios",
  "transferencia recibida",
];

/** Palabras que indican dinero saliendo. */
const GASTO = [
  "gasto",
  "gastos",
  "pago",
  "pagado",
  "pagamos",
  "compra",
  "compras",
  "comprado",
  "egreso",
  "egresos",
  "costo",
  "costos",
  "débito",
  "debito",
  "retiro",
  "proveedor",
  "alquiler",
  "impuesto",
  "comisión",
  "comision",
];

/** Palabras que indican un compromiso futuro, no un movimiento ya ocurrido. */
const COMPROMISO = [
  "vence",
  "vencimiento",
  "a pagar",
  "por pagar",
  "cuota",
  "cuotas",
  "próximo pago",
  "proximo pago",
  "pendiente de pago",
  "saldo pendiente",
  "financiación",
  "financiacion",
];

/**
 * Normaliza un importe escrito en formato local a número + moneda.
 * Maneja "Gs. 1.500.000", "USD 1,500.50", "₲184.000", "2.300.000 guaraníes".
 */
export function parsearImporte(texto: string): { monto: number; moneda: "PYG" | "USD" } | null {
  if (!texto) return null;

  const limpio = texto.trim();
  const enMinusculas = limpio.toLowerCase();

  // Un porcentaje no es plata. "5,5%" entraba como ₲5,5.
  if (limpio.includes("%")) return null;

  const esUSD =
    /\b(usd|us\$|d[oó]lar)/i.test(limpio) || (/\$/.test(limpio) && !/gs|₲|pyg|guaran/i.test(enMinusculas));

  // Nos quedamos solo con dígitos y separadores.
  const numerico = limpio.replace(/[^\d.,]/g, "");
  if (!numerico) return null;

  // Ceros a la izquierda: nadie escribe ₲000123456. Es un número de
  // comprobante, de cuenta o de operación — la fuente más común de importes
  // falsos en un extracto.
  if (/^0\d/.test(numerico)) return null;

  const tieneComa = numerico.includes(",");
  const tienePunto = numerico.includes(".");

  let normalizado = numerico;

  if (tieneComa && tienePunto) {
    // El separador que aparece último es el decimal.
    const ultimaComa = numerico.lastIndexOf(",");
    const ultimoPunto = numerico.lastIndexOf(".");
    normalizado =
      ultimaComa > ultimoPunto ? numerico.replace(/\./g, "").replace(",", ".") : numerico.replace(/,/g, "");
  } else if (tieneComa) {
    const partes = numerico.split(",");
    const ultima = partes[partes.length - 1];
    // "1,50" -> decimal; "1,500" o "1,500,000" -> miles.
    normalizado = partes.length === 2 && ultima.length <= 2 ? numerico.replace(",", ".") : numerico.replace(/,/g, "");
  } else if (tienePunto) {
    const partes = numerico.split(".");
    const ultima = partes[partes.length - 1];
    // En guaraníes el punto es siempre separador de miles (no hay centavos).
    if (!(partes.length === 2 && ultima.length <= 2 && esUSD)) {
      normalizado = numerico.replace(/\./g, "");
    }
  }

  const monto = Number(normalizado);
  if (!Number.isFinite(monto) || monto <= 0) return null;

  // El guaraní no tiene centavos. Un decimal acá no es un importe con
  // fracción: es una lectura que salió mal ("Gs. 1,5" por "Gs. 1,5 millones").
  // Guardrail 3: decir "no sé" antes que inventar un número.
  // "1.234.567,00" sí pasa —Number lo devuelve entero—, que es como los
  // extractos escriben los montos redondos.
  if (!esUSD && !Number.isInteger(monto)) return null;

  return { monto, moneda: esUSD ? "USD" : "PYG" };
}

/** Convierte una fecha escrita en español a ISO (YYYY-MM-DD). */
export function parsearFecha(texto: string | null | undefined, anioPorDefecto?: number): string | null {
  if (!texto) return null;
  const limpio = texto.trim().toLowerCase();

  // 15/08/2026, 15-8-26, 15.08.2026
  const numerica = limpio.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (numerica) {
    const dia = Number(numerica[1]);
    const mes = Number(numerica[2]);
    let anio = Number(numerica[3]);
    if (anio < 100) anio += 2000;
    return armarISO(anio, mes, dia);
  }

  // "15 de agosto de 2026" / "15 de agosto"
  const conMes = limpio.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/,
  );
  if (conMes) {
    const dia = Number(conMes[1]);
    const mes = MESES[conMes[2]];
    const anio = conMes[3] ? Number(conMes[3]) : (anioPorDefecto ?? new Date().getFullYear());
    return armarISO(anio, mes, dia);
  }

  return null;
}

function armarISO(anio: number, mes: number, dia: number): string | null {
  if (!anio || !mes || !dia) return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  // Rechaza fechas imposibles tipo 31/02.
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;

  return fecha.toISOString().slice(0, 10);
}

/**
 * Marcas de que la plata fue RECIBIDA, no apenas mencionada.
 *
 * Sirven para desempatar, no para puntuar. "Pago recibido del cliente" tiene
 * una palabra de cada lado —'pago' sale, 'recibido' entra— y el empate caía al
 * default 'gasto': un cobro de ₲2.000.000 se descontaba en vez de sumarse, con
 * un error total de ₲4.000.000.
 *
 * Se desempata a favor del ingreso solo con estas marcas y no con cualquier
 * palabra de la lista de ingresos, porque en Paraguay 'cobro' es ambiguo: lo
 * que yo cobro y lo que el banco me cobra se escriben igual. 'Recibido' y
 * 'acreditado', en cambio, solo se dicen de la plata que entra.
 */
const RECEPCION_EXPLICITA = [
  "recibido",
  "recibida",
  "recibimos",
  "recibiste",
  "acreditación",
  "acreditacion",
  "acreditado",
  "acreditada",
  "depositado",
  "a mi favor",
  "a tu favor",
  "a su favor",
];

/** Infiere la dirección del movimiento según el contexto de la frase. */
export function inferirTipo(contexto: string): { tipo: MovimientoCandidato["tipo"]; confianza: number } {
  const texto = contexto.toLowerCase();

  /**
   * Cuenta CONCEPTOS distintos, no coincidencias de texto.
   *
   * "compras" hace match con "compra" y con "compras" a la vez, así que la
   * misma evidencia puntuaba 2 en plural y 1 en singular — y 2 es lo que sube
   * la confianza a 0,85, el nivel con el que la UI deja de pedir revisión. La
   * fuerza de una prueba no puede depender de la gramática.
   */
  const puntaje = (palabras: string[]) => {
    const conceptos = new Set<string>();
    for (const palabra of palabras) {
      if (texto.includes(palabra)) conceptos.add(palabra.replace(/s$/, ""));
    }
    return conceptos.size;
  };

  const compromiso = puntaje(COMPROMISO);
  const ingreso = puntaje(INGRESO);
  const gasto = puntaje(GASTO);

  // Un compromiso futuro manda por encima de la dirección: impacta el
  // disponible real de otra forma (se descuenta aunque todavía no ocurrió).
  if (compromiso > 0 && compromiso >= Math.max(ingreso, gasto)) {
    return { tipo: "compromiso", confianza: 0.7 };
  }

  if (ingreso > gasto) return { tipo: "ingreso", confianza: ingreso >= 2 ? 0.85 : 0.7 };
  if (gasto > ingreso) return { tipo: "gasto", confianza: gasto >= 2 ? 0.85 : 0.7 };

  // Empate con señales de los dos lados. Gana el ingreso solo si el texto dice
  // explícitamente que la plata se recibió; la confianza queda baja a
  // propósito, porque sigue siendo un texto ambiguo y la UI debe pedir
  // revisión antes de tocar el disponible real.
  if (ingreso > 0 && ingreso === gasto && RECEPCION_EXPLICITA.some((p) => texto.includes(p))) {
    return { tipo: "ingreso", confianza: 0.6 };
  }

  // Sin señales claras se asume gasto (lo más frecuente en comprobantes),
  // pero con confianza baja para que la UI lo marque como "revisar".
  return { tipo: "gasto", confianza: 0.4 };
}

/** Arma una descripción corta y legible a partir de la evidencia. */
function armarDescripcion(evidencia: string): string {
  const limpio = evidencia.replace(/\s+/g, " ").trim();
  if (limpio.length <= 90) return limpio;
  return `${limpio.slice(0, 87)}…`;
}

export function extraerMovimientos(
  moneyFindings: MoneyFinding[],
  dateFindings: DateFinding[] = [],
  opciones: { fechaDocumento?: string | null } = {},
): MovimientoCandidato[] {
  const candidatos: MovimientoCandidato[] = [];
  const vistos = new Set<string>();

  // Fecha de respaldo: la primera fecha detectada en el documento.
  const fechaFallback =
    dateFindings.map((d) => parsearFecha(d.value_text)).find((f): f is string => Boolean(f)) ??
    opciones.fechaDocumento ??
    null;

  for (const finding of moneyFindings) {
    const importe = parsearImporte(finding.value_text ?? "");
    if (!importe) continue;

    const evidencia = finding.evidence_text ?? finding.value_text ?? "";
    const { tipo, confianza } = inferirTipo(evidencia);

    // Preferimos una fecha dentro de la misma frase; si no, la del documento.
    const fecha = parsearFecha(evidencia) ?? fechaFallback;

    // Evita duplicar el mismo importe con el mismo contexto.
    const clave = `${importe.monto}|${tipo}|${armarDescripcion(evidencia).slice(0, 40)}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);

    candidatos.push({
      finding_id: finding.id,
      document_id: finding.document_id,
      tipo,
      monto: importe.monto,
      moneda: importe.moneda,
      descripcion: armarDescripcion(evidencia),
      fecha,
      confianza,
      evidencia,
    });
  }

  return candidatos;
}
