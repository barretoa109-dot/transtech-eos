import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import { crearExcelDocumento } from "./excel.ts";
import type { Documento } from "./especificacion.ts";

/**
 * Caso real, 31/10/2026: un documento con una tabla por sección (como pide el
 * modelo para un negocio con varias proyecciones) deja cada tabla en su
 * propia hoja ("una tabla, una hoja"). El título de la sección, en el
 * Resumen, quedaba sin nada debajo — la tabla estaba en otra pestaña, pero
 * nada lo decía — y la persona interpretó el documento como incompleto.
 */
const DOCUMENTO: Documento = {
  titulo: "Varias secciones con tabla",
  moneda: "PYG",
  generadoEl: "2026-10-31",
  bloques: [
    { tipo: "titulo", texto: "Costo del balanceado", nivel: 1 },
    {
      tipo: "tabla",
      titulo: "Costo del balanceado por kg",
      columnas: [
        { titulo: "Concepto", tipo: "texto" },
        { titulo: "Monto", tipo: "dinero" },
      ],
      filas: [["Bolsa de 25 kg", 58_000]],
    },
    { tipo: "titulo", texto: "Plan de manejo recomendado", nivel: 1 },
    { tipo: "lista", ordenada: false, items: ["Pesar semanalmente", "Separar por lote"] },
  ],
};

test("el título de una sección con tabla enlaza a la hoja de esa tabla", async () => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await crearExcelDocumento(DOCUMENTO));

  const resumen = libro.getWorksheet("Resumen");
  assert.ok(resumen, "debe existir una hoja de Resumen");

  const nombresDeHoja = libro.worksheets.map((h) => h.name);
  assert.ok(
    nombresDeHoja.includes("Costo del balanceado por kg"),
    "la tabla tiene que vivir en su propia hoja",
  );

  // Buscar, en la columna B del Resumen, la celda con el enlace a esa hoja.
  let encontrado = false;
  resumen!.eachRow((fila) => {
    const celda = fila.getCell(2);
    const valor = celda.value as { hyperlink?: string; text?: string } | null;
    if (valor && typeof valor === "object" && typeof valor.hyperlink === "string") {
      assert.equal(valor.hyperlink, "#'Costo del balanceado por kg'!A1");
      assert.match(String(valor.text), /Costo del balanceado por kg/);
      encontrado = true;
    }
  });
  assert.ok(encontrado, "el título de la sección tiene que traer un enlace a su tabla");
});

test("un título sin tabla detrás no trae enlace (la lista, por ejemplo)", async () => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await crearExcelDocumento(DOCUMENTO));

  const resumen = libro.getWorksheet("Resumen")!;
  let filaDelSegundoTitulo = -1;
  resumen.eachRow((fila, numero) => {
    if (fila.getCell(2).value === "Plan de manejo recomendado") filaDelSegundoTitulo = numero;
  });
  assert.notEqual(filaDelSegundoTitulo, -1);

  const siguiente = resumen.getCell(`B${filaDelSegundoTitulo + 1}`).value;
  assert.notEqual(
    typeof siguiente === "object" && siguiente !== null && "hyperlink" in siguiente,
    true,
  );
});
