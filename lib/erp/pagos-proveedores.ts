/**
 * Lo que hay que pagarle a los proveedores: lo vencido y lo que vence pronto.
 *
 * ============================================================
 * POR QUÉ ES DISTINTO DE "COBROS DEMORADOS"
 * ============================================================
 *
 * Un cobro atrasado es plata que te deben: cuanto más tarde, peor, y no hay
 * fecha que perder. Un pago a un proveedor es plata que DEBÉS, y lo que
 * importa es enterarse ANTES: pagar tarde cuesta mora, cortes de crédito o
 * mercadería que deja de llegar. Por eso acá hay dos listas —vencido y por
 * vencer— y en cobros solo una.
 *
 * ============================================================
 * CERO INVENCIÓN
 * ============================================================
 *
 *   · Solo cuenta lo que tiene `vence_el`. Una compra a crédito sin fecha no
 *     tiene un plazo que se pueda incumplir, y el respaldo de "30 días desde la
 *     compra" que usan los cobros sería inventarle al proveedor condiciones que
 *     nadie pactó. Sin fecha, no hay aviso.
 *
 *   · Se avisa por el SALDO, no por el total: si ya se pagó una parte, decir el
 *     total infla la deuda. Lo pagado sale de la cuenta corriente (v107).
 *
 *   · Por moneda y sin convertir, como todo lo demás: sumar guaraníes con
 *     dólares daría un total que no existe en ninguna de las dos.
 *
 * Pura: no lee la base ni el reloj.
 */

export type CompraAPagar = {
  id: string;
  /** Total de la compra. */
  total: number;
  /** Lo ya pagado (suma de la cuenta corriente). Puede ser 0. */
  pagado: number;
  moneda: string | null;
  vence_el: string | null;
};

export type PagosPorMoneda = {
  moneda: string;
  vencidos: { cantidad: number; total: number; dias_de_la_mas_vieja: number };
  por_vencer: { cantidad: number; total: number; dias_hasta_el_primero: number; primer_vencimiento: string };
  /** Los ids de todo lo que compone el aviso, ordenados: la clave que evita repetirlo. */
  ids: string[];
};

/** Con cuántos días de anticipación se avisa. Una semana: lo que tarda en juntarse una transferencia. */
export const DIAS_POR_VENCER = 7;

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

export function saldoDeCompra(c: Pick<CompraAPagar, "total" | "pagado">): number {
  const total = Number(c.total);
  const pagado = Number(c.pagado);
  if (!Number.isFinite(total)) return 0;
  return Math.max(0, total - (Number.isFinite(pagado) ? pagado : 0));
}

export function pagosAProveedores(
  hoy: string,
  compras: CompraAPagar[],
  moneda: (m: string | null) => string = (m) => m ?? "PYG",
  horizonte: number = DIAS_POR_VENCER,
): PagosPorMoneda[] {
  const porMoneda = new Map<string, PagosPorMoneda>();

  for (const c of compras) {
    // Sin fecha pactada no hay plazo que se pueda incumplir.
    if (!c.vence_el || !/^\d{4}-\d{2}-\d{2}$/.test(c.vence_el)) continue;

    const saldo = saldoDeCompra(c);
    if (saldo <= 0) continue;

    const dias = diasEntre(c.vence_el, hoy); // > 0: ya venció; <= 0: faltan -dias
    if (dias <= 0 && -dias > horizonte) continue;

    const m = moneda(c.moneda);
    const grupo =
      porMoneda.get(m) ??
      ({
        moneda: m,
        vencidos: { cantidad: 0, total: 0, dias_de_la_mas_vieja: 0 },
        por_vencer: { cantidad: 0, total: 0, dias_hasta_el_primero: Number.POSITIVE_INFINITY, primer_vencimiento: "" },
        ids: [],
      } satisfies PagosPorMoneda);

    if (dias > 0) {
      grupo.vencidos.cantidad += 1;
      grupo.vencidos.total += saldo;
      grupo.vencidos.dias_de_la_mas_vieja = Math.max(grupo.vencidos.dias_de_la_mas_vieja, dias);
    } else {
      const faltan = Math.max(0, -dias); // Math.max evita el -0 cuando vence hoy
      grupo.por_vencer.cantidad += 1;
      grupo.por_vencer.total += saldo;
      if (faltan < grupo.por_vencer.dias_hasta_el_primero) {
        grupo.por_vencer.dias_hasta_el_primero = faltan;
        grupo.por_vencer.primer_vencimiento = c.vence_el;
      }
    }

    grupo.ids.push(c.id);
    porMoneda.set(m, grupo);
  }

  return [...porMoneda.values()]
    .map((g) => ({
      ...g,
      ids: [...g.ids].sort(),
      por_vencer:
        g.por_vencer.cantidad === 0 ? { ...g.por_vencer, dias_hasta_el_primero: 0 } : g.por_vencer,
    }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda));
}

/** "22/09" — sin el año: el aviso habla de esta semana. */
function diaMes(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** El texto del aviso. Concreto: sin el monto y la fecha no sirve para decidir a quién pagar primero. */
export function redactarPagos(g: PagosPorMoneda, formatear: (monto: number, moneda: string) => string): string {
  const partes: string[] = [];

  if (g.vencidos.cantidad > 0) {
    const cuantos =
      g.vencidos.cantidad === 1 ? "Tenés 1 pago a un proveedor vencido" : `Tenés ${g.vencidos.cantidad} pagos a proveedores vencidos`;
    const dias = g.vencidos.dias_de_la_mas_vieja;
    partes.push(
      `${cuantos}, por ${formatear(g.vencidos.total, g.moneda)}; ` +
        `el más viejo lleva ${dias === 1 ? "1 día" : `${dias} días`} de atraso.`,
    );
  }

  if (g.por_vencer.cantidad > 0) {
    const cuantos =
      g.por_vencer.cantidad === 1
        ? "1 pago vence"
        : `${g.por_vencer.cantidad} pagos vencen`;
    const cuando =
      g.por_vencer.dias_hasta_el_primero === 0
        ? "hoy"
        : `el ${diaMes(g.por_vencer.primer_vencimiento)}`;
    const inicio = g.vencidos.cantidad > 0 ? "Además, " : "";

    partes.push(
      `${inicio}${inicio ? cuantos : cuantos.charAt(0).toUpperCase() + cuantos.slice(1)} en los próximos ${DIAS_POR_VENCER} días, ` +
        `por ${formatear(g.por_vencer.total, g.moneda)}; el primero, ${cuando}.`,
    );
  }

  return partes.join(" ");
}
