/**
 * La cartera: qué te deben, desde cuándo, y cuánto tardan en pagarte.
 *
 * ============================================================
 * POR QUÉ ESTO NO EXISTÍA
 * ============================================================
 *
 * Hasta la v107, "crédito" significaba solo "todavía no cobrado". Sin
 * vencimiento no se puede decir si algo está atrasado, y sin pagos parciales
 * un cliente que abona la mitad obligaba a elegir entre decir que pagó todo o
 * que no pagó nada. Con las dos cosas se pueden calcular los números con los
 * que se maneja el crédito, que son estos.
 *
 * Todo acá es puro: recibe filas ya leídas y no consulta nada.
 */

export type DocumentoCartera = {
  id: string;
  fecha: string;
  /** Null cuando no se pactó plazo. No es lo mismo que vencido. */
  vence_el: string | null;
  moneda: string;
  total: number;
  /** Suma de los cobros o pagos registrados contra el documento. */
  cobrado: number;
  contacto_id: string | null;
  contacto_nombre: string | null;
};

export const SALDO_CERO = 1;

/** Lo que falta cobrar. Nunca negativo: la base impide cobrar de más. */
export function saldoDe(d: DocumentoCartera): number {
  return Math.max(0, d.total - d.cobrado);
}

export function estaPendiente(d: DocumentoCartera): boolean {
  // Con tolerancia de un guaraní: PYG no lleva decimales y comparar contra
  // cero exacto marcaría como pendiente una diferencia de redondeo.
  return saldoDe(d) > SALDO_CERO;
}

function dias(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/**
 * Los tramos de antigüedad.
 *
 * Son los que usa cualquier estado de cartera —corriente, 1-30, 31-60, 61-90,
 * más de 90— y no una invención: al mes de atraso se llama, a los tres se
 * empieza a dar por perdido. Se cuenta desde el VENCIMIENTO, no desde la
 * fecha del documento: una factura a 60 días emitida hace 45 no está atrasada.
 */
export type Tramo = "corriente" | "1-30" | "31-60" | "61-90" | "mas-90" | "sin-vencimiento";

export function tramoDe(d: DocumentoCartera, hoy: string): Tramo {
  if (d.vence_el === null) return "sin-vencimiento";

  const atraso = dias(d.vence_el, hoy);
  if (atraso <= 0) return "corriente";
  if (atraso <= 30) return "1-30";
  if (atraso <= 60) return "31-60";
  if (atraso <= 90) return "61-90";
  return "mas-90";
}

export type LineaAntiguedad = { tramo: Tramo; total: number; documentos: number };

export type Antiguedad = {
  moneda: string;
  total: number;
  lineas: LineaAntiguedad[];
  /** Lo que ya venció, sumado. Es el número que se mira primero. */
  vencido: number;
};

const ORDEN: Tramo[] = ["corriente", "1-30", "31-60", "61-90", "mas-90", "sin-vencimiento"];

/**
 * El estado de cartera de una moneda.
 *
 * Solo entran los documentos con saldo: uno cobrado no es cartera. Y solo de
 * UNA moneda, porque sumar guaraníes con dólares es la regla que este proyecto
 * no rompe.
 */
export function antiguedad(
  documentos: DocumentoCartera[],
  moneda: string,
  hoy: string,
): Antiguedad {
  const pendientes = documentos.filter((d) => d.moneda === moneda && estaPendiente(d));

  const porTramo = new Map<Tramo, { total: number; documentos: number }>();
  for (const d of pendientes) {
    const tramo = tramoDe(d, hoy);
    const previo = porTramo.get(tramo) ?? { total: 0, documentos: 0 };
    porTramo.set(tramo, { total: previo.total + saldoDe(d), documentos: previo.documentos + 1 });
  }

  const lineas = ORDEN.filter((t) => porTramo.has(t)).map((tramo) => ({
    tramo,
    total: porTramo.get(tramo)!.total,
    documentos: porTramo.get(tramo)!.documentos,
  }));

  // "Sin vencimiento" NO cuenta como vencido: nadie pactó una fecha, así que
  // no se puede afirmar que esté atrasado. Se muestra aparte.
  const vencido = lineas
    .filter((l) => l.tramo !== "corriente" && l.tramo !== "sin-vencimiento")
    .reduce((s, l) => s + l.total, 0);

  return {
    moneda,
    total: lineas.reduce((s, l) => s + l.total, 0),
    lineas,
    vencido,
  };
}

/**
 * DSO — cuántos días tarda en cobrarse una venta, en promedio.
 *
 * Se calcula sobre lo efectivamente COBRADO en el período, no sobre la
 * fórmula clásica de saldo sobre ventas: esa aproxima el DSO a partir de un
 * stock, y con pocos meses de datos da un número que se mueve por razones que
 * no tienen que ver con la cobranza. Acá se mide lo que realmente pasó —de la
 * fecha del documento a la fecha del cobro—, que además es lo que un
 * comerciante entiende cuando pregunta "¿cuánto tardan en pagarme?".
 *
 * `null` cuando no hubo cobros en el período: sin cobros no hay demora que
 * promediar, y un cero diría que le pagan el mismo día.
 */
export type CobroConDocumento = {
  fechaDocumento: string;
  fechaCobro: string;
  monto: number;
  moneda: string;
};

export function diasPromedioDeCobro(cobros: CobroConDocumento[], moneda: string): number | null {
  const propios = cobros.filter((c) => c.moneda === moneda && c.monto > 0);
  if (propios.length === 0) return null;

  // Ponderado por monto: cobrar 10 millones a 60 días pesa más que cobrar
  // 100.000 a 5 días. Un promedio simple diría que cobrás rápido cuando lo
  // que cobrás rápido es lo chico.
  const peso = propios.reduce((s, c) => s + c.monto, 0);
  if (peso === 0) return null;

  const suma = propios.reduce(
    (s, c) => s + Math.max(0, dias(c.fechaDocumento, c.fechaCobro)) * c.monto,
    0,
  );

  return Math.round((suma / peso) * 10) / 10;
}

/**
 * Los documentos vencidos, del más viejo al más nuevo.
 *
 * Es la lista accionable: a quién llamar primero. Sin vencimiento no entran,
 * por lo mismo de arriba.
 */
export function vencidos(documentos: DocumentoCartera[], hoy: string): DocumentoCartera[] {
  return documentos
    .filter((d) => estaPendiente(d) && d.vence_el !== null && dias(d.vence_el, hoy) > 0)
    .sort((a, b) => (a.vence_el as string).localeCompare(b.vence_el as string));
}

/** Cuántos días hace que venció. Negativo o cero si todavía no venció. */
export function diasDeAtraso(d: DocumentoCartera, hoy: string): number | null {
  return d.vence_el === null ? null : dias(d.vence_el, hoy);
}
