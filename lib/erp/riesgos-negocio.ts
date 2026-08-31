import { monedaConocida } from "../finanzas/monedas.ts";

/**
 * Los riesgos que no son de la caja, sino del negocio.
 *
 * ============================================================
 * QUÉ FALTABA
 * ============================================================
 *
 * `lib/finanzas/riesgo.ts` encuentra el día en que la plata no alcanza. Es la
 * mitad del punto 20 de la lista: quedaban inventario bajo y cobros pendientes,
 * que son los dos avisos que un comercio necesita y que hoy nadie le da.
 *
 * Quedarse sin el producto que más sale es una venta perdida que no aparece en
 * ningún reporte, porque la venta que no se hizo no deja rastro. Y una venta a
 * crédito que lleva dos meses sin cobrarse es plata que el usuario ya cuenta
 * como suya y que cada día se parece más a una pérdida.
 *
 * ============================================================
 * LA CLAVE ES LO QUE EVITA EL RUIDO
 * ============================================================
 *
 * El detector encuentra el MISMO problema todos los días hasta que se resuelve.
 * Mandarlo cinco veces es exactamente lo que entrena a ignorar los avisos.
 *
 * `lib/finanzas/avisos.ts` resuelve eso para el faltante comparando fecha y
 * monto. Acá la regla es más simple y más exacta: cada riesgo trae una CLAVE
 * armada con los ids de lo que lo compone. Si la clave no cambió, es el mismo
 * problema y no se vuelve a avisar. Si entró un producto nuevo a la lista de
 * faltantes, la clave cambia y eso sí es una noticia.
 *
 * ============================================================
 * LO QUE NO ESTÁ, Y POR QUÉ
 * ============================================================
 *
 * El punto 20 también pide "gastos anormales". No está, a propósito. Detectarlo
 * bien exige saber qué es normal para ESTE usuario, y con pocos meses de
 * historial cualquier regla razonable —el doble de la mediana, tres desvíos—
 * marca como anormal la compra anual del seguro. El mismo punto pide "sin
 * enviar alarmas falsas", así que un detector que todavía no puede distinguir
 * las dos cosas no se enciende.
 */

export type ProductoStock = {
  id: string;
  nombre: string;
  stock_actual: number;
  stock_minimo: number;
  controla_stock: boolean;
  activo: boolean;
};

export type VentaACobrar = {
  id: string;
  fecha: string;
  total: number;
  moneda: string | null;
};

export type RiesgoNegocio =
  | {
      tipo: "inventario_bajo";
      /** Los mismos productos dan la misma clave: eso frena la repetición. */
      clave: string;
      productos: { nombre: string; stock: number; minimo: number }[];
    }
  | {
      tipo: "cobros_demorados";
      clave: string;
      moneda: string;
      total: number;
      cantidad: number;
      /** Días de la más vieja. Es lo que vuelve urgente al aviso. */
      dias_de_la_mas_vieja: number;
    };

/**
 * A partir de cuántos días una venta a crédito sin cobrar es una noticia.
 *
 * Treinta, que es el plazo comercial habitual en Paraguay. No sale de una
 * fecha de vencimiento porque todavía no existe: la cuenta corriente con
 * vencimientos es la fase 5 del ERP. Hasta entonces, el aviso dice
 * exactamente lo que sabe —"hace más de treinta días"— y no inventa una mora
 * que nadie pactó.
 */
const DIAS_DEMORA = 30;

/** Cuántos productos se nombran. Una lista de cuarenta no se lee. */
const MAX_PRODUCTOS = 5;

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function detectarRiesgosNegocio(datos: {
  hoy: string;
  productos: ProductoStock[];
  ventasACobrar: VentaACobrar[];
  diasDemora?: number;
}): RiesgoNegocio[] {
  const riesgos: RiesgoNegocio[] = [];

  // ---------- Inventario bajo ----------
  //
  // Solo lo que lleva stock y está activo. Un servicio no puede faltar, y un
  // producto dado de baja no interesa aunque su saldo diga cero.
  const faltantes = datos.productos
    .filter((p) => p.controla_stock && p.activo && p.stock_actual <= p.stock_minimo)
    .sort((a, b) => a.stock_actual - b.stock_actual || a.id.localeCompare(b.id));

  if (faltantes.length > 0) {
    riesgos.push({
      tipo: "inventario_bajo",
      // Los ids ordenados: la misma lista da la misma clave, y agregar uno la
      // cambia. Va la lista COMPLETA aunque solo se nombren cinco, para que un
      // producto nuevo en el puesto veinte también cuente como noticia.
      clave: faltantes
        .map((p) => p.id)
        .sort()
        .join(","),
      productos: faltantes.slice(0, MAX_PRODUCTOS).map((p) => ({
        nombre: p.nombre,
        stock: p.stock_actual,
        minimo: p.stock_minimo,
      })),
    });
  }

  // ---------- Cobros demorados ----------
  //
  // Por moneda y sin convertir, como todo lo demás: sumar guaraníes con
  // dólares daría un total que no existe en ninguna de las dos.
  const limite = datos.diasDemora ?? DIAS_DEMORA;
  const demoradas = datos.ventasACobrar.filter((v) => diasEntre(v.fecha, datos.hoy) >= limite);

  const porMoneda = new Map<string, VentaACobrar[]>();
  for (const venta of demoradas) {
    const moneda = monedaConocida(venta.moneda);
    if (!porMoneda.has(moneda)) porMoneda.set(moneda, []);
    porMoneda.get(moneda)!.push(venta);
  }

  for (const [moneda, ventas] of [...porMoneda.entries()].sort()) {
    riesgos.push({
      tipo: "cobros_demorados",
      clave: `${moneda}:${ventas
        .map((v) => v.id)
        .sort()
        .join(",")}`,
      moneda,
      total: ventas.reduce((t, v) => t + Number(v.total ?? 0), 0),
      cantidad: ventas.length,
      dias_de_la_mas_vieja: Math.max(...ventas.map((v) => diasEntre(v.fecha, datos.hoy))),
    });
  }

  return riesgos;
}

/** El texto del aviso. Concreto: sin el nombre y el número no sirve para nada. */
export function redactarRiesgoNegocio(
  riesgo: RiesgoNegocio,
  formatear: (monto: number, moneda: string) => string,
): string {
  if (riesgo.tipo === "inventario_bajo") {
    const lista = riesgo.productos
      .map((p) => `${p.nombre} (${p.stock} de ${p.minimo})`)
      .join(", ");

    return riesgo.productos.length === 1
      ? `Te estás quedando sin ${lista}.`
      : `Te estás quedando sin: ${lista}.`;
  }

  const cuantas =
    riesgo.cantidad === 1 ? "Una venta a crédito lleva" : `${riesgo.cantidad} ventas a crédito llevan`;

  return (
    `${cuantas} más de 30 días sin cobrarse, por ${formatear(riesgo.total, riesgo.moneda)}. ` +
    `La más vieja, ${riesgo.dias_de_la_mas_vieja} días.`
  );
}
