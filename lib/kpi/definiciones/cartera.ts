import { monedaConocida } from "../../finanzas/monedas.ts";
import { antiguedad, diasPromedioDeCobro, type CobroConDocumento, type DocumentoCartera } from "../../erp/cartera.ts";
import { valorConocido, valorDesconocido } from "../tipos.ts";
import type { CompraHecho, DefinicionKPI, Periodo, ValorKPI, VentaHecho } from "../tipos.ts";

/**
 * Lo que te deben y lo que debés, hoy.
 *
 * Fotos del momento (`instantanea`): una cuenta por cobrar no se suma dentro
 * de un período, existe o no existe hoy.
 *
 * Desde la v107 el saldo sale de `total - cobrado` y no del estado: una venta
 * con la mitad abonada sigue en 'emitida', y contarla entera como pendiente
 * inflaría la cartera justo en los negocios que más usan el crédito.
 *
 * Toda la aritmética de tramos y demoras vive en `lib/erp/cartera.ts`, que la
 * comparte con `GET /api/erp/cartera`. Dos implementaciones del mismo estado
 * de cuenta terminarían dando dos números distintos.
 */

/** Un documento de cualquiera de los dos lados, en la forma que espera cartera.ts. */
function comoDocumento(d: VentaHecho | CompraHecho): DocumentoCartera {
  const esVenta = "items" in d;
  return {
    id: d.id,
    fecha: d.fecha,
    vence_el: d.vence_el,
    moneda: monedaConocida(d.moneda),
    total: d.total,
    cobrado: d.cobrado,
    contacto_id: esVenta ? (d as VentaHecho).contacto_id : (d as CompraHecho).proveedor_id,
    contacto_nombre: esVenta ? (d as VentaHecho).contacto_nombre : (d as CompraHecho).proveedor_nombre,
  };
}

function vivos(documentos: (VentaHecho | CompraHecho)[]): DocumentoCartera[] {
  return documentos.filter((d) => d.estado !== "anulada").map(comoDocumento);
}

function porMoneda(
  documentos: DocumentoCartera[],
  hoy: string,
  tomar: (a: ReturnType<typeof antiguedad>) => number,
): ValorKPI[] {
  const monedas = new Set(documentos.map((d) => d.moneda));
  return [...monedas].sort().map((moneda) => valorConocido(moneda, tomar(antiguedad(documentos, moneda, hoy))));
}

export const CUENTAS_POR_COBRAR: DefinicionKPI = {
  id: "cuentas_por_cobrar",
  nombre: "Cuentas por cobrar",
  familia: "cartera",
  unidad: "moneda",
  // Tener cuentas por cobrar no es malo en sí: es plata que vas a recibir. Lo
  // que preocupa es que se demoren, y eso lo dice `cartera_vencida`.
  direccion: "neutro",
  necesita: ["ventas"],
  instantanea: true,
  calcular: (hechos, periodo: Periodo) =>
    porMoneda(vivos(hechos.ventas ?? []), periodo.hasta, (a) => a.total),
};

export const CARTERA_VENCIDA: DefinicionKPI = {
  id: "cartera_vencida",
  nombre: "Cartera vencida",
  familia: "cartera",
  unidad: "moneda",
  direccion: "menos_es_mejor",
  necesita: ["ventas"],
  instantanea: true,
  calcular: (hechos, periodo: Periodo) =>
    porMoneda(vivos(hechos.ventas ?? []), periodo.hasta, (a) => a.vencido),
};

export const CUENTAS_POR_PAGAR: DefinicionKPI = {
  id: "cuentas_por_pagar",
  nombre: "Cuentas por pagar",
  familia: "cartera",
  unidad: "moneda",
  direccion: "neutro",
  necesita: ["compras"],
  instantanea: true,
  calcular: (hechos, periodo: Periodo) =>
    porMoneda(vivos(hechos.compras ?? []), periodo.hasta, (a) => a.total),
};

/**
 * Los cobros del período, cruzados con la fecha de su documento.
 *
 * `Hechos` no trae la tabla de cobranzas —sería un quinto insumo para dos
 * indicadores— así que el DSO se aproxima con los documentos ya saldados: la
 * fecha del documento contra la de su último movimiento conocido. Es menos
 * exacto que leer cada cobro y es honesto decirlo; cuando el volumen lo
 * justifique, `Hechos` puede crecer.
 */
function cobrosAproximados(documentos: DocumentoCartera[], hoy: string): CobroConDocumento[] {
  return documentos
    .filter((d) => d.cobrado > 0)
    .map((d) => ({
      fechaDocumento: d.fecha,
      // Sin la fecha del cobro se usa hoy, lo que SUBESTIMA la demora de los
      // documentos viejos ya cobrados. Se prefiere subestimar antes que
      // inventar una fecha intermedia.
      fechaCobro: hoy,
      monto: d.cobrado,
      moneda: d.moneda,
    }));
}

export const DIAS_DE_COBRO: DefinicionKPI = {
  id: "dias_de_cobro",
  nombre: "Días promedio de cobro",
  familia: "cartera",
  unidad: "dias",
  direccion: "menos_es_mejor",
  necesita: ["ventas"],
  instantanea: true,
  calcular(hechos, periodo: Periodo): ValorKPI[] {
    const documentos = vivos(hechos.ventas ?? []);
    const cobros = cobrosAproximados(documentos, periodo.hasta);
    const monedas = new Set(documentos.map((d) => d.moneda));

    return [...monedas].sort().map((moneda) => {
      const dias = diasPromedioDeCobro(cobros, moneda);
      return dias === null
        ? valorDesconocido(moneda, "Todavía no se cobró ninguna venta a crédito")
        : valorConocido(moneda, dias);
    });
  },
};

export const DIAS_DE_PAGO: DefinicionKPI = {
  id: "dias_de_pago",
  nombre: "Días promedio de pago",
  familia: "cartera",
  unidad: "dias",
  // Pagar más tarde financia al negocio, pero pagar tardísimo quema al
  // proveedor. Sin un plazo pactado con el cual comparar, EOS no puede decir
  // cuál de las dos cosas está pasando, así que no se alarma solo.
  direccion: "neutro",
  necesita: ["compras"],
  instantanea: true,
  calcular(hechos, periodo: Periodo): ValorKPI[] {
    const documentos = vivos(hechos.compras ?? []);
    const pagos = cobrosAproximados(documentos, periodo.hasta);
    const monedas = new Set(documentos.map((d) => d.moneda));

    return [...monedas].sort().map((moneda) => {
      const dias = diasPromedioDeCobro(pagos, moneda);
      return dias === null
        ? valorDesconocido(moneda, "Todavía no se pagó ninguna compra a crédito")
        : valorConocido(moneda, dias);
    });
  },
};

export const DEFINICIONES_CARTERA: DefinicionKPI[] = [
  CUENTAS_POR_COBRAR,
  CARTERA_VENCIDA,
  CUENTAS_POR_PAGAR,
  DIAS_DE_COBRO,
  DIAS_DE_PAGO,
];
