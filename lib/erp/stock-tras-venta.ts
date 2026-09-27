import { proyectarAgotamiento, type ProductoAgotable, type SalidaDeStock } from "./agotamiento.ts";

/**
 * "Se te acaba", dicho en la respuesta de la venta que lo provocó (fila D6
 * de docs/estrategia/plan-diferenciacion-2026-09-27.md).
 *
 * El aviso diario (`lib/erp/avisar-negocio.ts`) ya cuenta lo que se está
 * acabando, pero llega al día siguiente y por otro canal. Acá se dice en el
 * momento, mientras el dueño todavía está con el cliente o con el proveedor.
 *
 * SOLO CUANDO ESTA VENTA CRUZA EL UMBRAL. Si el producto ya estaba bajo el
 * mínimo, o ya le quedaban pocos días antes de esta venta, no se repite: el
 * dueño ya lo supo, y un aviso en cada venta deja de leerse. Comparar el antes
 * (stock + lo vendido) con el después hace de memoria sin tabla nueva.
 *
 * El ritmo sale de `proyectarAgotamiento`, la misma cuenta del aviso diario:
 * dos números distintos para lo mismo harían que no se le crea a ninguno.
 * Con un horizonte más corto (7 días): en el medio de una venta, solo vale
 * interrumpir por lo que es inminente.
 */

export const HORIZONTE_EN_LA_VENTA = 7;

const dias = (n: number) => (n === 1 ? "1 día" : `${n} días`);
const unidades = (n: number) => (n === 1 ? "1 unidad" : `${Number(n.toFixed(3))} unidades`);

export function avisoDeStockTrasVenta(datos: {
  hoy: string;
  productos: ProductoAgotable[];
  salidas: SalidaDeStock[];
  /** producto_id → cantidad vendida en este mensaje. */
  vendidos: Map<string, number>;
}): string {
  const frases: string[] = [];

  for (const p of datos.productos) {
    const vendido = datos.vendidos.get(p.id) ?? 0;
    if (vendido <= 0 || !p.controla_stock || !p.activo) continue;

    const antes = p.stock_actual + vendido;

    if (p.stock_actual <= 0) {
      frases.push(`Te quedaste sin “${p.nombre}”: esa era la última.`);
      continue;
    }

    if (p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo && antes > p.stock_minimo) {
      frases.push(
        `“${p.nombre}” quedó en ${unidades(p.stock_actual)}, por debajo de tu mínimo de ${p.stock_minimo}.`,
      );
      continue;
    }

    const proyectar = (stock: number) =>
      proyectarAgotamiento({
        hoy: datos.hoy,
        productos: [{ ...p, stock_actual: stock }],
        salidas: datos.salidas,
        horizonteDias: HORIZONTE_EN_LA_VENTA,
      })[0];

    const despues = proyectar(p.stock_actual);
    if (!despues || proyectar(antes)) continue;

    frases.push(
      `Al ritmo de este mes, “${p.nombre}” te dura unos ${dias(despues.dias_restantes)} (te quedan ${unidades(p.stock_actual)}).`,
    );
  }

  return frases.join(" ");
}
