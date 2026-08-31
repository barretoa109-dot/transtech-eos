import assert from "node:assert/strict";
import test from "node:test";

import {
  detectarRiesgosNegocio,
  redactarRiesgoNegocio,
  type ProductoStock,
  type VentaACobrar,
} from "./riesgos-negocio.ts";
import { formatearMonto } from "../finanzas/formato.ts";

const HOY = "2026-08-31";

function producto(parcial: Partial<ProductoStock> & { id: string }): ProductoStock {
  return {
    nombre: `Producto ${parcial.id}`,
    stock_actual: 10,
    stock_minimo: 3,
    controla_stock: true,
    activo: true,
    ...parcial,
  };
}

function venta(parcial: Partial<VentaACobrar> & { id: string }): VentaACobrar {
  return { fecha: "2026-08-01", total: 100_000, moneda: "PYG", ...parcial };
}

// ============================================================
// Que no avise cuando no pasa nada
// ============================================================
//
// Es la respuesta más frecuente y la más importante: un detector que encuentra
// algo todos los días es ruido.

test("sin nada abajo del mínimo y sin cobros viejos, no hay riesgos", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "a" }), producto({ id: "b", stock_actual: 4, stock_minimo: 3 })],
    ventasACobrar: [venta({ id: "v1", fecha: "2026-08-25" })],
  });

  assert.deepEqual(riesgos, []);
});

test("un servicio no puede faltar, aunque su saldo diga cero", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "s", stock_actual: 0, controla_stock: false })],
    ventasACobrar: [],
  });

  assert.deepEqual(riesgos, []);
});

test("un producto dado de baja no genera aviso", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "x", stock_actual: 0, activo: false })],
    ventasACobrar: [],
  });

  assert.deepEqual(riesgos, []);
});

// ============================================================
// Inventario bajo
// ============================================================

test("avisa de lo que está en el mínimo o por debajo, lo más urgente primero", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [
      producto({ id: "a", nombre: "Harina", stock_actual: 3, stock_minimo: 3 }),
      producto({ id: "b", nombre: "Levadura", stock_actual: 0, stock_minimo: 2 }),
      producto({ id: "c", nombre: "Azúcar", stock_actual: 50 }),
    ],
    ventasACobrar: [],
  });

  assert.equal(riesgos.length, 1);
  const bajo = riesgos[0];
  if (bajo.tipo !== "inventario_bajo") return assert.fail("tipo equivocado");

  assert.deepEqual(
    bajo.productos.map((p) => p.nombre),
    ["Levadura", "Harina"],
  );
});

test("solo se nombran cinco, pero la clave los cuenta a todos", () => {
  const muchos = Array.from({ length: 8 }, (_, i) =>
    producto({ id: `p${i}`, stock_actual: 0, stock_minimo: 1 }),
  );

  const riesgos = detectarRiesgosNegocio({ hoy: HOY, productos: muchos, ventasACobrar: [] });
  const bajo = riesgos[0];
  if (bajo.tipo !== "inventario_bajo") return assert.fail("tipo equivocado");

  assert.equal(bajo.productos.length, 5);
  assert.equal(bajo.clave.split(",").length, 8);
});

// ============================================================
// La clave es lo que frena la repetición
// ============================================================

test("los mismos productos dan la misma clave, en cualquier orden", () => {
  const a = producto({ id: "a", stock_actual: 0, stock_minimo: 1 });
  const b = producto({ id: "b", stock_actual: 0, stock_minimo: 1 });

  const uno = detectarRiesgosNegocio({ hoy: HOY, productos: [a, b], ventasACobrar: [] })[0];
  const otro = detectarRiesgosNegocio({ hoy: HOY, productos: [b, a], ventasACobrar: [] })[0];

  assert.equal(uno.clave, otro.clave);
});

test("un producto nuevo en la lista sí cambia la clave: eso es una noticia", () => {
  const a = producto({ id: "a", stock_actual: 0, stock_minimo: 1 });
  const b = producto({ id: "b", stock_actual: 0, stock_minimo: 1 });

  const antes = detectarRiesgosNegocio({ hoy: HOY, productos: [a], ventasACobrar: [] })[0];
  const despues = detectarRiesgosNegocio({ hoy: HOY, productos: [a, b], ventasACobrar: [] })[0];

  assert.notEqual(antes.clave, despues.clave);
});

// ============================================================
// Cobros demorados
// ============================================================

test("una venta de hace menos de treinta días todavía no es noticia", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [venta({ id: "v", fecha: "2026-08-10" })],
  });

  assert.deepEqual(riesgos, []);
});

test("avisa de las que pasaron el plazo, con la más vieja adelante", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [
      venta({ id: "v1", fecha: "2026-07-01", total: 500_000 }),
      venta({ id: "v2", fecha: "2026-07-15", total: 300_000 }),
      venta({ id: "v3", fecha: "2026-08-29", total: 900_000 }),
    ],
  });

  assert.equal(riesgos.length, 1);
  const cobros = riesgos[0];
  if (cobros.tipo !== "cobros_demorados") return assert.fail("tipo equivocado");

  assert.equal(cobros.cantidad, 2);
  assert.equal(cobros.total, 800_000);
  assert.equal(cobros.dias_de_la_mas_vieja, 61);
});

test("cada moneda tiene su propio aviso: no se suman", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [
      venta({ id: "a", fecha: "2026-07-01", total: 5_000_000, moneda: "PYG" }),
      venta({ id: "b", fecha: "2026-07-01", total: 400, moneda: "USD" }),
    ],
  });

  assert.equal(riesgos.length, 2);

  const totales = riesgos.map((r) => (r.tipo === "cobros_demorados" ? r.total : 0));
  assert.ok(totales.includes(5_000_000));
  assert.ok(totales.includes(400));
  // El número que no puede existir.
  assert.ok(!totales.includes(5_000_400));
});

// ============================================================
// El texto tiene que servir para actuar
// ============================================================

test("el aviso de stock nombra el producto y sus dos números", () => {
  const riesgo = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "a", nombre: "Harina", stock_actual: 1, stock_minimo: 5 })],
    ventasACobrar: [],
  })[0];

  const texto = redactarRiesgoNegocio(riesgo, formatearMonto);

  assert.match(texto, /Harina/);
  assert.match(texto, /1 de 5/);
});

test("el aviso de cobros dice cuánto y desde hace cuánto", () => {
  const riesgo = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [venta({ id: "v", fecha: "2026-07-01", total: 1_200_000 })],
  })[0];

  const texto = redactarRiesgoNegocio(riesgo, formatearMonto);

  assert.match(texto, /Una venta a crédito lleva/);
  assert.match(texto, /1\.200\.000/);
  assert.match(texto, /61 días/);
});
