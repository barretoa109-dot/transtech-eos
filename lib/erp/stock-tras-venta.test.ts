import assert from "node:assert/strict";
import { test } from "node:test";

import { avisoDeStockTrasVenta } from "./stock-tras-venta.ts";
import type { ProductoAgotable, SalidaDeStock } from "./agotamiento.ts";

const HOY = "2026-09-27";

const producto = (p: Partial<ProductoAgotable>): ProductoAgotable => ({
  id: "p1",
  nombre: "Balanceado",
  stock_actual: 10,
  stock_minimo: 0,
  controla_stock: true,
  activo: true,
  ...p,
});

/** `n` salidas de `cantidad` cada una, en los últimos días. */
const salidas = (n: number, cantidad: number, id = "p1"): SalidaDeStock[] =>
  Array.from({ length: n }, (_, i) => ({ producto_id: id, fecha: `2026-09-${String(26 - i).padStart(2, "0")}`, cantidad }));

test("la última unidad vendida avisa que se quedó sin stock", () => {
  const aviso = avisoDeStockTrasVenta({
    hoy: HOY,
    productos: [producto({ stock_actual: 0 })],
    salidas: [],
    vendidos: new Map([["p1", 2]]),
  });
  assert.equal(aviso, "Te quedaste sin “Balanceado”: esa era la última.");
});

test("cruzar el mínimo avisa una vez; si ya estaba abajo, no se repite", () => {
  const cruza = avisoDeStockTrasVenta({
    hoy: HOY,
    productos: [producto({ stock_actual: 4, stock_minimo: 5 })],
    salidas: [],
    vendidos: new Map([["p1", 3]]),
  });
  assert.equal(cruza, "“Balanceado” quedó en 4 unidades, por debajo de tu mínimo de 5.");

  const yaEstaba = avisoDeStockTrasVenta({
    hoy: HOY,
    productos: [producto({ stock_actual: 3, stock_minimo: 5 })],
    salidas: [],
    vendidos: new Map([["p1", 1]]),
  });
  assert.equal(yaEstaba, "");
});

test("al ritmo del mes: avisa cuando esta venta lo baja de 7 días", () => {
  // 30 salidas de 2 en el mes = 2 por día. Antes: 20 → 10 días. Después: 12 → 6 días.
  const aviso = avisoDeStockTrasVenta({
    hoy: HOY,
    productos: [producto({ stock_actual: 12 })],
    salidas: salidas(30, 2),
    vendidos: new Map([["p1", 8]]),
  });
  assert.equal(aviso, "Al ritmo de este mes, “Balanceado” te dura unos 6 días (te quedan 12 unidades).");
});

test("si ya le quedaban pocos días antes de esta venta, no se repite", () => {
  // 2 por día. Antes: 12 → 6 días. Después: 10 → 5 días. Ya estaba bajo 7.
  const aviso = avisoDeStockTrasVenta({
    hoy: HOY,
    productos: [producto({ stock_actual: 10 })],
    salidas: salidas(30, 2),
    vendidos: new Map([["p1", 2]]),
  });
  assert.equal(aviso, "");
});

test("sin ritmo suficiente, sin control de stock o sin venta de ese producto: silencio", () => {
  const base = { hoy: HOY, vendidos: new Map([["p1", 8]]) };
  // Dos salidas no son un ritmo (MIN_SALIDAS = 3).
  assert.equal(avisoDeStockTrasVenta({ ...base, productos: [producto({ stock_actual: 1 })], salidas: salidas(2, 30) }), "");
  assert.equal(
    avisoDeStockTrasVenta({ ...base, productos: [producto({ stock_actual: 0, controla_stock: false })], salidas: [] }),
    "",
  );
  assert.equal(
    avisoDeStockTrasVenta({ hoy: HOY, vendidos: new Map(), productos: [producto({ stock_actual: 0 })], salidas: [] }),
    "",
  );
});
