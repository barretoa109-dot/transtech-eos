import { monedaConocida } from "../../finanzas/monedas.ts";
import { dentroDe } from "../periodo.ts";
import { valorConocido, valorDesconocido } from "../tipos.ts";
import type { CompraHecho, DefinicionKPI, Hechos, Periodo, ValorKPI } from "../tipos.ts";

/**
 * Gasto en compras y qué tan concentrado está en pocos proveedores.
 *
 * A diferencia de las ventas, acá NO se neta el IVA: `CompraHecho` guarda el
 * total de la cabecera, y una compra puede mezclar ítems al 10%, al 5% y
 * exentos — sin el detalle por ítem (que `Hechos` no modela para compras, a
 * propósito, para no duplicar toda la maquinaria de `eos_erp_compra_items`
 * por dos indicadores) no hay con qué derivar el neto. Mientras tanto, el
 * nombre dice "con IVA" en vez de mostrar un número que parece neto y no lo
 * es — el mismo criterio que ya le costó una corrección a este proyecto.
 */

function compraDelPeriodo(hechos: Hechos, periodo: Periodo): CompraHecho[] {
  return (hechos.compras ?? []).filter((c) => c.estado !== "anulada" && dentroDe(c.fecha, periodo));
}

export const GASTO_COMPRAS: DefinicionKPI = {
  id: "gasto_compras",
  nombre: "Gasto en compras (con IVA)",
  familia: "compras",
  unidad: "moneda",
  direccion: "neutro",
  necesita: ["compras"],
  calcular(hechos, periodo): ValorKPI[] {
    const compras = compraDelPeriodo(hechos, periodo);
    const monedas = new Set(compras.map((c) => monedaConocida(c.moneda)));

    return [...monedas].sort().map((moneda) =>
      valorConocido(
        moneda,
        compras.filter((c) => monedaConocida(c.moneda) === moneda).reduce((s, c) => s + c.total, 0),
      ),
    );
  },
};

export const CONCENTRACION_PROVEEDOR: DefinicionKPI = {
  id: "concentracion_proveedor",
  nombre: "Concentración del proveedor principal",
  familia: "compras",
  unidad: "porcentaje",
  direccion: "menos_es_mejor",
  necesita: ["compras"],
  umbrales: { atencion: 40, alerta: 60 },
  calcular(hechos, periodo): ValorKPI[] {
    const compras = compraDelPeriodo(hechos, periodo);
    const monedas = new Set(compras.map((c) => monedaConocida(c.moneda)));

    return [...monedas].sort().map((moneda) => {
      const deMoneda = compras.filter((c) => monedaConocida(c.moneda) === moneda);
      const total = deMoneda.reduce((s, c) => s + c.total, 0);

      const porProveedor = new Map<string, number>();
      for (const c of deMoneda) {
        const clave = c.proveedor_id ?? "sin-proveedor";
        porProveedor.set(clave, (porProveedor.get(clave) ?? 0) + c.total);
      }
      const mayor = [...porProveedor.values()].sort((a, b) => b - a)[0] ?? 0;

      return total > 0
        ? valorConocido(moneda, (mayor / total) * 100)
        : valorDesconocido(moneda, "Sin compras en el período");
    });
  },
};

export const DEFINICIONES_COMPRAS: DefinicionKPI[] = [GASTO_COMPRAS, CONCENTRACION_PROVEEDOR];
