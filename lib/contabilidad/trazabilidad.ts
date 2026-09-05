import { suma, cuenta, type Trazado } from "../finanzas/trazabilidad.ts";
import { sinIva } from "../erp/margen.ts";
import { monedaConocida } from "../finanzas/monedas.ts";
import { dentroDe } from "../kpi/periodo.ts";
import { VENTAS_VIVAS, type Resultado } from "./resultado.ts";
import type { Hechos, Periodo } from "../kpi/tipos.ts";

/**
 * De dónde sale cada línea del resultado del ERP.
 *
 * El mismo principio que `lib/finanzas/trazabilidad.ts` (punto 23: "el
 * usuario debe poder seleccionar cualquier total y llegar hasta los
 * movimientos que lo componen"), aplicado a `estadoDeResultados`. El panel
 * financiero ya lo tenía; esto es llevarlo a los informes y reportes del ERP.
 *
 * Igual que allá, nada se vuelve a calcular acá: cada partida sale de
 * filtrar los mismos `hechos` con el mismo criterio que `armar()` en
 * `resultado.ts`, así que si algún día ese criterio cambia y esto queda
 * viejo, `cuadra` lo delata en el acto en vez de mentir en silencio.
 */
export function trazarResultado(hechos: Hechos, periodo: Periodo, resultado: Resultado): Trazado[] {
  const { moneda } = resultado;

  const ventas = (hechos.ventas ?? []).filter(
    (v) => VENTAS_VIVAS.has(v.estado) && dentroDe(v.fecha, periodo) && monedaConocida(v.moneda) === moneda,
  );

  // Netas de IVA, línea por línea — la misma cuenta que hace `armar()`. Una
  // venta sin ítems no aporta partida: tampoco aportó al total en `armar()`.
  const partidasVentas = ventas
    .filter((v) => v.items.length > 0)
    .map((v) => ({
      fecha: v.fecha,
      descripcion: v.contacto_nombre ? `Venta — ${v.contacto_nombre}` : "Venta",
      monto: v.items.reduce((s, item) => s + sinIva(item.total, item.iva), 0),
    }));

  const movimientos = (hechos.movimientos ?? []).filter(
    (m) => m.tipo === "gasto" && dentroDe(m.fecha, periodo) && monedaConocida(m.moneda) === moneda,
  );
  const partidasGastosAnotados = movimientos.map((m) => ({
    fecha: m.fecha,
    descripcion: m.descripcion?.trim() || "Gasto",
    monto: m.monto,
  }));
  const totalGastosAnotados = partidasGastosAnotados.reduce((s, p) => s + p.monto, 0);

  // Los fijos no tienen fecha propia dentro del período: se cuentan una sola
  // vez, como aclara `armar()`. Se listan con la fecha de cierre del período
  // para que la traza tenga algo que ordenar, no porque hayan ocurrido ese día.
  const fijos = (hechos.fijos ?? []).filter(
    (f) => f.tipo === "gasto" && monedaConocida(f.moneda) === moneda,
  );
  const partidasGastosFijos = fijos.map((f) => ({
    fecha: periodo.hasta,
    descripcion: f.descripcion?.trim() || "Gasto fijo",
    monto: f.monto,
  }));
  const totalGastosFijos = partidasGastosFijos.reduce((s, p) => s + p.monto, 0);

  const nombreProducto = new Map((hechos.productos ?? []).map((p) => [p.id, p.nombre]));
  const salidas = (hechos.movimientos_stock ?? []).filter(
    (m) =>
      monedaConocida(m.moneda) === moneda &&
      m.tipo === "salida" &&
      m.costo_unitario !== null &&
      dentroDe(m.fecha, periodo),
  );
  const partidasCosto = salidas.map((m) => ({
    fecha: m.fecha,
    descripcion: nombreProducto.get(m.producto_id) ?? "Producto dado de baja",
    monto: m.cantidad * (m.costo_unitario as number),
  }));

  const trazas: Trazado[] = [
    suma("ventas_netas", "Ventas netas", resultado.ventas_netas, periodo, partidasVentas),
    suma("gastos_anotados", "Gastos anotados", totalGastosAnotados, periodo, partidasGastosAnotados),
    suma(
      "gastos_fijos",
      "Gastos fijos (contados una vez)",
      totalGastosFijos,
      periodo,
      partidasGastosFijos,
    ),
    cuenta("gastos_operativos", "Gastos operativos", resultado.gastos_operativos, [
      { etiqueta: "Gastos anotados", monto: totalGastosAnotados, signo: "+", cifra: "gastos_anotados" },
      {
        etiqueta: "Gastos fijos (contados una vez)",
        monto: totalGastosFijos,
        signo: "+",
        cifra: "gastos_fijos",
      },
    ]),
  ];

  // Sin kardex no hay costo, y sin costo no hay bruto ni operativo: `armar()`
  // ya lo deja en null. Prometer una traza para un número que no existe sería
  // peor que no ofrecerla.
  if (resultado.costo_vendido !== null) {
    trazas.push(suma("costo_vendido", "Costo de lo vendido", resultado.costo_vendido, periodo, partidasCosto));
  }

  if (resultado.resultado_bruto !== null && resultado.costo_vendido !== null) {
    trazas.push(
      cuenta("resultado_bruto", "Resultado bruto", resultado.resultado_bruto, [
        { etiqueta: "Ventas netas", monto: resultado.ventas_netas, signo: "+", cifra: "ventas_netas" },
        { etiqueta: "Costo de lo vendido", monto: resultado.costo_vendido, signo: "-", cifra: "costo_vendido" },
      ]),
    );
  }

  if (resultado.resultado_operativo !== null && resultado.resultado_bruto !== null) {
    trazas.push(
      cuenta("resultado_operativo", "Resultado operativo", resultado.resultado_operativo, [
        { etiqueta: "Resultado bruto", monto: resultado.resultado_bruto, signo: "+", cifra: "resultado_bruto" },
        {
          etiqueta: "Gastos operativos",
          monto: resultado.gastos_operativos,
          signo: "-",
          cifra: "gastos_operativos",
        },
      ]),
    );
  }

  return trazas;
}
