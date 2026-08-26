/**
 * Cada moneda es un mundo aparte.
 *
 * ============================================================
 * EL BUG QUE ESTO ARREGLA
 * ============================================================
 *
 * `eos_movimientos_financieros` guarda `moneda` desde el primer día, pero nadie
 * la leía: el panel sumaba todos los `monto` como si fueran guaraníes. Alguien
 * que cobra 500 dólares y gasta 500.000 guaraníes veía "saldo 500.500" — un
 * número que no existe en ninguna moneda del mundo, presentado con la misma
 * confianza que el resto.
 *
 * ============================================================
 * POR QUÉ NO SE CONVIERTE A UNA SOLA MONEDA
 * ============================================================
 *
 * Sería más cómodo mostrar un total único convertido a guaraníes. No se hace, y
 * es a propósito:
 *
 *  1. **La cotización no la sabe EOS.** Habría que traerla de algún lado, y el
 *     día que esa fuente falle el panel mostraría un total inventado sin avisar.
 *  2. **Convertir es una decisión del usuario, no del panel.** Quien guarda
 *     dólares no los tiene para gastarlos hoy al cambio de hoy; los tiene
 *     justamente para NO convertirlos.
 *  3. **Un total convertido no responde la pregunta.** "¿Me alcanza para pagar
 *     el alquiler?" se contesta con los guaraníes que hay, no con el
 *     equivalente en guaraníes de lo que hay en dólares.
 *
 * Entonces: una línea de tiempo por moneda, un disponible real por moneda, y
 * ningún total mezclado. Si mañana el usuario declara una cotización, se suma
 * como una vista más — no como el reemplazo de estas.
 */

export type ConMoneda = { moneda?: string | null };

/**
 * Cómo se escribe cada moneda.
 *
 * Los guaraníes no llevan decimales —nadie escribe ₲ 1.500,00— y el resto sí,
 * porque un dólar redondeado a la unidad deja de cerrar contra el extracto.
 */
export const MONEDAS: Record<string, { simbolo: string; decimales: number; nombre: string }> = {
  PYG: { simbolo: "₲", decimales: 0, nombre: "Guaraníes" },
  USD: { simbolo: "US$", decimales: 2, nombre: "Dólares" },
  BRL: { simbolo: "R$", decimales: 2, nombre: "Reales" },
  ARS: { simbolo: "AR$", decimales: 2, nombre: "Pesos argentinos" },
  EUR: { simbolo: "€", decimales: 2, nombre: "Euros" },
};

/** El código en mayúsculas, o el de referencia si no vino ninguno. */
export function codigoMoneda(valor: unknown, defecto: string): string {
  const limpio = String(valor ?? "").trim().toUpperCase();
  return limpio || defecto.toUpperCase();
}

/**
 * El código, si es una de las monedas que EOS sabe escribir; si no, guaraníes.
 *
 * Se usa al VALIDAR lo que llega del usuario o del chat. La lista corta no es
 * capricho: si entrara cualquier cadena de tres letras, el panel mostraría
 * "XYZ 1.500" sin símbolo ni decimales correctos, y una moneda escrita mal se
 * lee como un error del sistema entero.
 */
export function monedaConocida(valor: unknown, defecto = "PYG"): string {
  const codigo = codigoMoneda(valor, defecto);
  return codigo in MONEDAS ? codigo : defecto;
}

export function simboloDe(moneda: string): string {
  return MONEDAS[moneda]?.simbolo ?? moneda;
}

export function decimalesDe(moneda: string): number {
  return MONEDAS[moneda]?.decimales ?? 2;
}

export function nombreDeMoneda(moneda: string): string {
  return MONEDAS[moneda]?.nombre ?? moneda;
}

/** Las filas repartidas por moneda, con la del usuario como refugio. */
export function agruparPorMoneda<T extends ConMoneda>(
  filas: T[],
  defecto: string,
): Map<string, T[]> {
  const grupos = new Map<string, T[]>();

  for (const fila of filas) {
    const moneda = codigoMoneda(fila.moneda, defecto);
    const actual = grupos.get(moneda);

    if (actual) actual.push(fila);
    else grupos.set(moneda, [fila]);
  }

  return grupos;
}

/**
 * En qué orden se muestran.
 *
 * La principal siempre primero —es la que el usuario definió en su Constitución
 * y con la que vive— y después las demás por cuánto se mueve en cada una. Un
 * orden alfabético pondría los reales de una venta suelta arriba de los dólares
 * de los ahorros.
 */
export function ordenarMonedas(volumenes: Map<string, number>, principal: string): string[] {
  const codigos = new Set<string>([principal, ...volumenes.keys()]);

  return [...codigos].sort((a, b) => {
    if (a === principal) return -1;
    if (b === principal) return 1;
    return (volumenes.get(b) ?? 0) - (volumenes.get(a) ?? 0);
  });
}

export type CuentaDeclarada = {
  moneda?: string | null;
  saldo_declarado: number | null;
  saldo_declarado_el: string | null;
};

export type PuntoDePartida = {
  base: number;
  desde: string;
  /** De dónde salió el número, para poder decirlo en pantalla. */
  origen: "constitucion" | "cuentas" | "sin_declarar";
};

/**
 * De cuánta plata parte cada moneda, y desde qué fecha.
 *
 * La moneda principal parte del saldo de la Constitución Financiera, como
 * siempre. Las demás parten de lo que el usuario declaró en sus cuentas
 * (`eos_finanzas_cuentas` ya guarda saldo, fecha y moneda de cada una), y si no
 * declaró ninguna, de cero desde su primer movimiento — que es lo único honesto:
 * EOS solo puede afirmar lo que vio pasar.
 *
 * **La fecha de corte de una moneda con varias cuentas es la MÁS RECIENTE de
 * las declaradas.** Si una cuenta se declaró el 1 y otra el 15, aplicar los
 * movimientos desde el 1 contaría dos veces lo que la segunda ya tenía
 * incorporado. Preferimos arrancar tarde y perder movimientos viejos antes que
 * arrancar temprano y contarlos dos veces: un saldo de menos se nota y se
 * corrige, uno de más hace gastar plata que no está.
 */
export function puntosDePartida(datos: {
  principal: string;
  saldoInicial: number;
  saldoInicialFecha: string;
  cuentas: CuentaDeclarada[];
  /** Primer movimiento visto en cada moneda, para las que no tienen cuenta. */
  primerMovimiento: Map<string, string>;
  monedas: string[];
}): Map<string, PuntoDePartida> {
  const salida = new Map<string, PuntoDePartida>();
  const porMoneda = agruparPorMoneda(datos.cuentas, datos.principal);

  for (const moneda of datos.monedas) {
    if (moneda === datos.principal) {
      salida.set(moneda, {
        base: datos.saldoInicial,
        desde: datos.saldoInicialFecha,
        origen: "constitucion",
      });
      continue;
    }

    const declaradas = (porMoneda.get(moneda) ?? []).filter(
      (c) => c.saldo_declarado !== null && c.saldo_declarado_el,
    );

    if (declaradas.length > 0) {
      const desde = declaradas.reduce(
        (ultima, c) => (c.saldo_declarado_el! > ultima ? c.saldo_declarado_el! : ultima),
        declaradas[0].saldo_declarado_el!,
      );

      salida.set(moneda, {
        base: declaradas.reduce((total, c) => total + (c.saldo_declarado ?? 0), 0),
        desde,
        origen: "cuentas",
      });
      continue;
    }

    salida.set(moneda, {
      base: 0,
      desde: datos.primerMovimiento.get(moneda) ?? datos.saldoInicialFecha,
      origen: "sin_declarar",
    });
  }

  return salida;
}

/** Cuánto se movió en cada moneda, para poder ordenarlas por peso real. */
export function volumenPorMoneda(
  movimientos: (ConMoneda & { monto: number })[],
  defecto: string,
): Map<string, number> {
  const volumenes = new Map<string, number>();

  for (const m of movimientos) {
    const moneda = codigoMoneda(m.moneda, defecto);
    volumenes.set(moneda, (volumenes.get(moneda) ?? 0) + Math.abs(m.monto));
  }

  return volumenes;
}
