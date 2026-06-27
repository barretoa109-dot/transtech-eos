export async function crearExcelRestaurante(workbook) {
  const sheet = workbook.addWorksheet("Dashboard");

  sheet.columns = [
    { width: 28 },
    { width: 20 },
    { width: 20 },
  ];

  sheet.getCell("A1").value = "TransTech EOS";
  sheet.getCell("A2").value = "Dashboard empresarial para restaurante";

  sheet.getCell("A4").value = "Ventas del mes";
  sheet.getCell("B4").value = 0;

  sheet.getCell("A5").value = "Gastos del mes";
  sheet.getCell("B5").value = 0;

  sheet.getCell("A6").value = "Ganancia estimada";
  sheet.getCell("B6").value = { formula: "B4-B5" };

  sheet.getCell("A8").value = "Estado";
  sheet.getCell("B8").value = "Inicial";

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.font = { name: "Arial", size: 11 };
    });
  });

  sheet.getCell("A1").font = { name: "Arial", size: 18, bold: true };
  sheet.getCell("A2").font = { name: "Arial", size: 12, italic: true };

  return workbook;
}