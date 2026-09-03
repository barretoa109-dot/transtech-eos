/**
 * La posición: con qué cuenta el negocio y qué debe.
 *
 * ============================================================
 * ESTO NO ES UN BALANCE, Y NO PUEDE SERLO
 * ============================================================
 *
 * Un balance necesita tres cosas: activo, pasivo y patrimonio. De las tres,
 * EOS conoce PARTES de dos y nada de la tercera.
 *
 *   ACTIVO CORRIENTE
 *     ✓ cuentas por cobrar — sale de la cartera
 *     ✓ inventario         — sale del kardex valorizado
 *     ✗ caja y bancos      — el negocio no declara su saldo en ningún lado
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
 * La LIQUIDEZ CORRIENTE se calcula con la misma información, pero le falta la
 * caja, y la caja tira el número para arriba. Así que el ratio que sale es un
 * PISO: la liquidez real es esa o mejor, nunca peor. Eso se dice con esas
 * palabras, porque un ratio incompleto presentado como exacto es peor que no
 * mostrarlo.
 *
 * La PRUEBA ÁCIDA no se calcula. Sacar el inventario del activo dejaría solo
 * cuentas por cobrar, justo cuando el dato que falta —la caja— es el que más
 * pesa en ese ratio. Sería el número menos confiable de todos presentado como
 * el más exigente.
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

  /** Lo que te deben y todavía no cobraste. */
  por_cobrar: number;
  /** Lo que vale la mercadería en depósito, al costo. */
  inventario: number;
  /** Los dos anteriores. NO incluye caja: ver el encabezado. */
  activo_conocido: number;

  /** Lo que debés a proveedores. */
  por_pagar: number;
  /** Las cuotas de deuda que caen dentro de los próximos doce meses. */
  deuda_12_meses: number;
  pasivo_conocido: number;

  /** Activo conocido menos pasivo conocido. */
  capital_de_trabajo: number;

  /**
   * Un PISO de la liquidez corriente: falta la caja, que solo puede subirlo.
   * Null cuando no se debe nada, porque dividir por cero no da infinito, da
   * "no aplica".
   */
  liquidez_piso: number | null;

  /** Qué no se pudo incluir. */
  faltantes: string[];
  advertencias: string[];
};

/** Cuántos meses de cuotas caen dentro del año. */
const MESES_CORRIENTE = 12;

export const NO_HAY_PATRIMONIO =
  "No se puede calcular ROE ni ROA: el sistema no guarda patrimonio, aportes ni resultados acumulados.";

export const FALTA_LA_CAJA =
  "Falta el saldo de caja y bancos, que el negocio no declara en ningún lado. Todo lo de acá es un piso: con la caja, mejora.";

export function posicion(datos: {
  ventasPendientes: DocumentoCartera[];
  comprasPendientes: DocumentoCartera[];
  /** Valor del inventario por moneda, del kardex. */
  inventario: { moneda: string; valor: number }[];
  deudas: CuotaDeuda[];
}): Posicion[] {
  const { ventasPendientes, comprasPendientes, inventario, deudas } = datos;

  const monedas = new Set<string>();
  for (const d of ventasPendientes) monedas.add(d.moneda);
  for (const d of comprasPendientes) monedas.add(d.moneda);
  for (const i of inventario) monedas.add(i.moneda);
  for (const d of deudas) monedas.add(d.moneda);

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

    const activo = porCobrar + valorStock;
    const pasivo = porPagar + deuda12;

    const faltantes = [FALTA_LA_CAJA, NO_HAY_PATRIMONIO];
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
      por_cobrar: porCobrar,
      inventario: valorStock,
      activo_conocido: activo,
      por_pagar: porPagar,
      deuda_12_meses: deuda12,
      pasivo_conocido: pasivo,
      capital_de_trabajo: activo - pasivo,
      liquidez_piso: pasivo === 0 ? null : activo / pasivo,
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
  if (p.pasivo_conocido === 0) {
    return "No tenés deudas registradas: todo lo que te deben y lo que tenés en mercadería queda libre.";
  }
  if (p.capital_de_trabajo < 0) {
    return "Debés más de lo que tenés por cobrar y en mercadería juntos. Falta sumar la caja, que puede dar vuelta el número.";
  }
  return "Entre lo que te deben y lo que tenés en mercadería alcanzás a cubrir lo que debés, sin contar la caja.";
}
