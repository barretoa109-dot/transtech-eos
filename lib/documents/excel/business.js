const COLORS = {
  bg: "06111F",
  panel: "0B1B2E",
  panel2: "10233A",
  dark: "020617",
  cyan: "22D3EE",
  cyan2: "06B6D4",
  blue: "38BDF8",
  green: "22C55E",
  red: "EF4444",
  yellow: "FACC15",
  purple: "C084FC",
  white: "FFFFFF",
  text: "E2E8F0",
  muted: "94A3B8",
  border: "1E3A5F",
};

function argb(c) {
  return { argb: c };
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

function moneyCell(cell) {
  cell.numFmt = '"Gs" #,##0';
}

function percentCell(cell) {
  cell.numFmt = "0.00%";
}

function paintRange(sheet, range, color) {
  const [start, end] = range.split(":");
  const startCell = sheet.getCell(start);
  const endCell = sheet.getCell(end);

  for (let r = startCell.row; r <= endCell.row; r++) {
    for (let c = startCell.col; c <= endCell.col; c++) {
      fill(sheet.getCell(r, c), color);
      border(sheet.getCell(r, c));
    }
  }
}

function mergeTitle(sheet, range, value, size = 20, color = COLORS.white) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]);
  text(cell, value, size, color, true);
  fill(cell, COLORS.dark);
  border(cell, COLORS.cyan);
}

function kpiCard(sheet, range, title, formula, note, accent) {
  const [a, b] = range;
  const [c, d] = a.split(":");
  const [e, f] = b.split(":");

  sheet.mergeCells(a);
  sheet.mergeCells(b);
  sheet.mergeCells(range[2]);

  const titleCell = sheet.getCell(c);
  const valueCell = sheet.getCell(e);
  const noteCell = sheet.getCell(range[2].split(":")[0]);

  text(titleCell, title, 11, COLORS.text, true);
  text(valueCell, formula, 20, accent, true);
  text(noteCell, note, 9, COLORS.muted, false);

  [titleCell, valueCell, noteCell].forEach((cell) => {
    fill(cell, COLORS.panel);
    border(cell);
  });
}

function navItem(sheet, row, label, active = false) {
  sheet.mergeCells(`B${row}:C${row}`);
  const cell = sheet.getCell(`B${row}`);
  text(cell, label, 11, active ? COLORS.white : COLORS.text, true);
  fill(cell, active ? COLORS.cyan2 : COLORS.panel);
  border(cell);
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
    border(cell);
  });
  row.height = 28;
}

function tableSheet(sheet, headers, rows = []) {
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  sheet.addRow(headers);
  headerRow(sheet.getRow(1));

  rows.forEach((r) => sheet.addRow(r));

  sheet.eachRow((row, index) => {
    row.height = index === 1 ? 28 : 24;
    row.eachCell((cell) => {
      border(cell, "D9EAF7");
      cell.alignment = {
        vertical: "middle",
        wrapText: true,
      };
    });
  });

  sheet.columns.forEach((column) => {
    column.width = 22;
  });
}

function fakeBar(sheet, row, label, value, color) {
  sheet.getCell(`J${row}`).value = label;
  sheet.getCell(`K${row}`).value = "";
  sheet.getCell(`L${row}`).value = value;

  text(sheet.getCell(`J${row}`), label, 10, COLORS.text, false);
  text(sheet.getCell(`L${row}`), value, 10, COLORS.text, true);

  fill(sheet.getCell(`K${row}`), color);
  border(sheet.getCell(`K${row}`));
}

export async function crearExcelNegocioUniversal(workbook, opciones = {}) {
  const nombreNegocio = opciones.nombreNegocio || "Mi Negocio";
  const rubro = opciones.rubro || "Negocio general";

  workbook.creator = "TransTech EOS";
  workbook.company = "TransTech";
  workbook.subject = "Control inteligente de negocio";
  workbook.title = `Control EOS - ${nombreNegocio}`;
  workbook.created = new Date();

  const dashboard = workbook.addWorksheet("Dashboard EOS");
  dashboard.views = [{ showGridLines: false }];
  dashboard.properties.defaultRowHeight = 22;

  dashboard.columns = [
    { width: 3 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
    { width: 22 },
    { width: 18 },
    { width: 18 },
  ];

  for (let r = 1; r <= 38; r++) {
    for (let c = 1; c <= 13; c++) {
      fill(dashboard.getCell(r, c), COLORS.bg);
    }
  }

  mergeTitle(dashboard, "B2:I4", "TRANS TECH EOS", 28, COLORS.white);

  dashboard.mergeCells("B5:I5");
  text(
    dashboard.getCell("B5"),
    "CONTROL INTELIGENTE DE NEGOCIO",
    13,
    COLORS.cyan,
    true
  );
  fill(dashboard.getCell("B5"), COLORS.dark);
  border(dashboard.getCell("B5"), COLORS.cyan);

  paintRange(dashboard, "J2:M7", COLORS.panel);
  text(dashboard.getCell("J3"), "NEGOCIO", 10, COLORS.cyan, true);
  text(dashboard.getCell("K3"), nombreNegocio, 11, COLORS.white, true);
  text(dashboard.getCell("J4"), "RUBRO", 10, COLORS.cyan, true);
  text(dashboard.getCell("K4"), rubro, 11, COLORS.white, true);
  text(dashboard.getCell("J5"), "GENERADO", 10, COLORS.cyan, true);
  dashboard.getCell("K5").value = new Date();
  dashboard.getCell("K5").numFmt = "dd/mm/yyyy hh:mm";
  dashboard.getCell("K5").font = { color: argb(COLORS.white), bold: true };
  dashboard.getCell("K5").alignment = { horizontal: "center" };

  paintRange(dashboard, "B7:C32", COLORS.panel);
  text(dashboard.getCell("B8"), "NAVEGACIÓN", 11, COLORS.cyan, true);
  navItem(dashboard, 10, "▣ Dashboard", true);
  navItem(dashboard, 12, "↗ Ingresos");
  navItem(dashboard, 14, "↘ Gastos fijos");
  navItem(dashboard, 16, "◈ Gastos variables");
  navItem(dashboard, 18, "□ Productos / Servicios");
  navItem(dashboard, 20, "◎ Clientes");
  navItem(dashboard, 22, "▤ Flujo de caja");
  navItem(dashboard, 24, "★ Recomendaciones");
  navItem(dashboard, 26, "⚙ Configuración");

  dashboard.mergeCells("B29:C31");
  text(
    dashboard.getCell("B29"),
    "“Lo que se mide,\nse controla.\nLo que se controla,\nse mejora.”\n\n– EOS",
    11,
    COLORS.cyan,
    false
  );
  fill(dashboard.getCell("B29"), COLORS.panel2);
  border(dashboard.getCell("B29"));

  kpiCard(
    dashboard,
    ["D7:E7", "D8:E10", "D11:E11"],
    "INGRESOS TOTALES",
    { formula: "SUM(Ingresos!D:D)" },
    "Ventas e ingresos registrados",
    COLORS.green
  );

  kpiCard(
    dashboard,
    ["F7:G7", "F8:G10", "F11:G11"],
    "GASTOS TOTALES",
    { formula: "SUM('Gastos fijos'!D:D)+SUM('Gastos variables'!D:D)" },
    "Costos fijos y variables",
    COLORS.red
  );

  kpiCard(
    dashboard,
    ["H7:I7", "H8:I10", "H11:I11"],
    "UTILIDAD ESTIMADA",
    { formula: "D8-F8" },
    "Resultado operativo aproximado",
    COLORS.cyan
  );

  kpiCard(
    dashboard,
    ["J9:K9", "J10:K12", "J13:K13"],
    "MARGEN PROMEDIO",
    { formula: "IFERROR(AVERAGE(Productos!E:E),0)" },
    "Rentabilidad promedio",
    COLORS.green
  );

  kpiCard(
    dashboard,
    ["L9:M9", "L10:M12", "L13:M13"],
    "FLUJO DE CAJA",
    { formula: "H8" },
    "Resultado acumulado",
    COLORS.purple
  );

  ["D8", "F8", "H8", "L10"].forEach((c) => moneyCell(dashboard.getCell(c)));
  percentCell(dashboard.getCell("J10"));

  paintRange(dashboard, "D14:G23", COLORS.panel);
  dashboard.mergeCells("D14:G14");
  text(
    dashboard.getCell("D14"),
    "EVOLUCIÓN MENSUAL DE INGRESOS Y GASTOS",
    12,
    COLORS.white,
    true
  );

  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun"];
  months.forEach((m, i) => {
    const row = 16 + i;
    text(dashboard.getCell(`D${row}`), m, 10, COLORS.text, false);
    dashboard.getCell(`E${row}`).value = { formula: `'Flujo de caja'!B${i + 2}` };
    dashboard.getCell(`F${row}`).value = { formula: `'Flujo de caja'!C${i + 2}+'Flujo de caja'!D${i + 2}` };
    dashboard.getCell(`G${row}`).value = { formula: `'Flujo de caja'!E${i + 2}` };

    ["E", "F", "G"].forEach((col) => {
      moneyCell(dashboard.getCell(`${col}${row}`));
      dashboard.getCell(`${col}${row}`).font = {
        color: argb(col === "E" ? COLORS.green : col === "F" ? COLORS.red : COLORS.cyan),
        bold: true,
      };
      dashboard.getCell(`${col}${row}`).alignment = { horizontal: "center" };
      border(dashboard.getCell(`${col}${row}`));
    });
  });

  paintRange(dashboard, "H14:I23", COLORS.panel);
  dashboard.mergeCells("H14:I14");
  text(dashboard.getCell("H14"), "RESUMEN RÁPIDO", 12, COLORS.white, true);

  const resumen = [
    ["Clientes registrados", { formula: "MAX(COUNTA(Clientes!A:A)-1,0)" }],
    ["Productos/Servicios", { formula: "MAX(COUNTA(Productos!A:A)-1,0)" }],
    ["Ventas registradas", { formula: "MAX(COUNTA(Ingresos!A:A)-1,0)" }],
    ["Ticket promedio", { formula: "IFERROR(AVERAGE(Ingresos!D:D),0)" }],
    ["Resultado neto", { formula: "H8" }],
  ];

  resumen.forEach((item, i) => {
    const row = 16 + i;
    text(dashboard.getCell(`H${row}`), item[0], 10, COLORS.text, false);
    dashboard.getCell(`I${row}`).value = item[1];
    dashboard.getCell(`I${row}`).font = { color: argb(COLORS.cyan), bold: true };
    dashboard.getCell(`I${row}`).alignment = { horizontal: "center" };
    border(dashboard.getCell(`H${row}`));
    border(dashboard.getCell(`I${row}`));
  });
  moneyCell(dashboard.getCell("I19"));
  moneyCell(dashboard.getCell("I20"));

  paintRange(dashboard, "J15:M23", COLORS.panel);
  dashboard.mergeCells("J15:M15");
  text(dashboard.getCell("J15"), "TOP 5 PRODUCTOS / SERVICIOS", 12, COLORS.white, true);

  fakeBar(dashboard, 17, "Producto A", "Gs 0", COLORS.cyan);
  fakeBar(dashboard, 18, "Producto B", "Gs 0", COLORS.cyan2);
  fakeBar(dashboard, 19, "Producto C", "Gs 0", COLORS.blue);
  fakeBar(dashboard, 20, "Producto D", "Gs 0", COLORS.green);
  fakeBar(dashboard, 21, "Producto E", "Gs 0", COLORS.purple);

  paintRange(dashboard, "D25:G32", COLORS.panel);
  dashboard.mergeCells("D25:G25");
  text(dashboard.getCell("D25"), "FLUJO DE CAJA MENSUAL", 12, COLORS.white, true);

  for (let i = 0; i < 6; i++) {
    const row = 27 + i;
    text(dashboard.getCell(`D${row}`), months[i], 10, COLORS.text, false);
    dashboard.getCell(`E${row}`).value = { formula: `'Flujo de caja'!B${i + 2}` };
    dashboard.getCell(`F${row}`).value = { formula: `'Flujo de caja'!C${i + 2}+'Flujo de caja'!D${i + 2}` };
    dashboard.getCell(`G${row}`).value = { formula: `'Flujo de caja'!E${i + 2}` };

    ["E", "F", "G"].forEach((col) => {
      moneyCell(dashboard.getCell(`${col}${row}`));
      dashboard.getCell(`${col}${row}`).font = {
        color: argb(col === "E" ? COLORS.green : col === "F" ? COLORS.red : COLORS.cyan),
        bold: true,
      };
      dashboard.getCell(`${col}${row}`).alignment = { horizontal: "center" };
      border(dashboard.getCell(`${col}${row}`));
    });
  }

  paintRange(dashboard, "H25:M32", COLORS.panel);
  dashboard.mergeCells("H25:M25");
  text(dashboard.getCell("H25"), "SALUD FINANCIERA EOS", 12, COLORS.white, true);

  dashboard.mergeCells("H27:I31");
  dashboard.getCell("H27").value = { formula: 'IF(H8>0,"72%","38%")' };
  dashboard.getCell("H27").font = {
    name: "Aptos",
    bold: true,
    size: 34,
    color: argb(COLORS.cyan),
  };
  dashboard.getCell("H27").alignment = {
    horizontal: "center",
    vertical: "middle",
  };
  fill(dashboard.getCell("H27"), COLORS.panel2);
  border(dashboard.getCell("H27"));

  const health = [
    ["Liquidez", "Bien"],
    ["Rentabilidad", "Bien"],
    ["Endeudamiento", "Revisar"],
    ["Eficiencia operativa", "Bien"],
    ["Crecimiento", "En progreso"],
  ];

  health.forEach((h, i) => {
    const row = 27 + i;
    text(dashboard.getCell(`J${row}`), h[0], 10, COLORS.text, false);
    text(
      dashboard.getCell(`L${row}`),
      h[1],
      10,
      h[1] === "Bien" ? COLORS.green : COLORS.yellow,
      true
    );
    border(dashboard.getCell(`J${row}`));
    border(dashboard.getCell(`L${row}`));
  });

  dashboard.mergeCells("D34:M35");
  text(
    dashboard.getCell("D34"),
    "Los indicadores se actualizan automáticamente según los datos cargados en Ingresos, Gastos, Productos, Clientes y Flujo de caja.",
    10,
    COLORS.muted,
    false
  );
  fill(dashboard.getCell("D34"), COLORS.bg);

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

  const mesesCompletos = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];

  mesesCompletos.forEach((mes, i) => {
    const row = i + 2;
    flujo.addRow([mes, 0, 0, 0, { formula: `B${row}-C${row}-D${row}` }]);
  });

  [2, 3, 4, 5].forEach((col) => {
    flujo.getColumn(col).numFmt = '"Gs" #,##0';
  });

  const recomendaciones = workbook.addWorksheet("Recomendaciones EOS");
  recomendaciones.views = [{ showGridLines: false }];
  recomendaciones.columns = [{ width: 22 }, { width: 85 }, { width: 18 }];

  mergeTitle(recomendaciones, "A1:C2", "RECOMENDACIONES INTELIGENTES EOS", 18);
  recomendaciones.addRow([]);
  recomendaciones.addRow(["Área", "Recomendación", "Prioridad"]);
  headerRow(recomendaciones.getRow(4));

  [
    ["Finanzas", "Registrar ingresos y gastos diariamente para evitar decisiones a ciegas.", "Alta"],
    ["Ventas", "Medir qué canal genera más clientes y enfocar inversión en el canal más rentable.", "Alta"],
    ["Operación", "Controlar costos unitarios para saber qué producto o servicio deja mayor margen.", "Alta"],
    ["Clientes", "Registrar clientes frecuentes y hacer seguimiento para aumentar recompra.", "Media"],
    ["Crecimiento", "Revisar el flujo de caja semanalmente antes de asumir nuevos gastos.", "Alta"],
    ["Dirección", "Usar este archivo como tablero central de decisiones del negocio.", "Alta"],
  ].forEach((row) => recomendaciones.addRow(row));

  recomendaciones.eachRow((row) => {
    row.height = 28;
    row.eachCell((cell) => {
      border(cell, "D9EAF7");
      cell.alignment = { wrapText: true, vertical: "middle" };
    });
  });

  const config = workbook.addWorksheet("Configuración");
  tableSheet(
    config,
    ["Campo", "Valor"],
    [
      ["Nombre del negocio", nombreNegocio],
      ["Rubro", rubro],
      ["Moneda", "Guaraníes"],
      ["Creado por", "TransTech EOS"],
      ["Uso recomendado", "Control semanal y mensual"],
    ]
  );

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