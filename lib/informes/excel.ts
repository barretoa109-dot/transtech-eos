import ExcelJS from "exceljs";

import type { Informe } from "./armar.ts";

/**
 * El informe, en Excel.
 *
 * A diferencia de la plantilla de `app/descargar`, esto NO es un formulario
 * para llenar: son los datos del usuario, ya cargados. La diferencia práctica
 * es que acá los números van como números —con formato de moneda de Excel, no
 * como texto— para que el que abre el archivo pueda sumar, filtrar y armar su
 * propia tabla dinámica encima. Un balance que llega como texto obliga a
 * retipearlo, y entonces no sirvió de nada.
 *
 * Las hojas siguen el orden en que se miran: primero el resumen, después el
 * detalle. Quien quiera solo el número lo tiene en la primera pantalla.
 */

const AZUL = "FF1656BD";
const AZUL_OSCURO = "FF113F8C";
const GRIS = "FF6B7280";
const LINEA = "FFE5E7EB";
const VERDE = "FF10A37F";
const ROJO = "FFDC2626";

function formatoMoneda(moneda: string): string {
  // El símbolo va dentro del formato de celda, así el valor sigue siendo un
  // número y Excel lo puede sumar.
  const simbolo = moneda === "USD" ? '"US$" ' : '"₲" ';
  return `${simbolo}#,##0;[Red]-${simbolo}#,##0`;
}

function titulo(hoja: ExcelJS.Worksheet, informe: Informe) {
  hoja.mergeCells("A1:D1");
  const t = hoja.getCell("A1");
  t.value = informe.titulo;
  t.font = { name: "Calibri", size: 18, bold: true, color: { argb: AZUL_OSCURO } };
  t.alignment = { vertical: "middle" };
  hoja.getRow(1).height = 26;

  hoja.mergeCells("A2:D2");
  const s = hoja.getCell("A2");
  s.value = `${informe.periodo.etiqueta} · generado el ${informe.generadoEl}`;
  s.font = { name: "Calibri", size: 10, color: { argb: GRIS } };
}

function encabezados(hoja: ExcelJS.Worksheet, fila: number, columnas: string[]) {
  const r = hoja.getRow(fila);
  columnas.forEach((texto, i) => {
    const c = r.getCell(i + 1);
    c.value = texto;
    c.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    c.alignment = { vertical: "middle" };
    c.border = { bottom: { style: "thin", color: { argb: LINEA } } };
  });
  r.height = 20;
}

export async function crearExcelInforme(informe: Informe): Promise<ExcelJS.Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "TransTech EOS";
  libro.created = new Date();

  const dinero = formatoMoneda(informe.moneda);

  // ---------- Resumen ----------
  const resumen = libro.addWorksheet("Resumen");
  resumen.columns = [{ width: 34 }, { width: 20 }, { width: 16 }, { width: 46 }];
  titulo(resumen, informe);

  let fila = 4;
  const linea = (etiqueta: string, valor: number, color?: string) => {
    const r = resumen.getRow(fila);
    r.getCell(1).value = etiqueta;
    r.getCell(1).font = { name: "Calibri", size: 11 };
    const v = r.getCell(2);
    v.value = valor;
    v.numFmt = dinero;
    v.font = { name: "Calibri", size: 11, bold: true, color: color ? { argb: color } : undefined };
    fila += 1;
  };

  linea("Ingresos del período", informe.resumen.ingresos, VERDE);
  linea("Gastos del período", informe.resumen.gastos, ROJO);
  linea(
    "Resultado (ingresos - gastos)",
    informe.resumen.neto,
    informe.resumen.neto >= 0 ? VERDE : ROJO,
  );

  if (informe.resumen.comprometido > 0) {
    linea("Compromisos con fecha en el período", informe.resumen.comprometido);
    resumen.getCell(`C${fila - 1}`).value = "no restado del resultado";
    resumen.getCell(`C${fila - 1}`).font = { name: "Calibri", size: 9, italic: true, color: { argb: GRIS } };
  }

  fila += 1;
  const cant = resumen.getRow(fila);
  cant.getCell(1).value = "Movimientos considerados";
  cant.getCell(2).value = informe.resumen.movimientos;
  cant.getCell(2).font = { name: "Calibri", size: 11, bold: true };
  fila += 2;

  // Las advertencias van en la MISMA hoja que el resumen, no en una aparte:
  // una hoja "Notas" que hay que ir a buscar es una hoja que nadie abre.
  if (informe.advertencias.length > 0) {
    const cab = resumen.getRow(fila);
    cab.getCell(1).value = "Lo que este informe no incluye";
    cab.getCell(1).font = { name: "Calibri", size: 11, bold: true, color: { argb: AZUL_OSCURO } };
    fila += 1;

    for (const aviso of informe.advertencias) {
      const r = resumen.getRow(fila);
      resumen.mergeCells(`A${fila}:D${fila}`);
      r.getCell(1).value = `• ${aviso}`;
      r.getCell(1).font = { name: "Calibri", size: 10, color: { argb: GRIS } };
      r.getCell(1).alignment = { wrapText: true, vertical: "top" };
      r.height = 28;
      fila += 1;
    }
  }

  // ---------- Por destino ----------
  if (informe.destinos.length > 0) {
    const hoja = libro.addWorksheet("Por destino");
    hoja.columns = [{ width: 26 }, { width: 20 }, { width: 12 }, { width: 14 }];
    titulo(hoja, informe);
    encabezados(hoja, 4, ["Destino", "Total", "% del total", "Movimientos"]);

    informe.destinos.forEach((d, i) => {
      const r = hoja.getRow(5 + i);
      r.getCell(1).value = d.etiqueta;
      r.getCell(2).value = d.total;
      r.getCell(2).numFmt = dinero;
      r.getCell(3).value = d.porcentaje / 100;
      r.getCell(3).numFmt = "0.0%";
      r.getCell(4).value = d.cantidad;
    });

    const total = hoja.getRow(5 + informe.destinos.length);
    total.getCell(1).value = "Total";
    total.getCell(1).font = { name: "Calibri", bold: true };
    total.getCell(2).value = { formula: `SUM(B5:B${4 + informe.destinos.length})` };
    total.getCell(2).numFmt = dinero;
    total.getCell(2).font = { name: "Calibri", bold: true };
  }

  // ---------- Movimientos ----------
  const detalle = libro.addWorksheet("Movimientos");
  detalle.columns = [{ width: 13 }, { width: 13 }, { width: 42 }, { width: 18 }, { width: 20 }];
  titulo(detalle, informe);

  /*
   * Los compromisos van en SU PROPIA columna, no en "Monto".
   *
   * Si se mezclaran, seleccionar la columna Monto y mirar la suma daría el
   * resultado del período menos los compromisos — un número que no coincide
   * con el que el Resumen llama "Resultado", en el mismo archivo. Un balance
   * que se contradice consigo mismo a dos hojas de distancia es peor que uno
   * incompleto: obliga a desconfiar de las dos cifras.
   */
  encabezados(detalle, 4, ["Fecha", "Tipo", "Descripción", "Monto", "Comprometido"]);

  informe.movimientos.forEach((m, i) => {
    const r = detalle.getRow(5 + i);
    r.getCell(1).value = m.fecha;
    r.getCell(2).value = m.tipo;
    r.getCell(3).value = m.descripcion ?? "(sin descripción)";

    if (m.tipo === "compromiso") {
      const c = r.getCell(5);
      c.value = m.monto;
      c.numFmt = dinero;
      c.font = { name: "Calibri", size: 11, color: { argb: GRIS } };
    } else {
      const v = r.getCell(4);
      // El gasto va en negativo para que la columna se pueda sumar de una y
      // dar exactamente el "Resultado" de la hoja Resumen.
      v.value = m.tipo === "ingreso" ? m.monto : -m.monto;
      v.numFmt = dinero;
    }
  });

  if (informe.movimientos.length > 0) {
    const ultima = 4 + informe.movimientos.length;

    const total = detalle.getRow(ultima + 1);
    total.getCell(3).value = "Resultado del período";
    total.getCell(3).font = { name: "Calibri", size: 11, bold: true };
    total.getCell(4).value = { formula: `SUM(D5:D${ultima})` };
    total.getCell(4).numFmt = dinero;
    total.getCell(4).font = { name: "Calibri", size: 11, bold: true };

    detalle.autoFilter = { from: "A4", to: `E${ultima}` };
    detalle.views = [{ state: "frozen", ySplit: 4 }];
  } else {
    detalle.getCell("A5").value = "No hubo movimientos registrados en este período.";
    detalle.getCell("A5").font = { name: "Calibri", size: 10, italic: true, color: { argb: GRIS } };
  }

  // ---------- Deudas ----------
  if (informe.deudas.length > 0) {
    const hoja = libro.addWorksheet("Deudas");
    hoja.columns = [{ width: 28 }, { width: 14 }, { width: 20 }, { width: 18 }, { width: 22 }];
    titulo(hoja, informe);
    encabezados(hoja, 4, ["Acreedor", "Tipo", "Saldo declarado", "Cuota", "Declarado el"]);

    informe.deudas.forEach((d, i) => {
      const r = hoja.getRow(5 + i);
      r.getCell(1).value = d.acreedor;
      r.getCell(2).value = d.tipo;
      r.getCell(3).value = d.saldo_declarado;
      r.getCell(3).numFmt = formatoMoneda(d.moneda);
      if (d.cuota_monto !== null) {
        r.getCell(4).value = d.cuota_monto;
        r.getCell(4).numFmt = formatoMoneda(d.moneda);
      }
      r.getCell(5).value = d.saldo_declarado_el;
    });

    const nota = hoja.getRow(6 + informe.deudas.length);
    hoja.mergeCells(`A${nota.number}:E${nota.number}`);
    nota.getCell(1).value =
      "Los saldos son los que declaraste vos. EOS no ve los pagos a estas deudas salvo que lleguen por correo.";
    nota.getCell(1).font = { name: "Calibri", size: 9, italic: true, color: { argb: GRIS } };
  }

  return libro.xlsx.writeBuffer();
}
