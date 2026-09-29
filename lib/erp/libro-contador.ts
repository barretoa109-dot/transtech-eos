/**
 * El libro para el contador (negocio-03 del tablero de lanzamiento).
 *
 * Lo que un contador de Paraguay le pide a un comercio cada mes: qué vendió,
 * qué compró, cuánto IVA cobró y cuánto pagó, y cuánta plata entró y salió.
 * Hasta hoy EOS tenía todo eso cargado pero no lo entregaba junto: la
 * exportación de la cuenta es un volcado de datos, no algo que un contador abra
 * y entienda sin explicación.
 *
 * Esta parte es pura: recibe filas ya leídas y devuelve el libro. El Excel lo
 * dibuja `libro-contador-excel.ts`.
 *
 * ============================================================
 * CÓMO SE CUENTA
 * ============================================================
 *
 *  - Los precios de EOS llevan el IVA INCLUIDO, como se usa en Paraguay. El
 *    IVA de cada tasa sale del total de esa tasa: 10 % es total / 11, 5 % es
 *    total / 21 (`ivaIncluido`, la misma cuenta que la venta).
 *  - Lo anulado no entra en los totales. Se cuenta aparte para que el
 *    contador sepa que existió.
 *  - Una compra SIN número de comprobante no da crédito fiscal: su IVA se
 *    muestra en otra columna y no se resta del débito. Es la diferencia que un
 *    contador busca primero, y la que más plata le cuesta al dueño.
 *  - Lo cobrado de un mes es lo vendido al contado ese mes más los cobros de
 *    ventas a crédito que entraron ese mes. Igual con lo pagado.
 *  - Solo guaraníes. Un documento en otra moneda se lista y se avisa, pero no
 *    se suma: sumar dólares con guaraníes da un número que no es de nadie.
 */

import { ivaIncluido, type TasaIva } from "./impuestos.ts";

export type ItemLeido = { iva: number | null; total: number | string | null };

export type DocumentoLeido = {
  id: string;
  fecha: string;
  moneda: string | null;
  condicion: string | null;
  estado: string | null;
  total: number | string | null;
  numero_comprobante?: string | null;
  contacto?: { nombre?: string | null; ruc?: string | null; ruc_dv?: number | null } | null;
  items?: ItemLeido[] | null;
};

export type MovimientoLeido = {
  fecha: string;
  monto: number | string | null;
  moneda: string | null;
  venta_id: string | null;
  compra_id: string | null;
  nota?: string | null;
};

export type FilaDocumento = {
  fecha: string;
  comprobante: string;
  contacto: string;
  ruc: string;
  condicion: string;
  total10: number;
  iva10: number;
  total5: number;
  iva5: number;
  exentas: number;
  total: number;
  /** Solo compras: tiene comprobante, así que su IVA se puede descontar. */
  daCredito: boolean;
};

export type FilaMovimiento = { fecha: string; tipo: "Cobro" | "Pago"; contacto: string; monto: number; nota: string };

export type FilaMes = {
  mes: string;
  ventas: number;
  ivaDebito: number;
  compras: number;
  ivaCredito: number;
  ivaSinComprobante: number;
  ivaAPagar: number;
  cobrado: number;
  pagado: number;
};

export type Libro = {
  desde: string;
  hasta: string;
  ventas: FilaDocumento[];
  compras: FilaDocumento[];
  movimientos: FilaMovimiento[];
  meses: FilaMes[];
  avisos: string[];
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const esGuarani = (moneda: string | null | undefined) => !moneda || moneda.toUpperCase() === "PYG";
const anulado = (d: DocumentoLeido) => (d.estado ?? "").toLowerCase().startsWith("anulad");

function ruc(c: DocumentoLeido["contacto"]): string {
  const base = (c?.ruc ?? "").trim();
  if (!base) return "";
  return c?.ruc_dv === null || c?.ruc_dv === undefined ? base : `${base}-${c.ruc_dv}`;
}

function tasa(v: number | null): TasaIva {
  return v === 10 || v === 5 ? v : 0;
}

export function filaDeDocumento(d: DocumentoLeido, esCompra: boolean): FilaDocumento {
  const porTasa = { 10: 0, 5: 0, 0: 0 } as Record<TasaIva, number>;
  const items = d.items ?? [];
  if (items.length > 0) {
    for (const it of items) porTasa[tasa(it.iva)] += Math.round(num(it.total));
  } else {
    // Sin renglones (una venta vieja o importada): todo al 10 %, que es lo más común.
    porTasa[10] = Math.round(num(d.total));
  }
  const total = porTasa[10] + porTasa[5] + porTasa[0];
  const comprobante = (d.numero_comprobante ?? "").trim();
  return {
    fecha: d.fecha,
    comprobante,
    contacto: (d.contacto?.nombre ?? "").trim() || (esCompra ? "Proveedor sin nombre" : "Consumidor final"),
    ruc: ruc(d.contacto),
    condicion: (d.condicion ?? "contado").toLowerCase() === "credito" ? "Crédito" : "Contado",
    total10: porTasa[10],
    iva10: ivaIncluido(porTasa[10], 10),
    total5: porTasa[5],
    iva5: ivaIncluido(porTasa[5], 5),
    exentas: porTasa[0],
    total,
    daCredito: esCompra ? comprobante !== "" : false,
  };
}

const mesDe = (fecha: string) => fecha.slice(0, 7);

export function armarLibro(entrada: {
  desde: string;
  hasta: string;
  ventas: DocumentoLeido[];
  compras: DocumentoLeido[];
  movimientos: MovimientoLeido[];
}): Libro {
  const avisos: string[] = [];
  const dentro = (fecha: string) => fecha >= entrada.desde && fecha <= entrada.hasta;

  const separar = (docs: DocumentoLeido[], nombre: string) => {
    const delPeriodo = docs.filter((d) => dentro(d.fecha));
    const anuladas = delPeriodo.filter(anulado).length;
    const otraMoneda = delPeriodo.filter((d) => !anulado(d) && !esGuarani(d.moneda));
    if (anuladas > 0) avisos.push(`${anuladas} ${nombre} anulada(s) en el período: no entran en los totales.`);
    if (otraMoneda.length > 0) {
      avisos.push(
        `${otraMoneda.length} ${nombre} en otra moneda (${[...new Set(otraMoneda.map((d) => d.moneda))].join(", ")}): no se suman acá; revisalas aparte.`,
      );
    }
    return delPeriodo.filter((d) => !anulado(d) && esGuarani(d.moneda)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  };

  const ventasDocs = separar(entrada.ventas, "venta(s)");
  const comprasDocs = separar(entrada.compras, "compra(s)");
  const ventas = ventasDocs.map((d) => filaDeDocumento(d, false));
  const compras = comprasDocs.map((d) => filaDeDocumento(d, true));

  const sinComprobante = compras.filter((c) => !c.daCredito && c.iva10 + c.iva5 > 0);
  if (sinComprobante.length > 0) {
    avisos.push(
      `${sinComprobante.length} compra(s) sin número de comprobante: su IVA no se descuenta. Si tenés la factura, cargá el número en Negocio > Compras.`,
    );
  }

  const nombrePorVenta = new Map(ventasDocs.map((d, i) => [d.id, ventas[i].contacto]));
  const nombrePorCompra = new Map(comprasDocs.map((d, i) => [d.id, compras[i].contacto]));
  const movimientos: FilaMovimiento[] = entrada.movimientos
    .filter((m) => dentro(m.fecha) && esGuarani(m.moneda) && (m.venta_id || m.compra_id))
    .map((m) => ({
      fecha: m.fecha,
      tipo: m.venta_id ? ("Cobro" as const) : ("Pago" as const),
      contacto: (m.venta_id ? nombrePorVenta.get(m.venta_id) : nombrePorCompra.get(m.compra_id as string)) ?? "",
      monto: Math.round(num(m.monto)),
      nota: (m.nota ?? "").trim(),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const meses = new Map<string, FilaMes>();
  const mes = (fecha: string) => {
    const clave = mesDe(fecha);
    if (!meses.has(clave)) {
      meses.set(clave, { mes: clave, ventas: 0, ivaDebito: 0, compras: 0, ivaCredito: 0, ivaSinComprobante: 0, ivaAPagar: 0, cobrado: 0, pagado: 0 });
    }
    return meses.get(clave) as FilaMes;
  };

  for (const v of ventas) {
    const m = mes(v.fecha);
    m.ventas += v.total;
    m.ivaDebito += v.iva10 + v.iva5;
    if (v.condicion === "Contado") m.cobrado += v.total;
  }
  for (const c of compras) {
    const m = mes(c.fecha);
    m.compras += c.total;
    if (c.daCredito) m.ivaCredito += c.iva10 + c.iva5;
    else m.ivaSinComprobante += c.iva10 + c.iva5;
    if (c.condicion === "Contado") m.pagado += c.total;
  }
  for (const mv of movimientos) {
    const m = mes(mv.fecha);
    if (mv.tipo === "Cobro") m.cobrado += mv.monto;
    else m.pagado += mv.monto;
  }
  for (const m of meses.values()) m.ivaAPagar = m.ivaDebito - m.ivaCredito;

  if (ventas.length === 0 && compras.length === 0) avisos.push("No hay ventas ni compras cargadas en este período.");

  return {
    desde: entrada.desde,
    hasta: entrada.hasta,
    ventas,
    compras,
    movimientos,
    meses: [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
    avisos,
  };
}
