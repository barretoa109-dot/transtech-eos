import { monedaConocida } from "../../finanzas/monedas.ts";
import { valorConocido } from "../tipos.ts";
import type { DefinicionKPI, Hechos, Periodo, ValorKPI, VentaHecho } from "../tipos.ts";

/**
 * Lo que te deben y lo que debés, hoy. Fotos del momento (`instantanea`): una
 * cuenta por cobrar no se suma dentro de un período, existe o no existe hoy.
 *
 * "Crédito" acá solo significa "todavía no cobrado/pagado" — sin
 * vencimientos ni cuotas, porque eso no existe en el modelo hoy (ver
 * `docs/erp-profesional-arquitectura.md`, brecha de cuenta corriente).
 */

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function pendientesDeCobro(hechos: Hechos): VentaHecho[] {
  return (hechos.ventas ?? []).filter((v) => v.estado !== "cobrada" && v.estado !== "anulada");
}

/**
 * `direccion: "neutro"`: tener cuentas por cobrar no es malo en sí —es
 * plata que vas a recibir—, lo que preocupa es que se demoren. Eso lo dice
 * `cobros_demorados`, no este.
 */
export const CUENTAS_POR_COBRAR: DefinicionKPI = {
  id: "cuentas_por_cobrar",
  nombre: "Cuentas por cobrar",
  familia: "cartera",
  unidad: "moneda",
  direccion: "neutro",
  necesita: ["ventas"],
  instantanea: true,
  calcular(hechos): ValorKPI[] {
    const pendientes = pendientesDeCobro(hechos);
    const monedas = new Set(pendientes.map((v) => monedaConocida(v.moneda)));

    return [...monedas].sort().map((moneda) =>
      valorConocido(
        moneda,
        pendientes.filter((v) => monedaConocida(v.moneda) === moneda).reduce((s, v) => s + v.total, 0),
      ),
    );
  },
};

/**
 * A partir de cuántos días una venta a crédito sin cobrar es una noticia.
 * El mismo plazo que `lib/erp/riesgos-negocio.ts` usa para el aviso
 * proactivo — no una segunda regla para la misma pregunta.
 */
const DIAS_DEMORA = 30;

export const COBROS_DEMORADOS: DefinicionKPI = {
  id: "cobros_demorados",
  nombre: "Cobros demorados (más de 30 días)",
  familia: "cartera",
  unidad: "moneda",
  direccion: "menos_es_mejor",
  necesita: ["ventas"],
  instantanea: true,
  calcular(hechos, periodo: Periodo): ValorKPI[] {
    const hoy = periodo.hasta;
    const demoradas = pendientesDeCobro(hechos).filter((v) => diasEntre(v.fecha, hoy) > DIAS_DEMORA);
    const monedas = new Set(demoradas.map((v) => monedaConocida(v.moneda)));

    return [...monedas].sort().map((moneda) =>
      valorConocido(
        moneda,
        demoradas.filter((v) => monedaConocida(v.moneda) === moneda).reduce((s, v) => s + v.total, 0),
      ),
    );
  },
};

export const CUENTAS_POR_PAGAR: DefinicionKPI = {
  id: "cuentas_por_pagar",
  nombre: "Cuentas por pagar",
  familia: "cartera",
  unidad: "moneda",
  direccion: "neutro",
  necesita: ["compras"],
  instantanea: true,
  calcular(hechos): ValorKPI[] {
    const pendientes = (hechos.compras ?? []).filter((c) => c.estado !== "pagada" && c.estado !== "anulada");
    const monedas = new Set(pendientes.map((c) => monedaConocida(c.moneda)));

    return [...monedas].sort().map((moneda) =>
      valorConocido(
        moneda,
        pendientes.filter((c) => monedaConocida(c.moneda) === moneda).reduce((s, c) => s + c.total, 0),
      ),
    );
  },
};

export const DEFINICIONES_CARTERA: DefinicionKPI[] = [
  CUENTAS_POR_COBRAR,
  COBROS_DEMORADOS,
  CUENTAS_POR_PAGAR,
];
