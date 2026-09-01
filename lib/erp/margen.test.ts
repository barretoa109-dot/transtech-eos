import assert from "node:assert/strict";
import test from "node:test";

import { calcularMargen, sinIva, textoMargen } from "./margen.ts";

// ============================================================
// Lo que este archivo existe para no equivocar
// ============================================================
//
// La cuenta ingenua —precio menos costo— le hace creer a un comerciante que
// gana más de lo que gana, porque el IVA que cobra no es suyo. Sobre esa
// creencia se fijan precios y se toman deudas.

test("el IVA sale de las dos puntas antes de restar", () => {
  // Compra a 70.000 con IVA, vende a 100.000 con IVA. Al 10%:
  //   neto vendido  = 100.000 − 9.091 = 90.909
  //   neto comprado =  70.000 − 6.364 = 63.636
  //   ganancia real = 27.273
  const m = calcularMargen({ costo: 70_000, precio_venta: 100_000, iva: 10 });

  assert.equal(m.conocido, true);
  if (!m.conocido) return;

  assert.equal(m.precio_neto, 90_909);
  assert.equal(m.costo_neto, 63_636);
  assert.equal(m.ganancia, 27_273);
});

test("la resta bruta habría dado 30.000: casi tres mil de más", () => {
  const m = calcularMargen({ costo: 70_000, precio_venta: 100_000, iva: 10 });
  if (!m.conocido) return assert.fail("tendría que conocerse");

  assert.equal(100_000 - 70_000, 30_000);
  assert.ok(m.ganancia < 30_000);
  assert.equal(30_000 - m.ganancia, 2_727);
});

test("margen y marcaje no son lo mismo, y confundirlos es caro", () => {
  const m = calcularMargen({ costo: 70_000, precio_venta: 100_000, iva: 10 });
  if (!m.conocido) return assert.fail("tendría que conocerse");

  // 27.273 sobre 90.909 = 30% de margen.
  assert.equal(Math.round(m.margen), 30);
  // 27.273 sobre 63.636 = 43% sobre el costo.
  assert.equal(Math.round(m.marcaje), 43);
  assert.notEqual(Math.round(m.margen), Math.round(m.marcaje));
});

test("un marcaje del 50% es un margen del 33%", () => {
  // El error de mostrador más común: creer que son el mismo número.
  const m = calcularMargen({ costo: 100_000, precio_venta: 150_000, iva: 10 });
  if (!m.conocido) return assert.fail("tendría que conocerse");

  assert.equal(Math.round(m.marcaje), 50);
  assert.equal(Math.round(m.margen), 33);
});

// ============================================================
// Sin costo no se inventa un margen
// ============================================================

test("un producto sin costo no muestra 100% de margen", () => {
  // Sería un número precioso y completamente falso, y aparecería en todo
  // producto recién creado.
  for (const costo of [null, undefined, 0]) {
    const m = calcularMargen({ costo, precio_venta: 100_000, iva: 10 });
    assert.equal(m.conocido, false);
    if (!m.conocido) assert.equal(m.motivo, "sin-costo");
  }
});

test("sin precio tampoco hay margen, y lo dice distinto", () => {
  const m = calcularMargen({ costo: 50_000, precio_venta: 0, iva: 10 });

  assert.equal(m.conocido, false);
  if (!m.conocido) assert.equal(m.motivo, "sin-precio");
});

test("y el texto dice qué falta cargar, no un error", () => {
  assert.match(
    textoMargen(calcularMargen({ costo: null, precio_venta: 100_000, iva: 10 })),
    /Cargá el costo/,
  );
  assert.match(
    textoMargen(calcularMargen({ costo: 50_000, precio_venta: null, iva: 10 })),
    /Cargá el precio/,
  );
});

// ============================================================
// Vender a pérdida hay que verlo
// ============================================================

test("vender por debajo del costo se marca como pérdida", () => {
  const m = calcularMargen({ costo: 120_000, precio_venta: 100_000, iva: 10 });

  assert.equal(m.conocido, true);
  if (!m.conocido) return;

  assert.equal(m.pierde, true);
  assert.ok(m.ganancia < 0);
  assert.match(textoMargen(m), /Pierde/);
});

test("vender justo al costo no es pérdida, pero no gana nada", () => {
  const m = calcularMargen({ costo: 100_000, precio_venta: 100_000, iva: 10 });
  if (!m.conocido) return assert.fail("tendría que conocerse");

  assert.equal(m.ganancia, 0);
  assert.equal(m.pierde, false);
  assert.equal(m.margen, 0);
});

// ============================================================
// Las tres tasas que existen en Paraguay
// ============================================================

test("al 5% el neto es mayor, y el margen también", () => {
  const diez = calcularMargen({ costo: 70_000, precio_venta: 100_000, iva: 10 });
  const cinco = calcularMargen({ costo: 70_000, precio_venta: 100_000, iva: 5 });
  if (!diez.conocido || !cinco.conocido) return assert.fail("tendrían que conocerse");

  assert.ok(cinco.ganancia > diez.ganancia);
});

test("un producto exento no tiene IVA que sacar: la resta es la bruta", () => {
  const m = calcularMargen({ costo: 70_000, precio_venta: 100_000, iva: 0 });
  if (!m.conocido) return assert.fail("tendría que conocerse");

  assert.equal(m.ganancia, 30_000);
  assert.equal(m.precio_neto, 100_000);
});

test("con la misma tasa en las dos puntas, el porcentaje de margen no cambia", () => {
  // Es una comprobación de que la cuenta es coherente: el IVA cambia la
  // ganancia en guaraníes, no la proporción.
  const diez = calcularMargen({ costo: 70_000, precio_venta: 100_000, iva: 10 });
  const exento = calcularMargen({ costo: 70_000, precio_venta: 100_000, iva: 0 });
  if (!diez.conocido || !exento.conocido) return assert.fail("tendrían que conocerse");

  assert.equal(Math.round(diez.margen), Math.round(exento.margen));
});

// ============================================================
// Bordes
// ============================================================

test("sinIva coincide con la cuenta del comprobante", () => {
  assert.equal(sinIva(11_000, 10), 10_000);
  assert.equal(sinIva(21_000, 5), 20_000);
  assert.equal(sinIva(50_000, 0), 50_000);
});

test("un monto grande no pierde precisión", () => {
  const m = calcularMargen({ costo: 300_000_000, precio_venta: 385_000_000, iva: 10 });
  if (!m.conocido) return assert.fail("tendría que conocerse");

  assert.ok(Number.isSafeInteger(m.precio_neto));
  assert.ok(Number.isSafeInteger(m.costo_neto));
  assert.equal(m.ganancia, m.precio_neto - m.costo_neto);
});

test("el texto usa coma decimal y un solo decimal", () => {
  const m = calcularMargen({ costo: 70_000, precio_venta: 100_000, iva: 10 });
  const texto = textoMargen(m);

  assert.ok(!texto.includes("."), `usó punto decimal: ${texto}`);
  assert.match(texto, /% de margen/);
});
