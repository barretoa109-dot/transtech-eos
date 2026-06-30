const COLORS = {
  bg: "07111F",
  bg2: "0A1728",
  panel: "0E2238",
  panel2: "102B46",
  panel3: "123A5A",
  dark: "020617",
  cyan: "22D3EE",
  cyanDark: "0891B2",
  blue: "38BDF8",
  green: "22C55E",
  red: "EF4444",
  yellow: "FACC15",
  orange: "FB923C",
  purple: "C084FC",
  white: "FFFFFF",
  text: "E2E8F0",
  muted: "94A3B8",
  border: "1E3A5F",
  softBorder: "244968",
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

function border(cell, color = COLORS.softBorder, style = "thin") {
  cell.border = {
    top: { style, color: argb(color) },
    left: { style, color: argb(color) },
    bottom: { style, color: argb(color) },
    right: { style, color: argb(color) },
  };
}

function text(cell, value, size = 11, color = COLORS.text, bold = false) {
  cell.value = value;
  cell.font = {
    name: "Aptos",
    size,
    bold,
    color: argb(color),
  };
  cell.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };
}

function paint(sheet, range, color) {
  const [start, end] = range.split(":");
  const s = sheet.getCell(start);
  const e = sheet.getCell(end);

  for (let r = s.row; r <= e.row; r++) {
    for (let c = s.col; c <= e.col; c++) {
      fill(sheet.getCell(r, c), color);
    }
  }
}

function outline(sheet, range, color = COLORS.softBorder) {
  const [start, end] = range.split(":");
  const s = sheet.getCell(start);
  const e = sheet.getCell(end);

  for (let r = s.row; r <= e.row; r++) {
    for (let c = s.col; c <= e.col; c++) {
      border(sheet.getCell(r, c), color);
    }
  }
}

function merge(sheet, range, value, options = {}) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]);

  text(
    cell,
    value,
    options.size || 11,
    options.color || COLORS.text,
    options.bold || false
  );

  fill(cell, options.fill || COLORS.panel);
  border(cell, options.border || COLORS.softBorder);

  if (options.align) {
    cell.alignment = options.align;
  }

  if (options.numFmt) {
    cell.numFmt = options.numFmt;
  }

  return cell;
}

function money(cell) {
  cell.numFmt = '"Gs" #,##0';
}

function percent(cell) {
  cell.numFmt = "0.00%";
}

function darkCard(sheet, range) {
  paint(sheet, range, COLORS.panel);
  outline(sheet, range, COLORS.softBorder);
}

function kpiCard(sheet, area, icon, title, formula, note, color, format = "money") {
  const { top, value, bottom } = area;

  merge(sheet, top, `${icon}  ${title}`, {
    fill: COLORS.panel,
    color: COLORS.text,
    bold: true,
    size: 11,
    align: { vertical: "middle", horizontal: "left", wrapText: true },
  });

  const valueCell = merge(sheet, value, formula, {
    fill: COLORS.panel,
    color,
    bold: true,
    size: 22,
  });

  merge(sheet, bottom, note, {
    fill: COLORS.panel,
    color: COLORS.muted,
    size: 9,
  });

  if (format === "money") money(valueCell);
  if (format === "percent") percent(valueCell);
}

function section(sheet, range, title) {
  merge(sheet, range, title, {
    fill: COLORS.dark,
    color: COLORS.white,
    bold: true,
    size: 13,
    border: COLORS.cyan,
  });
}

function nav(sheet, row, icon, label, active = false) {
  merge(sheet, `B${row}:C${row}`, `${icon}  ${label}`, {
    fill: active ? COLORS.cyanDark : COLORS.panel,
    color: active ? COLORS.white : COLORS.text,
    bold: true,
    size: 10,
    align: { vertical: "middle", horizontal: "left", wrapText: true },
  });
}

function headerRow(row) {
  row.eachCell((cell) => {
    fill(cell, COLORS.cyan);
    cell.font = {
      name: "Aptos",
      bold: true,
      color: argb(COLORS.dark),
      size: 11,
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    border(cell, COLORS.border);
  });
  row.height = 28;
}

function tableSheet(sheet, headers, rows = []) {
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];

  sheet.addRow(headers);
  headerRow(sheet.getRow(1));

  rows.forEach((row) => sheet.addRow(row));

  sheet.eachRow((row, index) => {
    row.height = index === 1 ? 30 : 24;
    row.eachCell((cell) => {
      border(cell, "D9EAF7");
      cell.alignment = {
        vertical: "middle",
        wrapText: true,
      };
    });
  });

  sheet.columns.forEach((col) => {
    col.width = 23;
  });
}

function fakeBar(sheet, row, label, widthCells, value, color) {
  text(sheet.getCell(`J${row}`), label, 10, COLORS.text, false);
  fill(sheet.getCell(`J${row}`), COLORS.panel);
  border(sheet.getCell(`J${row}`));

  for (let i = 0; i < 3; i++) {
    const cell = sheet.getCell(row, 11 + i);
    fill(cell, i < widthCells ? color : COLORS.panel2);
    border(cell);
  }

  text(sheet.getCell(`N${row}`), value, 10, COLORS.white, true);
  fill(sheet.getCell(`N${row}`), COLORS.panel);
  border(sheet.getCell(`N${row}`));
}

function miniMetric(sheet, row, label, formula, format) {
  text(sheet.getCell(`E${row}`), label, 10, COLORS.text, false);
  const value = sheet.getCell(`H${row}`);
  value.value = formula;
  value.font = { name: "Aptos", size: 10, bold: true, color: argb(COLORS.cyan) };
  value.alignment = { horizontal: "center", vertical: "middle" };

  if (format === "money") money(value);

  fill(sheet.getCell(`E${row}`), COLORS.panel);
  fill(value, COLORS.panel);
  border(sheet.getCell(`E${row}`));
  border(value);
}

function createDashboard(workbook, opciones) {
  const nombreNegocio = opciones.nombreNegocio || "Mi Negocio";
  const rubro = opciones.rubro || "Negocio general";

  const sheet = workbook.addWorksheet("Dashboard EOS");

  sheet.views = [{ showGridLines: false }];
  sheet.properties.defaultRowHeight = 24;

  sheet.columns = [
    { width: 3 },
    { width: 15 },
    { width: 15 },
    { width: 2 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 2 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];

  for (let r = 1; r <= 42; r++) {
    for (let c = 1; c <= 14; c++) {
      fill(sheet.getCell(r, c), COLORS.bg);
    }
  }

  sheet.mergeCells("B2:H5");
  const title = sheet.getCell("B2");
  title.value = {
    richText: [
      { text: "TRANS TECH ", font: { name: "Aptos", size: 28, bold: true, color: argb(COLORS.white) } },
      { text: "EOS", font: { name: "Aptos", size: 28, bold: true, color: argb(COLORS.cyan) } },
      { text: "\nCONTROL INTELIGENTE DE NEGOCIO", font: { name: "Aptos", size: 11, color: argb(COLORS.muted) } },
    ],
  };
  title.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  fill(title, COLORS.dark);
  border(title, COLORS.cyan);

  merge(sheet, "I2:N5", `NEGOCIO: ${nombreNegocio}\nRUBRO: ${rubro}\nGENERADO: ${new Date().toLocaleString("es-PY")}`, {
    fill: COLORS.panel,
    color: COLORS.text,
    bold: true,
    size: 11,
    align: { vertical: "middle", horizontal: "left", wrapText: true },
  });

  darkCard(sheet, "B7:C36");
  merge(sheet, "B8:C8", "NAVEGACIÓN", {
    fill: COLORS.panel,
    color: COLORS.cyan,
    bold: true,
    size: 11,
    align: { vertical: "middle", horizontal: "left", wrapText: true },
  });

  nav(sheet, 10, "▣", "Dashboard", true);
  nav(sheet, 12, "↗", "Ingresos");
  nav(sheet, 14, "↘", "Gastos fijos");
  nav(sheet, 16, "◈", "Gastos variables");
  nav(sheet, 18, "□", "Productos / Servicios");
  nav(sheet, 20, "◎", "Clientes");
  nav(sheet, 22, "▤", "Flujo de caja");
  nav(sheet, 24, "★", "Diagnóstico EOS");
  nav(sheet, 26, "⚙", "Configuración");

  merge(sheet, "B30:C34", "“Lo que se mide,\nse controla.\nLo que se controla,\nse mejora.”\n\n– EOS", {
    fill: COLORS.panel2,
    color: COLORS.cyan,
    size: 10,
  });

  kpiCard(sheet, {
    top: "E7:F8",
    value: "E9:F11",
    bottom: "E12:F12",
  }, "↗", "INGRESOS TOTALES", { formula: "SUM(Ingresos!D:D)" }, "Ventas e ingresos registrados", COLORS.green);

  kpiCard(sheet, {
    top: "G7:H8",
    value: "G9:H11",
    bottom: "G12:H12",
  }, "↘", "GASTOS TOTALES", { formula: "SUM('Gastos fijos'!D:D)+SUM('Gastos variables'!D:D)" }, "Costos fijos y variables", COLORS.red);

  kpiCard(sheet, {
    top: "J7:K8",
    value: "J9:K11",
    bottom: "J12:K12",
  }, "↗", "UTILIDAD", { formula: "E9-G9" }, "Resultado operativo", COLORS.cyan);

  kpiCard(sheet, {
    top: "L7:N8",
    value: "L9:N11",
    bottom: "L12:N12",
  }, "%", "MARGEN PROMEDIO", { formula: "IFERROR(AVERAGE(Productos!E:E),0)" }, "Rentabilidad estimada", COLORS.yellow, "percent");

  section(sheet, "E14:H14", "RESUMEN RÁPIDO");

  miniMetric(sheet, 16, "Clientes registrados", { formula: "MAX(COUNTA(Clientes!A:A)-1,0)" });
  miniMetric(sheet, 17, "Productos / Servicios", { formula: "MAX(COUNTA(Productos!A:A)-1,0)" });
  miniMetric(sheet, 18, "Ventas registradas", { formula: "MAX(COUNTA(Ingresos!A:A)-1,0)" });
  miniMetric(sheet, 19, "Ticket promedio", { formula: "IFERROR(AVERAGE(Ingresos!D:D),0)" }, "money");
  miniMetric(sheet, 20, "Resultado neto", { formula: "J9" }, "money");

  section(sheet, "J14:N14", "TOP 5 PRODUCTOS / SERVICIOS");

  fakeBar(sheet, 16, "Producto A", 3, "Gs 0", COLORS.cyan);
  fakeBar(sheet, 17, "Producto B", 2, "Gs 0", COLORS.cyanDark);
  fakeBar(sheet, 18, "Producto C", 2, "Gs 0", COLORS.blue);
  fakeBar(sheet, 19, "Producto D", 1, "Gs 0", COLORS.green);
  fakeBar(sheet, 20, "Producto E", 1, "Gs 0", COLORS.purple);

  section(sheet, "E23:H23", "EVOLUCIÓN MENSUAL");

  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun"];
  months.forEach((month, i) => {
    const row = 25 + i;

    text(sheet.getCell(`E${row}`), month, 10, COLORS.text);
    sheet.getCell(`F${row}`).value = { formula: `'Flujo de caja'!B${i + 2}` };
    sheet.getCell(`G${row}`).value = { formula: `'Flujo de caja'!C${i + 2}+'Flujo de caja'!D${i + 2}` };
    sheet.getCell(`H${row}`).value = { formula: `'Flujo de caja'!E${i + 2}` };

    ["F", "G", "H"].forEach((col) => {
      const cell = sheet.getCell(`${col}${row}`);
      money(cell);
      cell.font = {
        name: "Aptos",
        size: 10,
        bold: true,
        color: argb(col === "F" ? COLORS.green : col === "G" ? COLORS.red : COLORS.cyan),
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      fill(cell, COLORS.panel);
      border(cell);
    });
  });

  section(sheet, "J23:N23", "SALUD FINANCIERA EOS");

  merge(sheet, "J25:K31", { formula: 'IF(J9>0,"82%","38%")' }, {
    fill: COLORS.panel2,
    color: COLORS.cyan,
    bold: true,
    size: 34,
  });

  const health = [
    ["Liquidez", "Bien"],
    ["Rentabilidad", "Bien"],
    ["Endeudamiento", "Revisar"],
    ["Eficiencia operativa", "Bien"],
    ["Crecimiento", "En progreso"],
  ];

  health.forEach((item, index) => {
    const row = 25 + index;
    text(sheet.getCell(`L${row}`), item[0], 10, COLORS.text, false);
    text(sheet.getCell(`N${row}`), item[1], 10, item[1] === "Bien" ? COLORS.green : COLORS.yellow, true);
    fill(sheet.getCell(`L${row}`), COLORS.panel);
    fill(sheet.getCell(`N${row}`), COLORS.panel);
    border(sheet.getCell(`L${row}`));
    border(sheet.getCell(`N${row}`));
  });

  section(sheet, "E34:N34", "DIAGNÓSTICO EOS");

  merge(sheet, "E35:N38", "Este archivo convierte los datos del negocio en una vista clara para tomar decisiones. Cargá ingresos, gastos, productos, clientes y flujo de caja. EOS actualizará indicadores clave y te ayudará a detectar oportunidades, riesgos y acciones concretas de crecimiento.", {
    fill: COLORS.panel,
    color: COLORS.text,
    size: 11,
    align: { vertical: "middle", horizontal: "left", wrapText: true },
  });

  merge(sheet, "E40:N40", "Generated by TransTech EOS · AI Business Intelligence", {
    fill: COLORS.bg,
    color: COLORS.muted,
    size: 9,
  });
}

export async function crearExcelNegocioUniversal(workbook, opciones = {}) {
  const nombreNegocio = opciones.nombreNegocio || "Mi Negocio";
  const rubro = opciones.rubro || "Negocio general";

  workbook.creator = "TransTech EOS";
  workbook.company = "TransTech";
  workbook.subject = "Control inteligente de negocio";
  workbook.title = `Control EOS - ${nombreNegocio}`;
  workbook.created = new Date();

  createDashboard(workbook, { nombreNegocio, rubro });

  const ingresos = workbook.addWorksheet("Ingresos");
  tableSheet(
    ingresos,
    ["Fecha", "Cliente/Fuente", "Descripción", "Monto", "Forma de pago", "Canal", "Observación"],
    [[new Date(), "Cliente ejemplo", "Venta o ingreso", 0, "Efectivo/Transferencia", "Local/Web/WhatsApp", ""]]
  );
  ingresos.getColumn(1).numFmt = "dd/mm/yyyy";
  ingresos.getColumn(4).numFmt = '"Gs" #,##0';

  const gastosFijos = workbook.addWorksheet("Gastos fijos");
  tableSheet(
    gastosFijos,
    ["Fecha", "Categoría", "Descripción", "Monto", "Forma de pago", "Observación"],
    [[new Date(), "Alquiler / Sueldo / Servicio", "Pago mensual", 0, "Efectivo/Transferencia", ""]]
  );
  gastosFijos.getColumn(1).numFmt = "dd/mm/yyyy";
  gastosFijos.getColumn(4).numFmt = '"Gs" #,##0';

  const gastosVariables = workbook.addWorksheet("Gastos variables");
  tableSheet(
    gastosVariables,
    ["Fecha", "Categoría", "Descripción", "Monto", "Proveedor", "Observación"],
    [[new Date(), "Insumos / Mercadería", "Compra operativa", 0, "Proveedor", ""]]
  );
  gastosVariables.getColumn(1).numFmt = "dd/mm/yyyy";
  gastosVariables.getColumn(4).numFmt = '"Gs" #,##0';

  const productos = workbook.addWorksheet("Productos");
  tableSheet(
    productos,
    ["Producto/Servicio", "Categoría", "Costo unitario", "Precio venta", "Margen %", "Stock", "Observación"],
    [["Producto ejemplo", "General", 0, 0, { formula: "IFERROR((D2-C2)/D2,0)" }, 0, ""]]
  );
  productos.getColumn(3).numFmt = '"Gs" #,##0';
  productos.getColumn(4).numFmt = '"Gs" #,##0';
  productos.getColumn(5).numFmt = "0.00%";

  const clientes = workbook.addWorksheet("Clientes");
  tableSheet(
    clientes,
    ["Nombre", "Teléfono", "Email", "Origen", "Última compra", "Valor estimado", "Estado", "Observación"],
    [["Cliente ejemplo", "", "", "WhatsApp / Instagram / Local / Web", "", 0, "Activo", ""]]
  );
  clientes.getColumn(5).numFmt = "dd/mm/yyyy";
  clientes.getColumn(6).numFmt = '"Gs" #,##0';

  const flujo = workbook.addWorksheet("Flujo de caja");
  tableSheet(flujo, ["Mes", "Ingresos", "Gastos fijos", "Gastos variables", "Resultado"], []);

  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];

  meses.forEach((mes, i) => {
    const row = i + 2;
    flujo.addRow([mes, 0, 0, 0, { formula: `B${row}-C${row}-D${row}` }]);
  });

  [2, 3, 4, 5].forEach((col) => {
    flujo.getColumn(col).numFmt = '"Gs" #,##0';
  });

  const diagnostico = workbook.addWorksheet("Diagnóstico EOS");
  diagnostico.views = [{ showGridLines: false }];
  diagnostico.columns = [{ width: 28 }, { width: 90 }, { width: 18 }];

  merge(diagnostico, "A1:C3", "DIAGNÓSTICO INTELIGENTE EOS", {
    fill: COLORS.dark,
    color: COLORS.white,
    bold: true,
    size: 22,
    border: COLORS.cyan,
  });

  diagnostico.addRow([]);
  diagnostico.addRow(["Área", "Análisis", "Prioridad"]);
  headerRow(diagnostico.getRow(5));

  [
    ["Finanzas", "Registrá ingresos y gastos diariamente para que EOS pueda medir rentabilidad real.", "Alta"],
    ["Ventas", "Medí los canales que generan más clientes para enfocar esfuerzo comercial.", "Alta"],
    ["Operación", "Controlá costos unitarios y margen por producto o servicio.", "Alta"],
    ["Clientes", "Registrá clientes frecuentes para aumentar recompra y seguimiento.", "Media"],
    ["Dirección", "Usá este archivo como tablero central de decisiones.", "Alta"],
  ].forEach((row) => diagnostico.addRow(row));

  diagnostico.eachRow((row) => {
    row.height = 30;
    row.eachCell((cell) => {
      border(cell, "D9EAF7");
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  });

  const config = workbook.addWorksheet("Configuración");
  tableSheet(config, ["Campo", "Valor"], [
    ["Nombre", nombreNegocio],
    ["Rubro", rubro],
    ["Moneda", "Guaraníes"],
    ["Creado por", "TransTech EOS"],
    ["Versión", "Business Premium v3"],
  ]);

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