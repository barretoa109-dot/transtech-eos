/**
 * La posición: con qué cuenta el negocio y qué debe.
 *
 * ============================================================
 * ESTO NO ES UN BALANCE, Y NO PUEDE SERLO
 * ============================================================
 *
 * Un balance necesita tres cosas: activo, pasivo y patrimonio. De las tres,
 * EOS conoce casi toda una, partes de otra y nada de la tercera.
 *
 *   ACTIVO CORRIENTE
 *     ✓ caja y bancos      — desde la v120: saldo declarado + lo que se cobró
 *                            y pagó después. Opcional: si no lo cargaron,
 *                            entra como `null` y NO como cero.
 *     ✓ cuentas por cobrar — sale de la cartera
 *     ✓ inventario         — sale del kardex valorizado
 *
 *   PASIVO CORRIENTE
 *     ✓ cuentas por pagar  — sale de la cartera de compras
 *     ✓ cuotas de deuda    — salen de las deudas declaradas
 *     ✗ impuestos a pagar, sueldos devengados, provisiones
 *
 *   PATRIMONIO
 *     ✗ nada. No existe cuenta de capital, ni aportes, ni resultados
 *       acumulados.
 *
 * Por eso acá NO hay ROE ni ROA. Los dos se dividen por patrimonio o por
 * activo total, y las dos cifras serían inventadas. Un ROE falso se ve
 * idéntico a uno verdadero, y alguien decide sobre él.
 *
 * ============================================================
 * LO QUE SÍ SE PUEDE, Y ES ÚTIL
 * ============================================================
 *
 * El CAPITAL DE TRABAJO —lo que te deben más lo que tenés en mercadería,
 * menos lo que debés— se calcula entero con datos que existen, y responde una
 * pregunta que un dueño se hace de verdad: si cobro todo y vendo todo lo que
 * tengo, ¿me alcanza para pagar lo que debo?
 *
 * La LIQUIDEZ CORRIENTE depende de si cargaron la caja. Con ella es el ratio
 * de verdad. Sin ella falta justo el activo que más lo sube, así que lo que
 * sale es un PISO —la liquidez real es esa o mejor, nunca peor— y
 * `liquidez_es_piso` lo dice para que la pantalla no lo presente como exacto.
 *
 * La PRUEBA ÁCIDA solo existe con caja. Sin ella, sacar el inventario dejaría
 * el ratio armado casi solo con cuentas por cobrar, justo cuando el dato que
 * falta es el que más pesa: sería el número menos confiable de todos
 * presentado como el más exigente. Por eso queda en null y no en un número
 * más chico.
 *
 * Todo acá es puro.
 */

import { estaPendiente, saldoDe, type DocumentoCartera } from "../erp/cartera.ts";

export type CuotaDeuda = {
  moneda: string;
  /** Lo que sale por mes. */
  cuota: number;
  /** Cuántas quedan. Null = indefinida. */
  restantes: number | null;
};

export type Posicion = {
  moneda: string;

  /**
   * Lo que hay en caja y bancos, del saldo declarado más los cobros y pagos
   * posteriores. Null cuando el negocio todavía no cargó ninguna caja: cero
   * diría que no tiene plata, que es otra cosa.
   */
  caja: number | null;
  /** Lo que te deben y todavía no cobraste. */
  por_cobrar: number;
  /** Lo que vale la mercadería en depósito, al costo. */
  inventario: number;
  /** Los tres anteriores, con la caja adentro cuando se conoce. */
  activo_conocido: number;

  /** Lo que debés a proveedores. */
  por_pagar: number;
  /** Las cuotas de deuda que caen dentro de los próximos doce meses. */
  deuda_12_meses: number;
  pasivo_conocido: number;

  /** Activo conocido menos pasivo conocido. */
  capital_de_trabajo: number;

  /**
   * La liquidez corriente. Null cuando no se debe nada: dividir por cero no da
   * infinito, da "no aplica".
   */
  liquidez: number | null;
  /**
   * Si el número de arriba es exacto o es solo un PISO.
   *
   * Con la caja cargada es el ratio de verdad. Sin ella falta el activo que
   * más lo sube, así que la liquidez real es esa o mejor, nunca peor — y eso
   * hay que decirlo con esas palabras.
   */
  liquidez_es_piso: boolean;
  /**
   * Prueba ácida: lo líquido sobre lo que se debe, sin contar la mercadería.
   *
   * Null sin caja, y no un número más chico: sacar el inventario dejaría solo
   * cuentas por cobrar, justo cuando el dato que falta es el que más pesa. Ese
   * ratio sería el menos confiable de todos presentado como el más exigente.
   */
  prueba_acida: number | null;

  /** Qué no se pudo incluir. */
  faltantes: string[];
  advertencias: string[];
};

/** Cuántos meses de cuotas caen dentro del año. */
const MESES_CORRIENTE = 12;

export const NO_HAY_PATRIMONIO =
  "No se puede calcular ROE ni ROA: el sistema no guarda patrimonio, aportes ni resultados acumulados.";

export const FALTA_LA_CAJA =
  "Falta el saldo de caja y bancos: cargá una caja en Tu equipo y estos números dejan de ser un piso.";

export function posicion(datos: {
  ventasPendientes: DocumentoCartera[];
  comprasPendientes: DocumentoCartera[];
  /** Valor del inventario por moneda, del kardex. */
  inventario: { moneda: string; valor: number }[];
  deudas: CuotaDeuda[];
  /** Saldo de caja por moneda (v120). Vacío mientras no carguen ninguna. */
  caja?: { moneda: string; saldo: number }[];
}): Posicion[] {
  const { ventasPendientes, comprasPendientes, inventario, deudas, caja = [] } = datos;

  const monedas = new Set<string>();
  for (const d of ventasPendientes) monedas.add(d.moneda);
  for (const d of comprasPendientes) monedas.add(d.moneda);
  for (const i of inventario) monedas.add(i.moneda);
  for (const d of deudas) monedas.add(d.moneda);
  for (const c of caja) monedas.add(c.moneda);

  return [...monedas].sort().map((moneda) => {
    const porCobrar = ventasPendientes
      .filter((d) => d.moneda === moneda && estaPendiente(d))
      .reduce((s, d) => s + saldoDe(d), 0);

    const porPagar = comprasPendientes
      .filter((d) => d.moneda === moneda && estaPendiente(d))
      .reduce((s, d) => s + saldoDe(d), 0);

    const valorStock = inventario.filter((i) => i.moneda === moneda).reduce((s, i) => s + i.valor, 0);

    /*
     * Una deuda sin plazo definido se cuenta como doce cuotas.
     *
     * Es la lectura conservadora: contarla como una sola cuota diría que casi
     * no se debe nada, y el capital de trabajo saldría inflado. Cuando el
     * error es inevitable, conviene que caiga del lado que no hace tomar una
     * decisión de más.
     */
    const deuda12 = deudas
      .filter((d) => d.moneda === moneda)
      .reduce((s, d) => s + d.cuota * Math.min(d.restantes ?? MESES_CORRIENTE, MESES_CORRIENTE), 0);

    /*
     * La caja solo entra si la declararon. `null` y `0` no son lo mismo: uno
     * es "no sé cuánto hay" y el otro es "no hay nada", y de esa diferencia
     * depende que la liquidez sea un número o un piso.
     */
    const filaCaja = caja.find((c) => c.moneda === moneda);
    const saldoCaja = filaCaja === undefined ? null : filaCaja.saldo;

    const activo = (saldoCaja ?? 0) + porCobrar + valorStock;
    const pasivo = porPagar + deuda12;

    // Lo líquido: caja y lo que te deben. La mercadería queda afuera porque
    // venderla lleva tiempo, y esa es toda la idea de la prueba ácida.
    const liquido = (saldoCaja ?? 0) + porCobrar;

    const faltantes = [NO_HAY_PATRIMONIO];
    if (saldoCaja === null) faltantes.unshift(FALTA_LA_CAJA);

    const advertencias: string[] = [];

    if (valorStock === 0 && inventario.some((i) => i.moneda === moneda)) {
      advertencias.push("El inventario vale cero: puede ser que los productos no tengan costo cargado.");
    }
    if (deudas.some((d) => d.moneda === moneda && d.restantes === null)) {
      advertencias.push("Hay deudas sin fecha de fin: se contaron doce cuotas, que es lo más prudente.");
    }
    if (pasivo === 0) {
      advertencias.push("No debés nada registrado, así que no hay ratio de liquidez que calcular.");
    }

    return {
      moneda,
      caja: saldoCaja,
      por_cobrar: porCobrar,
      inventario: valorStock,
      activo_conocido: activo,
      por_pagar: porPagar,
      deuda_12_meses: deuda12,
      pasivo_conocido: pasivo,
      capital_de_trabajo: activo - pasivo,
      liquidez: pasivo === 0 ? null : activo / pasivo,
      liquidez_es_piso: saldoCaja === null,
      // Sin caja no se calcula: sería el ratio menos confiable de todos
      // presentado como el más exigente.
      prueba_acida: saldoCaja === null || pasivo === 0 ? null : liquido / pasivo,
      faltantes,
      advertencias,
    };
  });
}

/**
 * Cómo se lee el capital de trabajo, en una frase.
 *
 * No devuelve un veredicto de "sano" o "enfermo": el mismo número es cómodo
 * para un almacén y apretado para una constructora, y el sistema no sabe en
 * cuál está parado. Describe la situación y deja el juicio a quien la vive.
 */
export function leerCapitalDeTrabajo(p: Posicion): string {
  const conCaja = p.caja !== null;

  if (p.pasivo_conocido === 0) {
    return conCaja
      ? "No tenés deudas registradas: la caja, lo que te deben y la mercadería quedan libres."
      : "No tenés deudas registradas: todo lo que te deben y lo que tenés en mercadería queda libre.";
  }
  if (p.capital_de_trabajo < 0) {
    // Sin caja el número puede estar incompleto y conviene decirlo antes de
    // que alguien tome una decisión con él.
    return conCaja
      ? "Debés más de lo que tenés entre caja, cobranzas y mercadería."
      : "Debés más de lo que tenés por cobrar y en mercadería juntos. Falta sumar la caja, que puede dar vuelta el número.";
  }
  return conCaja
    ? "Entre la caja, lo que te deben y la mercadería alcanzás a cubrir lo que debés."
    : "Entre lo que te deben y lo que tenés en mercadería alcanzás a cubrir lo que debés, sin contar la caja.";
}
