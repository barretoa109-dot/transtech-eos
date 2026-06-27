import ExcelJS from "exceljs";

const COLORS = {
  dark: "020617",
  navy: "071226",
  cyan: "22D3EE",
  white: "FFFFFF",
  muted: "94A3B8",
  green: "22C55E",
  red: "EF4444",
  yellow: "FACC15",
};

function titleCell(cell, value) {
  cell.value = value;
  cell.font = { bold: true, size: 16, color: { argb: COLORS.white } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.dark },
  };
  cell.alignment = { vertical: "middle", horizontal: "center" };
}

function headerRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLORS.dark } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.cyan },
    };
    cell.alignment = { horizontal: "center" };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });
}

function moneyColumn(sheet, column) {
  sheet.getColumn(column).numFmt = '"Gs" #,##0';
}

function autoWidth(sheet) {
  sheet.columns.forEach((column) => {
    let max = 12;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value ? cell.value.toString() : "";
      max = Math.max(max, value.length + 4);
    });
    column.width = Math.min(max, 35);
  });
}

export async function crearExcelNegocioUniversal(workbook, opciones = {}) {
  const nombreNegocio = opciones.nombreNegocio || "Mi Negocio";
  const rubro = opciones.rubro || "Negocio general";

  workbook.creator = "TransTech EOS";
  workbook.created = new Date();

  const portada = workbook.addWorksheet("Resumen EOS");
  portada.views = [{ showGridLines: false }];

  portada.mergeCells("A1:H2");
  titleCell(portada.getCell("A1"), "TRANS TECH EOS · CONTROL INTELIGENTE DE NEGOCIO");

  portada.getCell("A4").value = "Negocio";
  portada.getCell("B4").value = nombreNegocio;
  portada.getCell("A5").value = "Rubro";
  portada.getCell("B5").value = rubro;
  portada.getCell("A6").value = "Archivo generado";
  portada.getCell("B6").value = new Date();

  portada.getCell("A8").value = "Este archivo fue diseñado para controlar ingresos, gastos, clientes, inventario, ventas, flujo de caja y decisiones operativas.";
  portada.mergeCells("A8:H9");

  ["A4", "A5", "A6"].forEach((c) => {
    portada.getCell(c).font = { bold: true };
  });

  portada.getCell("A11").value = "Indicadores principales";
  portada.getCell("A11").font = { bold: true, size: 16 };

  portada.addRow([]);
  portada.addRow(["Indicador", "Valor"]);
  headerRow(portada.getRow(13));

  portada.addRow(["Total ingresos", { formula: "SUM(Ingresos!D:D)" }]);
  portada.addRow(["Total gastos", { formula: "SUM('Gastos fijos'!D:D)+SUM('Gastos variables'!D:D)" }]);
  portada.addRow(["Utilidad estimada", { formula: "B14-B15" }]);
  portada.addRow(["Clientes registrados", { formula: "COUNTA(Clientes!A:A)-1" }]);
  portada.addRow(["Productos registrados", { formula: "COUNTA(Productos!A:A)-1" }]);

  moneyColumn(portada, 2);
  autoWidth(portada);

  const ingresos = workbook.addWorksheet("Ingresos");
  ingresos.addRow(["Fecha", "Cliente/Fuente", "Descripción", "Monto", "Forma de pago", "Canal", "Observación"]);
  headerRow(ingresos.getRow(1));
  ingresos.addRow([new Date(), "Cliente ejemplo", "Venta o ingreso", 0, "Efectivo/Transferencia", "Local/Web/WhatsApp", ""]);
  moneyColumn(ingresos, 4);
  autoWidth(ingresos);

  const gastosFijos = workbook.addWorksheet("Gastos fijos");
  gastosFijos.addRow(["Fecha", "Categoría", "Descripción", "Monto", "Forma de pago", "Observación"]);
  headerRow(gastosFijos.getRow(1));
  gastosFijos.addRow([new Date(), "Alquiler/Sueldo/Servicio", "Pago mensual", 0, "Efectivo/Transferencia", ""]);
  moneyColumn(gastosFijos, 4);
  autoWidth(gastosFijos);

  const gastosVariables = workbook.addWorksheet("Gastos variables");
  gastosVariables.addRow(["Fecha", "Categoría", "Descripción", "Monto", "Proveedor", "Observación"]);
  headerRow(gastosVariables.getRow(1));
  gastosVariables.addRow([new Date(), "Insumos/Mercadería", "Compra operativa", 0, "Proveedor", ""]);
  moneyColumn(gastosVariables, 4);
  autoWidth(gastosVariables);

  const productos = workbook.addWorksheet("Productos");
  productos.addRow(["Producto/Servicio", "Categoría", "Costo", "Precio venta", "Margen", "Stock", "Observación"]);
  headerRow(productos.getRow(1));
  productos.addRow(["Producto ejemplo", "General", 0, 0, { formula: "D2-C2" }, 0, ""]);
  moneyColumn(productos, 3);
  moneyColumn(productos, 4);
  moneyColumn(productos, 5);
  autoWidth(productos);

  const clientes = workbook.addWorksheet("Clientes");
  clientes.addRow(["Nombre", "Teléfono", "Email", "Origen", "Última compra", "Valor estimado", "Estado", "Observación"]);
  headerRow(clientes.getRow(1));
  clientes.addRow(["Cliente ejemplo", "", "", "WhatsApp/Instagram/Local", "", 0, "Activo", ""]);
  moneyColumn(clientes, 6);
  autoWidth(clientes);

  const flujo = workbook.addWorksheet("Flujo de caja");
  flujo.addRow(["Mes", "Ingresos", "Gastos fijos", "Gastos variables", "Resultado"]);
  headerRow(flujo.getRow(1));

  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  meses.forEach((mes, index) => {
    const row = index + 2;
    flujo.addRow([
      mes,
      0,
      0,
      0,
      { formula: `B${row}-C${row}-D${row}` },
    ]);
  });

  moneyColumn(flujo, 2);
  moneyColumn(flujo, 3);
  moneyColumn(flujo, 4);
  moneyColumn(flujo, 5);
  autoWidth(flujo);

  const recomendaciones = workbook.addWorksheet("Recomendaciones EOS");
  recomendaciones.views = [{ showGridLines: false }];
  recomendaciones.mergeCells("A1:F2");
  titleCell(recomendaciones.getCell("A1"), "RECOMENDACIONES INTELIGENTES EOS");

  recomendaciones.addRow([]);
  recomendaciones.addRow(["Área", "Recomendación", "Prioridad"]);
  headerRow(recomendaciones.getRow(4));

  recomendaciones.addRow(["Finanzas", "Registrar todos los ingresos y gastos diariamente.", "Alta"]);
  recomendaciones.addRow(["Ventas", "Medir qué canal genera más clientes.", "Alta"]);
  recomendaciones.addRow(["Operación", "Controlar productos, costos y margen de ganancia.", "Media"]);
  recomendaciones.addRow(["Clientes", "Crear seguimiento para clientes frecuentes.", "Media"]);
  recomendaciones.addRow(["Crecimiento", "Revisar el flujo de caja cada semana.", "Alta"]);

  autoWidth(recomendaciones);

  workbook.eachSheet((sheet) => {
    sheet.freezePanes = { row: 1 };
    sheet.eachRow((row) => {
      row.height = 24;
    });
  });

  return workbook;
}