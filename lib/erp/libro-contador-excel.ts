import ExcelJS from "exceljs";

import type { FilaDocumento, Libro } from "./libro-contador.ts";

/**
 * El libro del contador en Excel: una hoja por cosa, números como números.
 *
 * Un contador va a sumar, filtrar y copiar estas columnas a su sistema, así
 * que cada importe es un número con formato de guaraníes (nunca texto con
 * "Gs."), cada fecha es una fecha, y la primera fila de cada hoja queda fija.
 * Los avisos van arriba del resumen: una hoja de notas aparte nadie la abre.
 */

const AZUL = "FF1656BD";
const AZUL_OSCURO = "FF113F8C";
const GRIS = "FF6B7280";
const GS = '"₲" #,##0;[Red]-"₲" #,##0';

function aFecha(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function nombreDelMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const nombre = new Intl.DateTimeFormat("es-PY", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, 1)));
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${a}`;
}

function encabezado(hoja: ExcelJS.Worksheet, columnas: { titulo: string; ancho: number }[]) {
  hoja.columns = columnas.map((c) => ({ width: c.ancho }));
  const r = hoja.getRow(1);
  columnas.forEach((c, i) => {
    const celda = r.getCell(i + 1);
    celda.value = c.titulo;
    celda.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    celda.alignment = { vertical: "middle", wrapText: true };
  });
  r.height = 30;
  hoja.views = [{ state: "frozen", ySplit: 1 }];
}

function totales(hoja: ExcelJS.Worksheet, fila: number, desde: number, hasta: number, columnas: number[]) {
  const r = hoja.getRow(fila);
  r.getCell(1).value = "Total";
  r.getCell(1).font = { bold: true };
  for (const c of columnas) {
    const letra = hoja.getColumn(c).letter;
    const celda = r.getCell(c);
    celda.value = hasta >= desde ? { formula: `SUM(${letra}${desde}:${letra}${hasta})` } : 0;
    celda.numFmt = GS;
    celda.font = { bold: true };
  }
}

function hojaDeDocumentos(libro: ExcelJS.Workbook, nombre: string, filas: FilaDocumento[], esCompra: boolean) {
  const hoja = libro.addWorksheet(nombre);
  const columnas = [
    { titulo: "Fecha", ancho: 12 },
    { titulo: "Comprobante", ancho: 18 },
    { titulo: esCompra ? "Proveedor" : "Cliente", ancho: 30 },
    { titulo: "RUC", ancho: 14 },
    { titulo: "Condición", ancho: 11 },
    { titulo: "Gravado 10 % (IVA incl.)", ancho: 16 },
    { titulo: "IVA 10 %", ancho: 13 },
    { titulo: "Gravado 5 % (IVA incl.)", ancho: 16 },
    { titulo: "IVA 5 %", ancho: 13 },
    { titulo: "Exentas", ancho: 13 },
    { titulo: "Total", ancho: 15 },
  ];
  if (esCompra) columnas.push({ titulo: "¿Da crédito fiscal?", ancho: 14 });
  encabezado(hoja, columnas);

  filas.forEach((f, i) => {
    const r = hoja.getRow(i + 2);
    r.getCell(1).value = aFecha(f.fecha);
    r.getCell(1).numFmt = "dd/mm/yyyy";
    r.getCell(2).value = f.comprobante || "—";
    r.getCell(3).value = f.contacto;
    r.getCell(4).value = f.ruc;
    r.getCell(5).value = f.condicion;
    [f.total10, f.iva10, f.total5, f.iva5, f.exentas, f.total].forEach((v, j) => {
      r.getCell(6 + j).value = v;
      r.getCell(6 + j).numFmt = GS;
    });
    if (esCompra) r.getCell(12).value = f.daCredito ? "Sí" : "No: falta el comprobante";
  });

  totales(hoja, filas.length + 2, 2, filas.length + 1, [6, 7, 8, 9, 10, 11]);
}

export async function crearExcelContador(libro: Libro, negocio: string): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TransTech EOS";
  wb.created = new Date();

  // ---------- Resumen ----------
  const resumen = wb.addWorksheet("Resumen");
  resumen.columns = [
    { width: 18 },
    { width: 15 },
    { width: 14 },
    { width: 15 },
    { width: 14 },
    { width: 17 },
    { width: 14 },
    { width: 15 },
    { width: 15 },
  ];
  resumen.mergeCells("A1:I1");
  resumen.getCell("A1").value = `Libro para el contador · ${negocio}`;
  resumen.getCell("A1").font = { name: "Calibri", size: 16, bold: true, color: { argb: AZUL_OSCURO } };
  resumen.mergeCells("A2:I2");
  resumen.getCell("A2").value = `Del ${libro.desde.split("-").reverse().join("/")} al ${libro.hasta
    .split("-")
    .reverse()
    .join("/")} · importes en guaraníes, con IVA incluido · generado por EOS`;
  resumen.getCell("A2").font = { name: "Calibri", size: 10, color: { argb: GRIS } };

  let fila = 4;
  if (libro.avisos.length > 0) {
    resumen.getCell(`A${fila}`).value = "Para revisar antes de declarar";
    resumen.getCell(`A${fila}`).font = { bold: true, color: { argb: AZUL_OSCURO } };
    fila += 1;
    for (const aviso of libro.avisos) {
      resumen.mergeCells(`A${fila}:I${fila}`);
      resumen.getCell(`A${fila}`).value = `• ${aviso}`;
      resumen.getCell(`A${fila}`).alignment = { wrapText: true, vertical: "top" };
      resumen.getCell(`A${fila}`).font = { size: 10, color: { argb: GRIS } };
      resumen.getRow(fila).height = 28;
      fila += 1;
    }
    fila += 1;
  }

  const titulos = [
    "Mes",
    "Ventas",
    "IVA débito",
    "Compras",
    "IVA crédito",
    "IVA de compras sin comprobante",
    "IVA a pagar",
    "Cobrado",
    "Pagado",
  ];
  const cab = resumen.getRow(fila);
  titulos.forEach((t, i) => {
    const c = cab.getCell(i + 1);
    c.value = t;
    c.font = { size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    c.alignment = { wrapText: true, vertical: "middle" };
  });
  cab.height = 30;
  const primera = fila + 1;
  for (const m of libro.meses) {
    fila += 1;
    const r = resumen.getRow(fila);
    r.getCell(1).value = nombreDelMes(m.mes);
    [m.ventas, m.ivaDebito, m.compras, m.ivaCredito, m.ivaSinComprobante, m.ivaAPagar, m.cobrado, m.pagado].forEach(
      (v, j) => {
        r.getCell(2 + j).value = v;
        r.getCell(2 + j).numFmt = GS;
      },
    );
  }
  if (libro.meses.length > 1) totales(resumen, fila + 1, primera, fila, [2, 3, 4, 5, 6, 7, 8, 9]);

  hojaDeDocumentos(wb, "Ventas", libro.ventas, false);
  hojaDeDocumentos(wb, "Compras", libro.compras, true);

  // ---------- Cobros y pagos ----------
  const mov = wb.addWorksheet("Cobros y pagos a crédito");
  encabezado(mov, [
    { titulo: "Fecha", ancho: 12 },
    { titulo: "Tipo", ancho: 10 },
    { titulo: "Cliente o proveedor", ancho: 30 },
    { titulo: "Monto", ancho: 15 },
    { titulo: "Nota", ancho: 40 },
  ]);
  libro.movimientos.forEach((m, i) => {
    const r = mov.getRow(i + 2);
    r.getCell(1).value = aFecha(m.fecha);
    r.getCell(1).numFmt = "dd/mm/yyyy";
    r.getCell(2).value = m.tipo;
    r.getCell(3).value = m.contacto;
    r.getCell(4).value = m.monto;
    r.getCell(4).numFmt = GS;
    r.getCell(5).value = m.nota;
  });

  return wb.xlsx.writeBuffer();
}
