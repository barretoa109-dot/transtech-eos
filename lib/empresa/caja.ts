/**
 * Cuánta plata tiene el negocio hoy.
 *
 * ============================================================
 * DECLARADO MÁS LO QUE EOS SÍ VIO
 * ============================================================
 *
 * EOS no ve el saldo real de ninguna cuenta. Lo que puede hacer es partir de
 * lo que el dueño declaró —con su fecha— y arrastrarle los cobros y pagos que
 * sí conoce desde ese día.
 *
 *     saldo de hoy = declarado + cobros posteriores − pagos posteriores
 *
 * Es la misma cuenta que ya hace `lib/finanzas` para la caja personal, y sirve
 * por lo mismo: el número mejora solo a medida que el negocio usa el ERP, sin
 * pedirle a nadie que actualice nada a mano.
 *
 * ============================================================
 * UN SALDO VIEJO NO ES UN SALDO
 * ============================================================
 *
 * El arrastre solo alcanza los movimientos que pasaron por EOS. Si alguien
 * pagó un flete en efectivo y no lo cargó, ese gasto no está. Cuanto más viejo
 * el saldo declarado, más ventanas hubo para que eso pase.
 *
 * Por eso cada saldo viaja con los DÍAS que tiene su declaración y con una
 * confianza que baja con ellos. La pantalla puede pedir que lo revisen sin
 * tener que decidir sola cuándo un número dejó de servir.
 *
 * ============================================================
 * NUNCA SE SUMAN MONEDAS
 * ============================================================
 *
 * Una caja pertenece a una moneda y los saldos salen por moneda. Sumar
 * guaraníes con dólares exigiría un tipo de cambio que este sistema no tiene,
 * y el número que saldría no sería el saldo de nada.
 *
 * Todo acá es puro.
 */

export type Caja = {
  id: string;
  nombre: string;
  tipo: string;
  moneda: string;
  /** Null cuando todavía no declararon cuánto hay. */
  saldo_declarado: number | null;
  /** Null junto con el anterior: la base obliga a que vayan de a dos. */
  saldo_declarado_el: string | null;
  activa: boolean;
};

/** Un cobro o un pago que EOS registró. Positivo entra, negativo sale. */
export type MovimientoCaja = {
  fecha: string;
  moneda: string;
  monto: number;
};

export type SaldoMoneda = {
  moneda: string;
  /** Lo que hay hoy, según la cuenta de arriba. */
  saldo: number;
  /** La suma de lo declarado, antes de arrastrar nada. */
  declarado: number;
  /** Lo que se le sumó o restó desde las fechas de declaración. */
  arrastrado: number;
  /** Cuántas cajas aportaron a este número. */
  cajas: number;
  /** Días desde la declaración MÁS VIEJA que entró en la cuenta. */
  dias_del_mas_viejo: number;
  /** De 0 a 1. Baja con la antigüedad de lo declarado. */
  confianza: number;
  /** Qué habría que hacer para que el número sea mejor. */
  avisos: string[];
};

/** A partir de acá conviene volver a contar. Un mes es un ciclo del negocio. */
export const DIAS_PARA_REVISAR = 30;

/** Y a partir de acá el número ya no se sostiene solo. */
export const DIAS_PARA_DESCONFIAR = 90;

function dias(desde: string, hasta: string): number {
  return Math.round(
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * La confianza según cuántos días tiene la declaración.
 *
 * Baja recto de 1 a 0,4 en los primeros noventa días y ahí se queda. No cae a
 * cero: un saldo viejo con sus movimientos arrastrados sigue siendo mejor
 * información que ninguna, y ponerlo en cero haría que la pantalla lo trate
 * como si no existiera.
 */
export function confianzaPorEdad(diasDeEdad: number): number {
  if (diasDeEdad <= 0) return 1;
  if (diasDeEdad >= DIAS_PARA_DESCONFIAR) return 0.4;
  return 1 - (diasDeEdad / DIAS_PARA_DESCONFIAR) * 0.6;
}

/**
 * El saldo de hoy, una fila por moneda.
 *
 * Las cajas sin saldo declarado NO se cuentan: no se sabe cuánto hay, y
 * tratarlas como cero diría que están vacías. Se avisan aparte.
 */
export function saldoDeHoy(
  cajas: Caja[],
  movimientos: MovimientoCaja[],
  hoy: string,
): SaldoMoneda[] {
  const vivas = cajas.filter((c) => c.activa);
  const monedas = [...new Set(vivas.map((c) => c.moneda))].sort();

  return monedas.map((moneda) => {
    const suyas = vivas.filter((c) => c.moneda === moneda);
    const declaradas = suyas.filter(
      (c): c is Caja & { saldo_declarado: number; saldo_declarado_el: string } =>
        c.saldo_declarado !== null && c.saldo_declarado_el !== null,
    );

    const declarado = declaradas.reduce((s, c) => s + c.saldo_declarado, 0);

    /*
     * El arrastre se calcula UNA vez por moneda, desde la fecha más vieja.
     *
     * Hacerlo por caja exigiría saber a cuál entró cada cobro, y eso el
     * sistema no lo guarda: la cuenta corriente registra que se cobró, no
     * dónde se depositó. Sumarlo una vez por caja contaría el mismo cobro
     * tantas veces como cajas haya.
     */
    const desde = declaradas
      .map((c) => c.saldo_declarado_el)
      .sort()
      .at(0);

    const arrastrado =
      desde === undefined
        ? 0
        : movimientos
            .filter((m) => m.moneda === moneda && m.fecha > desde)
            .reduce((s, m) => s + m.monto, 0);

    const edad = desde === undefined ? 0 : Math.max(0, dias(desde, hoy));

    const avisos: string[] = [];
    const sinDeclarar = suyas.length - declaradas.length;

    if (sinDeclarar > 0) {
      avisos.push(
        `${sinDeclarar} ${sinDeclarar === 1 ? "caja no tiene saldo cargado y no se contó" : "cajas no tienen saldo cargado y no se contaron"}.`,
      );
    }
    if (declaradas.length > 1) {
      // El arrastre es de la moneda, no de cada caja: quien lea el detalle
      // tiene que saber por qué no cuadra caja por caja.
      avisos.push("Los cobros y pagos se suman al total de la moneda, no a una caja en particular.");
    }
    if (edad >= DIAS_PARA_DESCONFIAR) {
      avisos.push(`El saldo más viejo tiene ${edad} días. Conviene contar de nuevo.`);
    } else if (edad >= DIAS_PARA_REVISAR) {
      avisos.push(`El saldo más viejo tiene ${edad} días.`);
    }

    return {
      moneda,
      saldo: declarado + arrastrado,
      declarado,
      arrastrado,
      cajas: declaradas.length,
      dias_del_mas_viejo: edad,
      confianza: declaradas.length === 0 ? 0 : confianzaPorEdad(edad),
      avisos,
    };
  }).filter((s) => s.cajas > 0 || s.avisos.length > 0);
}

/**
 * Los saldos en la forma que espera `proyectarCaja`.
 *
 * Solo entran las monedas donde algo se declaró: pasar un cero donde no se
 * sabe haría que el pronóstico afirme un día de quiebre que no puede saber.
 */
export function saldosParaPronostico(saldos: SaldoMoneda[]): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const s of saldos) {
    if (s.cajas > 0) salida[s.moneda] = s.saldo;
  }
  return salida;
}
