/**
 * El resumen del período, listo para llevarle al contador.
 *
 * ============================================================
 * LO QUE ESTE MÓDULO NO HACE, Y POR QUÉ
 * ============================================================
 *
 * La hoja de ruta pide "trámites (ej. SET/Marangatú) preparados
 * automáticamente". Preparar es lo que hace esto. **Calcular el impuesto y
 * presentar la declaración, no.** Dos motivos, los dos de fondo:
 *
 *   1. **Presentar exige credenciales de Marangatú.** Manejar la clave fiscal
 *      de alguien es exactamente lo que este sistema no debe hacer, y ninguna
 *      comodidad lo justifica.
 *   2. **Calcular el IVA exige saber qué operación es gravada, exenta o al 5%,
 *      y con qué comprobante.** Eso es criterio contable sobre el negocio del
 *      usuario, no aritmética. Un sistema que lo adivine produce una
 *      declaración mal hecha, y la multa la paga el usuario.
 *
 * Lo que sí resuelve —y es la parte tediosa de verdad— es juntar el período
 * completo, ordenado, con el origen de cada movimiento y, sobre todo,
 * **diciendo qué parte no tiene respaldo documental**. Ese último dato es el
 * que el contador va a pedir primero y el que el usuario nunca tiene a mano.
 */

export type MovimientoDelPeriodo = {
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number;
  moneda: string;
  fecha: string;
  descripcion: string | null;
  categoria?: string | null;
  origen: string;
  documento_id?: string | null;
};

export type ResumenPeriodo = {
  desde: string;
  hasta: string;
  ingresos: { total: number; cantidad: number };
  gastos: { total: number; cantidad: number };
  /**
   * Lo que el contador va a preguntar primero: cuánto de esto no tiene un
   * comprobante detrás.
   */
  sin_respaldo: { total: number; cantidad: number; proporcion: number };
  /** Desglose por categoría, para no tener que sumar a mano. */
  por_categoria: { categoria: string; total: number; cantidad: number }[];
  /** De dónde salió cada dato: cuánto entró solo y cuánto cargó el usuario. */
  por_origen: { origen: string; cantidad: number }[];
  movimientos: MovimientoDelPeriodo[];
};

/**
 * ¿Este movimiento tiene un comprobante detrás?
 *
 * Un movimiento que salió de un documento subido lo tiene por definición. Los
 * que llegaron por correo tienen el aviso del banco, que sirve como respaldo de
 * la operación pero NO es una factura: para el contador, un aviso bancario
 * prueba que la plata se movió, no qué se compró. Por eso solo cuenta como
 * respaldo lo que vino de un documento.
 */
function tieneRespaldo(m: MovimientoDelPeriodo): boolean {
  return Boolean(m.documento_id) || m.origen === "documento";
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

export function resumirPeriodo(
  movimientos: MovimientoDelPeriodo[],
  rango: { desde: string; hasta: string },
): ResumenPeriodo {
  const { desde, hasta } = rango;

  const delPeriodo = movimientos.filter((m) => m.fecha >= desde && m.fecha <= hasta);

  // Los compromisos quedan afuera: son plata que todavía no se movió, y una
  // declaración se hace sobre lo que ocurrió, no sobre lo que va a ocurrir.
  const ocurridos = delPeriodo.filter((m) => m.tipo !== "compromiso");

  const ingresos = ocurridos.filter((m) => m.tipo === "ingreso");
  const gastos = ocurridos.filter((m) => m.tipo === "gasto");

  const sinRespaldo = ocurridos.filter((m) => !tieneRespaldo(m));
  const totalOcurrido = ocurridos.reduce((t, m) => t + m.monto, 0);
  const totalSinRespaldo = sinRespaldo.reduce((t, m) => t + m.monto, 0);

  const porCategoria = new Map<string, { total: number; cantidad: number }>();
  for (const m of gastos) {
    const clave = (m.categoria ?? "").trim() || "Sin categoría";
    const actual = porCategoria.get(clave) ?? { total: 0, cantidad: 0 };
    porCategoria.set(clave, { total: actual.total + m.monto, cantidad: actual.cantidad + 1 });
  }

  const porOrigen = new Map<string, number>();
  for (const m of ocurridos) {
    porOrigen.set(m.origen, (porOrigen.get(m.origen) ?? 0) + 1);
  }

  return {
    desde,
    hasta,
    ingresos: { total: redondear(ingresos.reduce((t, m) => t + m.monto, 0)), cantidad: ingresos.length },
    gastos: { total: redondear(gastos.reduce((t, m) => t + m.monto, 0)), cantidad: gastos.length },
    sin_respaldo: {
      total: redondear(totalSinRespaldo),
      cantidad: sinRespaldo.length,
      proporcion: totalOcurrido === 0 ? 0 : Math.round((totalSinRespaldo / totalOcurrido) * 100) / 100,
    },
    por_categoria: [...porCategoria.entries()]
      .map(([categoria, v]) => ({ categoria, total: redondear(v.total), cantidad: v.cantidad }))
      .sort((a, b) => b.total - a.total),
    por_origen: [...porOrigen.entries()]
      .map(([origen, cantidad]) => ({ origen, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad),
    movimientos: [...ocurridos].sort((a, b) => a.fecha.localeCompare(b.fecha)),
  };
}

/**
 * El período en CSV, que es lo que un contador abre sin preguntar nada.
 *
 * Se usa punto y coma como separador: Excel en configuración regional española
 * —la que tiene cualquier PC en Paraguay— parte por `;` y no por coma. Con
 * coma, el archivo se abre como una sola columna y el contador lo devuelve.
 */
export function aCSV(resumen: ResumenPeriodo): string {
  const encabezado = ["Fecha", "Tipo", "Descripción", "Categoría", "Moneda", "Monto", "Origen", "Respaldo"];

  const filas = resumen.movimientos.map((m) => [
    m.fecha,
    m.tipo,
    escapar(m.descripcion ?? ""),
    escapar(m.categoria ?? ""),
    m.moneda,
    String(m.monto),
    m.origen,
    tieneRespaldo(m) ? "documento" : "sin comprobante",
  ]);

  return [encabezado, ...filas].map((f) => f.join(";")).join("\r\n");
}

function escapar(texto: string): string {
  const limpio = texto.replace(/[\r\n]+/g, " ").trim();
  return limpio.includes(";") || limpio.includes('"')
    ? `"${limpio.replace(/"/g, '""')}"`
    : limpio;
}

/**
 * Lo que EOS le dice al usuario sobre su período.
 *
 * Nunca dice "declarás X": eso es criterio del contador. Dice qué hay y qué
 * falta, que es lo que EOS sí sabe.
 */
export function resumirEnPalabras(resumen: ResumenPeriodo, moneda = "PYG"): string {
  const simbolo = moneda === "USD" ? "US$" : "₲";
  const plata = (n: number) => `${simbolo} ${new Intl.NumberFormat("es-PY").format(Math.round(n))}`;

  if (resumen.movimientos.length === 0) {
    return "En este período no tengo ningún movimiento registrado.";
  }

  const base =
    `Del ${resumen.desde} al ${resumen.hasta}: entraron ${plata(resumen.ingresos.total)} ` +
    `y salieron ${plata(resumen.gastos.total)}.`;

  if (resumen.sin_respaldo.cantidad === 0) {
    return `${base} Todo tiene comprobante.`;
  }

  const porcentaje = Math.round(resumen.sin_respaldo.proporcion * 100);

  return (
    `${base} De eso, ${plata(resumen.sin_respaldo.total)} (${porcentaje}%) no tiene comprobante ` +
    `cargado — es lo primero que te va a pedir tu contador.`
  );
}
