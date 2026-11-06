import assert from "node:assert/strict";
import { test } from "node:test";

import { detectarPreciosDesalineados, type ProductoConPrecio } from "./precio-sugerido.ts";

/**
 * Catálogo base: 5 productos con margen neto del 33% (cuesta 100.000, se
 * vende a 150.000, ambos con IVA 10% ya incluido). Es el "típico" contra el
 * que se compara el producto desalineado de cada test.
 */
function catalogoSano(): ProductoConPrecio[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `sano-${i}`,
    nombre: `Producto sano ${i}`,
    precio_venta: 150_000,
    costo: 100_000,
    iva: 10 as const,
    moneda: "PYG",
  }));
}

test("detectarPreciosDesalineados: un producto muy por debajo del margen típico, se detecta", () => {
  const productos = [
    ...catalogoSano(),
    { id: "barato", nombre: "El que quedó atrás", precio_venta: 105_000, costo: 100_000, iva: 10 as const, moneda: "PYG" },
  ];

  const resultado = detectarPreciosDesalineados(productos);

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].id, "barato");
  assert.ok(resultado[0].margen_actual < resultado[0].margen_tipico * 0.5);
});

test("detectarPreciosDesalineados: el precio sugerido vuelve a dejar el margen típico", () => {
  const productos = [
    ...catalogoSano(),
    { id: "barato", nombre: "El que quedó atrás", precio_venta: 105_000, costo: 100_000, iva: 10 as const, moneda: "PYG" },
  ];

  const [sugerido] = detectarPreciosDesalineados(productos);
  assert.ok(sugerido.precio_sugerido > sugerido.precio_actual);

  // Con el precio sugerido, el margen vuelve a dar (cerca de) el típico.
  const costoNeto = 100_000 / 1.1;
  const precioNetoSugerido = sugerido.precio_sugerido / 1.1;
  const margenRecalculado = ((precioNetoSugerido - costoNeto) / precioNetoSugerido) * 100;
  assert.ok(Math.abs(margenRecalculado - sugerido.margen_tipico) < 1);
});

test("detectarPreciosDesalineados: catálogo parejo, no avisa nada", () => {
  assert.deepEqual(detectarPreciosDesalineados(catalogoSano()), []);
});

test("detectarPreciosDesalineados: menos de 5 productos con margen conocido, no avisa (dato frágil)", () => {
  const productos = [
    { id: "a", nombre: "A", precio_venta: 150_000, costo: 100_000, iva: 10 as const, moneda: "PYG" },
    { id: "b", nombre: "B", precio_venta: 150_000, costo: 100_000, iva: 10 as const, moneda: "PYG" },
    { id: "barato", nombre: "El que quedó atrás", precio_venta: 105_000, costo: 100_000, iva: 10 as const, moneda: "PYG" },
  ];

  assert.deepEqual(detectarPreciosDesalineados(productos), []);
});

test("detectarPreciosDesalineados: ya vendiendo a pérdida, no entra acá (eso lo avisa la guardia de margen)", () => {
  const productos = [
    ...catalogoSano(),
    { id: "perdida", nombre: "Vendido bajo costo", precio_venta: 90_000, costo: 100_000, iva: 10 as const, moneda: "PYG" },
  ];

  const resultado = detectarPreciosDesalineados(productos);
  assert.equal(resultado.find((p) => p.id === "perdida"), undefined);
});

test("detectarPreciosDesalineados: sin costo cargado, no entra en la cuenta ni cuenta para el piso", () => {
  const productos: ProductoConPrecio[] = [
    ...catalogoSano(),
    { id: "sin-costo", nombre: "Sin costo", precio_venta: 50_000, costo: null, iva: 10, moneda: "PYG" },
  ];

  const resultado = detectarPreciosDesalineados(productos);
  assert.equal(resultado.find((p) => p.id === "sin-costo"), undefined);
});

test("detectarPreciosDesalineados: producto exento (IVA 0%), la sugerencia no le mete impuesto", () => {
  const productos = [
    ...catalogoSano(),
    { id: "exenta", nombre: "Exenta", precio_venta: 105_000, costo: 100_000, iva: 0 as const, moneda: "PYG" },
  ];

  const [sugerido] = detectarPreciosDesalineados(productos).filter((p) => p.id === "exenta");
  // Sin IVA, neto = total: el precio sugerido no debería tener un factor de más.
  assert.ok(sugerido.precio_sugerido > sugerido.precio_actual);
});

test("detectarPreciosDesalineados: ordena del más desalineado al menos", () => {
  const productos = [
    ...catalogoSano(),
    { id: "muy-barato", nombre: "Muy barato", precio_venta: 101_000, costo: 100_000, iva: 10 as const, moneda: "PYG" },
    { id: "algo-barato", nombre: "Algo barato", precio_venta: 108_000, costo: 100_000, iva: 10 as const, moneda: "PYG" },
  ];

  const resultado = detectarPreciosDesalineados(productos);
  assert.deepEqual(resultado.map((p) => p.id), ["muy-barato", "algo-barato"]);
});
