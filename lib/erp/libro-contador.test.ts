import test from "node:test";
import assert from "node:assert/strict";

import { armarLibro, filaDeDocumento, type DocumentoLeido } from "./libro-contador.ts";

const venta = (extra: Partial<DocumentoLeido> = {}): DocumentoLeido => ({
  id: "v1",
  fecha: "2026-09-10",
  moneda: "PYG",
  condicion: "contado",
  estado: "confirmada",
  total: 330000,
  contacto: { nombre: "Ferretería San José", ruc: "80012345", ruc_dv: 6 },
  items: [
    { iva: 10, total: 220000 },
    { iva: 5, total: 105000 },
    { iva: 0, total: 5000 },
  ],
  ...extra,
});

test("desglosa el IVA incluido por tasa, como la venta", () => {
  const f = filaDeDocumento(venta(), false);
  assert.equal(f.total10, 220000);
  assert.equal(f.iva10, 20000);
  assert.equal(f.total5, 105000);
  assert.equal(f.iva5, 5000);
  assert.equal(f.exentas, 5000);
  assert.equal(f.total, 330000);
  assert.equal(f.ruc, "80012345-6");
  assert.equal(f.condicion, "Contado");
});

test("sin renglones, todo va al 10 %; sin cliente, consumidor final", () => {
  const f = filaDeDocumento(venta({ items: [], contacto: null, total: 110000 }), false);
  assert.equal(f.total10, 110000);
  assert.equal(f.iva10, 10000);
  assert.equal(f.contacto, "Consumidor final");
});

test("una compra sin comprobante no da crédito fiscal, y se avisa", () => {
  const libro = armarLibro({
    desde: "2026-09-01",
    hasta: "2026-09-30",
    ventas: [venta()],
    compras: [
      venta({ id: "c1", numero_comprobante: "001-001-0000123", items: [{ iva: 10, total: 110000 }] }),
      venta({ id: "c2", numero_comprobante: null, items: [{ iva: 10, total: 55000 }] }),
    ],
    movimientos: [],
  });
  const [mes] = libro.meses;
  assert.equal(mes.ivaDebito, 25000);
  assert.equal(mes.ivaCredito, 10000);
  assert.equal(mes.ivaSinComprobante, 5000);
  assert.equal(mes.ivaAPagar, 15000);
  assert.ok(libro.avisos.some((a) => a.startsWith("1 compra(s) sin número de comprobante")));
});

test("lo cobrado es el contado del mes más los cobros de crédito que entraron", () => {
  const libro = armarLibro({
    desde: "2026-08-01",
    hasta: "2026-09-30",
    ventas: [
      venta({ id: "v1", fecha: "2026-08-20", condicion: "credito", items: [{ iva: 10, total: 500000 }] }),
      venta({ id: "v2", fecha: "2026-09-05", items: [{ iva: 10, total: 100000 }] }),
    ],
    compras: [],
    movimientos: [
      { fecha: "2026-09-15", monto: 200000, moneda: "PYG", venta_id: "v1", compra_id: null, nota: "a cuenta" },
    ],
  });
  const porMes = Object.fromEntries(libro.meses.map((m) => [m.mes, m]));
  assert.equal(porMes["2026-08"].ventas, 500000);
  assert.equal(porMes["2026-08"].cobrado, 0, "a crédito no entra plata");
  assert.equal(porMes["2026-09"].cobrado, 300000, "100.000 al contado + 200.000 cobrados");
  assert.equal(libro.movimientos[0].contacto, "Ferretería San José");
});

test("lo anulado, lo de otra moneda y lo de afuera del período no se suman", () => {
  const libro = armarLibro({
    desde: "2026-09-01",
    hasta: "2026-09-30",
    ventas: [
      venta({ id: "v1" }),
      venta({ id: "v2", estado: "anulada" }),
      venta({ id: "v3", moneda: "USD" }),
      venta({ id: "v4", fecha: "2026-10-01" }),
    ],
    compras: [],
    movimientos: [],
  });
  assert.equal(libro.ventas.length, 1);
  assert.equal(libro.meses[0].ventas, 330000);
  assert.ok(libro.avisos.some((a) => a.includes("anulada")));
  assert.ok(libro.avisos.some((a) => a.includes("USD")));
});

test("un período vacío lo dice en vez de entregar un archivo en blanco", () => {
  const libro = armarLibro({ desde: "2026-09-01", hasta: "2026-09-30", ventas: [], compras: [], movimientos: [] });
  assert.deepEqual(libro.meses, []);
  assert.ok(libro.avisos.includes("No hay ventas ni compras cargadas en este período."));
});

test("el Excel sale con sus cuatro hojas y los importes como números", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const { crearExcelContador } = await import("./libro-contador-excel.ts");
  const libro = armarLibro({
    desde: "2026-09-01",
    hasta: "2026-09-30",
    ventas: [venta()],
    compras: [venta({ id: "c1", numero_comprobante: null, items: [{ iva: 10, total: 55000 }] })],
    movimientos: [],
  });
  const buffer = await crearExcelContador(libro, "Ferretería Prueba");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.deepEqual(
    wb.worksheets.map((h) => h.name),
    ["Resumen", "Ventas", "Compras", "Cobros y pagos a crédito"],
  );
  const ventas = wb.getWorksheet("Ventas")!;
  assert.equal(ventas.getRow(2).getCell(7).value, 20000, "IVA 10 % como número");
  assert.equal(wb.getWorksheet("Compras")!.getRow(2).getCell(12).value, "No: falta el comprobante");
});
