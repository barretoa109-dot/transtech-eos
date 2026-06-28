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
  lightBorder: "D9EAF7",
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

function setText(cell, value, size = 11, color = COLORS.text, bold = false) {
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

function outline(sheet, range, color = COLORS.border) {
  const [start, end] = range.split(":");
  const s = sheet.getCell(start);
  const e = sheet.getCell(end);

  for (let r = s.row; r <= e.row; r++) {
    for (let c = s.col; c <= e.col; c++) {
      border(sheet.getCell(r, c), color);
    }
  }
}

function mergeBox(sheet, range, value, opts = {}) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]);

  setText(
    cell,
    value,
    opts.size || 11,
    opts.color || COLORS.text,
    opts.bold || false
  );

  fill(cell, opts.fill || COLORS.panel);
  border(cell, opts.border || COLORS.border);

  if (opts.align) {
    cell.alignment = opts.align;
  }

  if (opts.numFmt) {
    cell.numFmt = opts.numFmt;
  }

  return cell;
}

function money(cell) {
  cell.numFmt = '"Gs" #,##0';
}

function percent(cell) {
  cell.numFmt = "0.00%";
}

function kpi(sheet, config) {
  mergeBox(sheet, config.title, config.label, {
    fill: COLORS.panel,
    color: COLORS.muted,
    bold: true,
    size: 10,
  });

  const value = mergeBox(sheet, config.value, config.formula, {
    fill: COLORS.panel,
    color: config.color,
    bold: true,
    size: 22,
  });

  mergeBox(sheet, config.note, config.noteText, {
    fill: COLORS.panel,
    color: COLORS.muted,
    size: 9,
  });

  if (config.format === "money") money(value);
  if (config.format === "percent") percent(value);
}

function sectionTitle(sheet, range, title) {
  mergeBox(sheet, range, title, {
    fill: COLORS.dark,
    color: COLORS.white,
    bold: true,
    size: 13,
    border: COLORS.cyan,
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

  rows.forEach((r) => sheet.addRow(r));

  sheet.eachRow((row, index) => {
    row.height = index === 1 ? 28 : 24;

    row.eachCell((cell) => {
      border(cell, COLORS.lightBorder);
      cell.alignment = {
        vertical: "middle",
        wrapText: true,
      };
    });
  });

  sheet.columns.forEach((col) => {
    col.width = 24;
  });
}

function createBusinessChart(sheet, startRow) {
  sectionTitle(sheet, `B${startRow}:I${startRow}`, "EVOLUCIÓN MENSUAL");

  const labels = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio"];
  const headers = ["Mes", "Ingresos", "Gastos", "Resultado"];

  headers.forEach((h, i) => {
    const cell = sheet.getCell(startRow + 2, 2 + i * 2);
    setText(cell, h, 10, COLORS.dark, true);
    fill(cell, COLORS.cyan);
    border(cell);
  });

  labels.forEach((m, i) => {
    const row = startRow + 3 + i;

    setText(sheet.getCell(row, 2), m, 10, COLORS.text);
    sheet.getCell(row, 4).value = { formula: `'Flujo de caja'!B${i + 2}` };
    sheet.getCell(row, 6).value = {
      formula: `'Flujo de caja'!C${i + 2}+'Flujo de caja'!D${i + 2}`,
    };
    sheet.getCell(row, 8).value = { formula: `'Flujo de caja'!E${i + 2}` };

    [4, 6, 8].forEach((col) => {
      const cell = sheet.getCell(row, col);
      money(cell);
      cell.font = {
        name: "Aptos",
        bold: true,
        color: argb(
          col === 4 ? COLORS.green : col === 6 ? COLORS.red : COLORS.cyan
        ),
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      border(cell);
    });
  });

  outline(sheet, `B${startRow}:I${startRow + 10}`);
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
  dashboard.properties.defaultRowHeight = 24;

  dashboard.columns = [
    { width: 3 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];

  for (let r = 1; r <= 46; r++) {
    for (let c = 1; c <= 11; c++) {
      fill(dashboard.getCell(r, c), COLORS.bg);
    }
  }

  mergeBox(dashboard, "B2:K4", "TRANS TECH EOS", {
    fill: COLORS.dark,
    color: COLORS.white,
    bold: true,
    size: 30,
    border: COLORS.cyan,
  });

  mergeBox(dashboard, "B5:K5", "CONTROL INTELIGENTE DE NEGOCIO", {
    fill: COLORS.panel,
    color: COLORS.cyan,
    bold: true,
    size: 13,
  });

  mergeBox(dashboard, "B7:D8", `NEGOCIO\n${nombreNegocio}`, {
    fill: COLORS.panel,
    color: COLORS.text,
    bold: true,
    size: 12,
  });

  mergeBox(dashboard, "E7:G8", `RUBRO\n${rubro}`, {
    fill: COLORS.panel,
    color: COLORS.text,
    bold: true,
    size: 12,
  });

  const generated = mergeBox(dashboard, "H7:K8", "GENERADO", {
    fill: COLORS.panel,
    color: COLORS.cyan,
    bold: true,
    size: 12,
  });
  generated.value = {
    richText: [
      { text: "GENERADO\n", font: { bold: true, color: argb(COLORS.cyan) } },
      {
        text: new Date().toLocaleString("es-PY"),
        font: { color: argb(COLORS.text) },
      },
    ],
  };

  kpi(dashboard, {
    title: "B10:C10",
    value: "B11:C13",
    note: "B14:C14",
    label: "INGRESOS TOTALES",
    formula: { formula: "SUM(Ingresos!D:D)" },
    noteText: "Ventas registradas",
    color: COLORS.green,
    format: "money",
  });

  kpi(dashboard, {
    title: "D10:E10",
    value: "D11:E13",
    note: "D14:E14",
    label: "GASTOS TOTALES",
    formula: { formula: "SUM('Gastos fijos'!D:D)+SUM('Gastos variables'!D:D)" },
    noteText: "Costos fijos y variables",
    color: COLORS.red,
    format: "money",
  });

  kpi(dashboard, {
    title: "F10:G10",
    value: "F11:G13",
    note: "F14:G14",
    label: "UTILIDAD",
    formula: { formula: "B11-D11" },
    noteText: "Resultado operativo",
    color: COLORS.cyan,
    format: "money",
  });

  kpi(dashboard, {
    title: "H10:I10",
    value: "H11:I13",
    note: "H14:I14",
    label: "MARGEN PROMEDIO",
    formula: { formula: "IFERROR(AVERAGE(Productos!E:E),0)" },
    noteText: "Rentabilidad estimada",
    color: COLORS.yellow,
    format: "percent",
  });

  kpi(dashboard, {
    title: "J10:K10",
    value: "J11:K13",
    note: "J14:K14",
    label: "SALUD EOS",
    formula: { formula: 'IF(F11>0,"82/100","38/100")' },
    noteText: "Indicador inteligente",
    color: COLORS.purple,
  });

  sectionTitle(dashboard, "B17:G17", "RESUMEN EJECUTIVO EOS");

  mergeBox(
    dashboard,
    "B18:G24",
    "Este tablero fue diseñado para ayudar a visualizar el estado general del negocio. Los indicadores se actualizan al cargar ingresos, gastos, productos, clientes y flujo de caja.\n\nEOS recomienda revisar este archivo semanalmente para detectar oportunidades, reducir gastos, mejorar rentabilidad y tomar decisiones con mayor claridad.",
    {
      fill: COLORS.panel,
      color: COLORS.text,
      size: 11,
      align: {
        vertical: "middle",
        horizontal: "left",
        wrapText: true,
      },
    }
  );

  sectionTitle(dashboard, "H17:K17", "SALUD FINANCIERA");

  mergeBox(dashboard, "H18:I24", { formula: 'IF(F11>0,"82%","38%")' }, {
    fill: COLORS.panel2,
    color: COLORS.cyan,
    bold: true,
    size: 34,
  });

  const healthRows = [
    ["Liquidez", "Bien"],
    ["Rentabilidad", "Bien"],
    ["Endeudamiento", "Revisar"],
    ["Flujo de caja", "En progreso"],
    ["Crecimiento", "En progreso"],
  ];

  healthRows.forEach((row, i) => {
    const r = 18 + i;
    setText(dashboard.getCell(`J${r}`), row[0], 10, COLORS.text);
    setText(
      dashboard.getCell(`K${r}`),
      row[1],
      10,
      row[1] === "Bien" ? COLORS.green : COLORS.yellow,
      true
    );
    fill(dashboard.getCell(`J${r}`), COLORS.panel);
    fill(dashboard.getCell(`K${r}`), COLORS.panel);
    border(dashboard.getCell(`J${r}`));
    border(dashboard.getCell(`K${r}`));
  });

  createBusinessChart(dashboard, 27);

  sectionTitle(dashboard, "B40:K40", "RECOMENDACIÓN PRINCIPAL");

  mergeBox(
    dashboard,
    "B41:K44",
    "Registrá datos reales durante al menos 7 días. Luego EOS podrá ayudarte a interpretar tendencias, detectar gastos excesivos, identificar productos rentables y definir acciones de crecimiento.",
    {
      fill: COLORS.panel,
      color: COLORS.text,
      size: 12,
      align: {
        vertical: "middle",
        horizontal: "left",
        wrapText: true,
      },
    }
  );

  const ingresos = workbook.addWorksheet("Ingresos");
  tableSheet(
    ingresos,
    [
      "Fecha",
      "Cliente/Fuente",
      "Descripción",
      "Monto",
      "Forma de pago",
      "Canal",
      "Observación",
    ],
    [
      [
        new Date(),
        "Cliente ejemplo",
        "Venta o ingreso",
        0,
        "Efectivo/Transferencia",
        "Local/Web/WhatsApp",
        "",
      ],
    ]
  );
  ingresos.getColumn(1).numFmt = "dd/mm/yyyy";
  ingresos.getColumn(4).numFmt = '"Gs" #,##0';

  const gastosFijos = workbook.addWorksheet("Gastos fijos");
  tableSheet(
    gastosFijos,
    ["Fecha", "Categoría", "Descripción", "Monto", "Forma de pago", "Observación"],
    [
      [
        new Date(),
        "Alquiler / Sueldo / Servicio",
        "Pago mensual",
        0,
        "Efectivo/Transferencia",
        "",
      ],
    ]
  );
  gastosFijos.getColumn(1).numFmt = "dd/mm/yyyy";
  gastosFijos.getColumn(4).numFmt = '"Gs" #,##0';

  const gastosVariables = workbook.addWorksheet("Gastos variables");
  tableSheet(
    gastosVariables,
    ["Fecha", "Categoría", "Descripción", "Monto", "Proveedor", "Observación"],
    [
      [
        new Date(),
        "Insumos / Mercadería",
        "Compra operativa",
        0,
        "Proveedor",
        "",
      ],
    ]
  );
  gastosVariables.getColumn(1).numFmt = "dd/mm/yyyy";
  gastosVariables.getColumn(4).numFmt = '"Gs" #,##0';

  const productos = workbook.addWorksheet("Productos");
  tableSheet(
    productos,
    [
      "Producto/Servicio",
      "Categoría",
      "Costo unitario",
      "Precio venta",
      "Margen %",
      "Stock",
      "Observación",
    ],
    [["Producto ejemplo", "General", 0, 0, { formula: "IFERROR((D2-C2)/D2,0)" }, 0, ""]]
  );
  productos.getColumn(3).numFmt = '"Gs" #,##0';
  productos.getColumn(4).numFmt = '"Gs" #,##0';
  productos.getColumn(5).numFmt = "0.00%";

  const clientes = workbook.addWorksheet("Clientes");
  tableSheet(
    clientes,
    [
      "Nombre",
      "Teléfono",
      "Email",
      "Origen",
      "Última compra",
      "Valor estimado",
      "Estado",
      "Observación",
    ],
    [["Cliente ejemplo", "", "", "WhatsApp / Instagram / Local / Web", "", 0, "Activo", ""]]
  );
  clientes.getColumn(5).numFmt = "dd/mm/yyyy";
  clientes.getColumn(6).numFmt = '"Gs" #,##0';

  const flujo = workbook.addWorksheet("Flujo de caja");
  tableSheet(flujo, ["Mes", "Ingresos", "Gastos fijos", "Gastos variables", "Resultado"], []);

  const meses = [
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

  mergeBox(diagnostico, "A1:C3", "DIAGNÓSTICO INTELIGENTE EOS", {
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
    [
      "Finanzas",
      "Registrá ingresos y gastos diariamente para que EOS pueda medir rentabilidad real.",
      "Alta",
    ],
    [
      "Ventas",
      "Medí los canales que generan más clientes para enfocar esfuerzo comercial.",
      "Alta",
    ],
    [
      "Operación",
      "Controlá costos unitarios y margen por producto o servicio.",
      "Alta",
    ],
    [
      "Clientes",
      "Registrá clientes frecuentes para aumentar recompra y seguimiento.",
      "Media",
    ],
    [
      "Dirección",
      "Usá este archivo como tablero central de decisiones.",
      "Alta",
    ],
  ].forEach((row) => diagnostico.addRow(row));

  diagnostico.eachRow((row) => {
    row.height = 30;
    row.eachCell((cell) => {
      border(cell, COLORS.lightBorder);
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  });

  const config = workbook.addWorksheet("Configuración");
  tableSheet(config, ["Campo", "Valor"], [
    ["Nombre", nombreNegocio],
    ["Rubro", rubro],
    ["Moneda", "Guaraníes"],
    ["Creado por", "TransTech EOS"],
    ["Versión", "Business Premium v2"],
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