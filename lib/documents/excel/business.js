const COLORS = {
  dark: "020617",
  navy: "071226",
  card: "0F172A",
  cyan: "22D3EE",
  cyanDark: "0891B2",
  white: "FFFFFF",
  gray: "CBD5E1",
  muted: "64748B",
  green: "22C55E",
  red: "EF4444",
  yellow: "FACC15",
  border: "334155",
};

function argb(color) {
  return { argb: color };
}

function fill(cell, color) {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: argb(color),
  };
}

function border(cell, color = COLORS.border) {
  cell.border = {
    top: { style: "thin", color: argb(color) },
    left: { style: "thin", color: argb(color) },
    bottom: { style: "thin", color: argb(color) },
    right: { style: "thin", color: argb(color) },
  };
}

function styleHeader(row) {
  row.eachCell((cell) => {
    fill(cell, COLORS.cyan);
    cell.font = { bold: true, color: argb(COLORS.dark), size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    border(cell);
  });
  row.height = 26;
}

function money(cell) {
  cell.numFmt = '"Gs" #,##0';
}

function percent(cell) {
  cell.numFmt = "0.00%";
}

function autoWidth(sheet) {
  sheet.columns.forEach((column) => {
    let max = 14;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value ? String(cell.value) : "";
      max = Math.max(max, value.length + 3);
    });
    column.width = Math.min(max, 34);
  });
}

function card(sheet, range, title, formula, note, color = COLORS.cyan) {
  sheet.mergeCells(range.title);
  sheet.mergeCells(range.value);
  sheet.mergeCells(range.note);

  const titleCell = sheet.getCell(range.title.split(":")[0]);
  const valueCell = sheet.getCell(range.value.split(":")[0]);
  const noteCell = sheet.getCell(range.note.split(":")[0]);

  titleCell.value = title;
  valueCell.value = formula;
  noteCell.value = note;

  [titleCell, valueCell, noteCell].forEach((c) => {
    fill(c, COLORS.card);
    border(c);
    c.alignment = { vertical: "middle", horizontal: "center" };
  });

  titleCell.font = { bold: true, color: argb(COLORS.gray), size: 11 };
  valueCell.font = { bold: true, color: argb(color), size: 22 };
  noteCell.font = { color: argb(COLORS.muted), size: 10 };
}

function tableSheet(sheet, headers, sampleRows = []) {
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  sheet.addRow(headers);
  styleHeader(sheet.getRow(1));

  sampleRows.forEach((row) => sheet.addRow(row));

  sheet.eachRow((row, rowNumber) => {
    row.height = rowNumber === 1 ? 28 : 24;
    row.eachCell((cell) => {
      border(cell, "E2E8F0");
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  });

  autoWidth(sheet);
}

export async function crearExcelNegocioUniversal(workbook, opciones = {}) {
  const nombreNegocio = opciones.nombreNegocio || "Mi Negocio";
  const rubro = opciones.rubro || "Negocio general";

  workbook.creator = "TransTech EOS";
  workbook.company = "TransTech";
  workbook.subject = "Control inteligente de negocio";
  workbook.title = `Control EOS - ${nombreNegocio}`;
  workbook.created = new Date();

  workbook.views = [
    {
      x: 0,
      y: 0,
      width: 14000,
      height: 9000,
      firstSheet: 0,
      activeTab: 0,
      visibility: "visible",
    },
  ];

  const dashboard = workbook.addWorksheet("Dashboard EOS");
  dashboard.views = [{ showGridLines: false }];
  dashboard.properties.defaultRowHeight = 22;

  dashboard.columns = [
    { width: 4 },
    { width: 22 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];

  dashboard.mergeCells("B2:H3");
  const title = dashboard.getCell("B2");
  title.value = "TRANS TECH EOS";
  fill(title, COLORS.dark);
  title.font = { bold: true, color: argb(COLORS.white), size: 24 };
  title.alignment = { vertical: "middle", horizontal: "center" };
  border(title, COLORS.cyan);

  dashboard.mergeCells("B4:H4");
  const subtitle = dashboard.getCell("B4");
  subtitle.value = "Panel profesional de control, finanzas, ventas y crecimiento";
  fill(subtitle, COLORS.navy);
  subtitle.font = { color: argb(COLORS.cyan), bold: true, size: 12 };
  subtitle.alignment = { horizontal: "center" };
  border(subtitle, COLORS.border);

  dashboard.getCell("B6").value = "Negocio";
  dashboard.getCell("C6").value = nombreNegocio;
  dashboard.getCell("B7").value = "Rubro";
  dashboard.getCell("C7").value = rubro;
  dashboard.getCell("B8").value = "Generado";
  dashboard.getCell("C8").value = new Date();
  dashboard.getCell("C8").numFmt = "dd/mm/yyyy hh:mm";

  ["B6", "B7", "B8"].forEach((c) => {
    dashboard.getCell(c).font = { bold: true, color: argb(COLORS.white) };
    fill(dashboard.getCell(c), COLORS.card);
    border(dashboard.getCell(c));
  });

  ["C6", "C7", "C8"].forEach((c) => {
    fill(dashboard.getCell(c), COLORS.card);
    dashboard.getCell(c).font = { color: argb(COLORS.gray) };
    border(dashboard.getCell(c));
  });

  card(
    dashboard,
    { title: "B10:C10", value: "B11:C12", note: "B13:C13" },
    "Ingresos totales",
    { formula: "SUM(Ingresos!D:D)" },
    "Ventas e ingresos registrados",
    COLORS.green
  );

  card(
    dashboard,
    { title: "D10:E10", value: "D11:E12", note: "D13:E13" },
    "Gastos totales",
    { formula: "SUM('Gastos fijos'!D:D)+SUM('Gastos variables'!D:D)" },
    "Costos fijos y variables",
    COLORS.red
  );

  card(
    dashboard,
    { title: "F10:H10", value: "F11:H12", note: "F13:H13" },
    "Utilidad estimada",
    { formula: "B11-D11" },
    "Resultado operativo aproximado",
    COLORS.cyan
  );

  card(
    dashboard,
    { title: "B15:C15", value: "B16:C17", note: "B18:C18" },
    "Clientes",
    { formula: "MAX(COUNTA(Clientes!A:A)-1,0)" },
    "Base comercial registrada",
    COLORS.yellow
  );

  card(
    dashboard,
    { title: "D15:E15", value: "D16:E17", note: "D18:E18" },
    "Productos/Servicios",
    { formula: "MAX(COUNTA(Productos!A:A)-1,0)" },
    "Oferta activa registrada",
    COLORS.cyan
  );

  card(
    dashboard,
    { title: "F15:H15", value: "F16:H17", note: "F18:H18" },
    "Margen promedio",
    { formula: "IFERROR(AVERAGE(Productos!E:E),0)" },
    "Rentabilidad promedio",
    COLORS.green
  );
  dashboard.getCell("F16").numFmt = "0.00%";

  dashboard.mergeCells("B21:H21");
  dashboard.getCell("B21").value = "Diagnóstico EOS";
  fill(dashboard.getCell("B21"), COLORS.dark);
  dashboard.getCell("B21").font = { bold: true, color: argb(COLORS.white), size: 15 };
  dashboard.getCell("B21").alignment = { horizontal: "center" };

  dashboard.mergeCells("B22:H26");
  dashboard.getCell("B22").value =
    "Este archivo está preparado para controlar cualquier tipo de negocio: comercio, servicios, gastronomía, consultoría, distribución, emprendimientos digitales o profesionales independientes. Cargá tus datos en las hojas correspondientes y el dashboard se actualizará automáticamente.";
  dashboard.getCell("B22").alignment = { wrapText: true, vertical: "middle" };
  dashboard.getCell("B22").font = { color: argb(COLORS.gray), size: 12 };
  fill(dashboard.getCell("B22"), COLORS.card);
  border(dashboard.getCell("B22"));

  ["B11", "D11", "F11"].forEach((c) => money(dashboard.getCell(c)));

  const ingresos = workbook.addWorksheet("Ingresos");
  tableSheet(ingresos, ["Fecha", "Cliente/Fuente", "Descripción", "Monto", "Forma de pago", "Canal", "Observación"], [
    [new Date(), "Cliente ejemplo", "Venta o ingreso", 0, "Efectivo/Transferencia", "Local/Web/WhatsApp", ""],
  ]);
  ingresos.getColumn(1).numFmt = "dd/mm/yyyy";
  ingresos.getColumn(4).numFmt = '"Gs" #,##0';

  const gastosFijos = workbook.addWorksheet("Gastos fijos");
  tableSheet(gastosFijos, ["Fecha", "Categoría", "Descripción", "Monto", "Forma de pago", "Observación"], [
    [new Date(), "Alquiler / Sueldo / Servicio", "Pago mensual", 0, "Efectivo/Transferencia", ""],
  ]);
  gastosFijos.getColumn(1).numFmt = "dd/mm/yyyy";
  gastosFijos.getColumn(4).numFmt = '"Gs" #,##0';

  const gastosVariables = workbook.addWorksheet("Gastos variables");
  tableSheet(gastosVariables, ["Fecha", "Categoría", "Descripción", "Monto", "Proveedor", "Observación"], [
    [new Date(), "Insumos / Mercadería", "Compra operativa", 0, "Proveedor", ""],
  ]);
  gastosVariables.getColumn(1).numFmt = "dd/mm/yyyy";
  gastosVariables.getColumn(4).numFmt = '"Gs" #,##0';

  const productos = workbook.addWorksheet("Productos");
  tableSheet(productos, ["Producto/Servicio", "Categoría", "Costo unitario", "Precio venta", "Margen %", "Stock", "Observación"], [
    ["Producto ejemplo", "General", 0, 0, { formula: "IFERROR((D2-C2)/D2,0)" }, 0, ""],
  ]);
  productos.getColumn(3).numFmt = '"Gs" #,##0';
  productos.getColumn(4).numFmt = '"Gs" #,##0';
  productos.getColumn(5).numFmt = "0.00%";

  const clientes = workbook.addWorksheet("Clientes");
  tableSheet(clientes, ["Nombre", "Teléfono", "Email", "Origen", "Última compra", "Valor estimado", "Estado", "Observación"], [
    ["Cliente ejemplo", "", "", "WhatsApp / Instagram / Local / Web", "", 0, "Activo", ""],
  ]);
  clientes.getColumn(5).numFmt = "dd/mm/yyyy";
  clientes.getColumn(6).numFmt = '"Gs" #,##0';

  const flujo = workbook.addWorksheet("Flujo de caja");
  tableSheet(flujo, ["Mes", "Ingresos", "Gastos fijos", "Gastos variables", "Resultado"], []);
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  meses.forEach((mes, i) => {
    const row = i + 2;
    flujo.addRow([mes, 0, 0, 0, { formula: `B${row}-C${row}-D${row}` }]);
  });
  [2, 3, 4, 5].forEach((col) => {
    flujo.getColumn(col).numFmt = '"Gs" #,##0';
  });
  autoWidth(flujo);

  const recomendaciones = workbook.addWorksheet("Recomendaciones EOS");
  recomendaciones.views = [{ showGridLines: false }];
  recomendaciones.columns = [{ width: 22 }, { width: 75 }, { width: 18 }];

  recomendaciones.mergeCells("A1:C2");
  recomendaciones.getCell("A1").value = "RECOMENDACIONES INTELIGENTES EOS";
  fill(recomendaciones.getCell("A1"), COLORS.dark);
  recomendaciones.getCell("A1").font = { bold: true, color: argb(COLORS.white), size: 18 };
  recomendaciones.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };

  recomendaciones.addRow([]);
  recomendaciones.addRow(["Área", "Recomendación", "Prioridad"]);
  styleHeader(recomendaciones.getRow(4));

  [
    ["Finanzas", "Registrar ingresos y gastos todos los días para evitar decisiones a ciegas.", "Alta"],
    ["Ventas", "Medir qué canal genera más clientes y enfocar inversión en los canales con mejor resultado.", "Alta"],
    ["Operación", "Controlar costos unitarios para saber qué producto o servicio deja mayor margen.", "Alta"],
    ["Clientes", "Registrar clientes frecuentes y hacer seguimiento para aumentar recompra.", "Media"],
    ["Crecimiento", "Revisar el flujo de caja semanalmente antes de asumir nuevos gastos.", "Alta"],
    ["Dirección", "Usar este archivo como tablero central de decisiones del negocio.", "Alta"],
  ].forEach((row) => recomendaciones.addRow(row));

  recomendaciones.eachRow((row, rowNumber) => {
    row.height = rowNumber <= 2 ? 30 : 26;
    row.eachCell((cell) => {
      border(cell, "E2E8F0");
      cell.alignment = { wrapText: true, vertical: "middle" };
    });
  });

  workbook.eachSheet((sheet) => {
    sheet.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
  });

  return workbook;
}