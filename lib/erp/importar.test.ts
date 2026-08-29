import assert from "node:assert/strict";
import { test } from "node:test";

import { detectarColumnas, filasAProductos, normalizarEncabezado, repetidos } from "./importar.ts";

test("los encabezados se comparan sin acentos ni puntuación", () => {
  assert.equal(normalizarEncabezado("  PRECIO DE VENTA  "), "precio de venta");
  assert.equal(normalizarEncabezado("Código"), "codigo");
  assert.equal(normalizarEncabezado("P. Venta"), "p venta");
  assert.equal(normalizarEncabezado("Descripción/Detalle"), "descripcion detalle");
});

test("reconoce una planilla escrita como la escribiría cualquiera", () => {
  const cols = detectarColumnas(["Código", "PRODUCTO", "Precio de Venta", "Stock actual"]);

  assert.equal(cols.codigo, 0);
  assert.equal(cols.nombre, 1);
  assert.equal(cols.precio, 2);
  assert.equal(cols.stock, 3);
});

test("el precio de venta le gana al costo cuando están los dos", () => {
  /*
   * Es el error más caro posible de este archivo: si el costo entrara como
   * precio de venta, todo el catálogo quedaría vendiéndose a pérdida y nadie
   * lo notaría hasta cerrar el mes.
   */
  const cols = detectarColumnas(["Producto", "Precio de costo", "Precio de venta"]);

  assert.equal(cols.costo, 1);
  assert.equal(cols.precio, 2);
});

test("una columna no se usa para dos campos", () => {
  const cols = detectarColumnas(["Producto", "Precio"]);

  assert.equal(cols.nombre, 0);
  assert.equal(cols.precio, 1);
  assert.equal(cols.costo, null);
});

test("sin columna de nombre, no se importa nada y se explica por qué", () => {
  const { productos, problemas } = filasAProductos(["Precio", "Stock"], [[1000, 5]]);

  assert.equal(productos.length, 0);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0].motivo, /nombre del producto/i);
});

test("entiende los precios como se escriben en Paraguay", () => {
  const { productos } = filasAProductos(
    ["Producto", "Precio"],
    [
      ["Pan casero", "11.000"],
      ["Chipa", "Gs. 5.500"],
      ["Torta", 85000],
    ],
  );

  assert.equal(productos[0].precio_venta, 11_000);
  assert.equal(productos[1].precio_venta, 5_500);
  assert.equal(productos[2].precio_venta, 85_000);
});

test("una fila sin precio se informa, no se descarta en silencio", () => {
  const { productos, problemas } = filasAProductos(
    ["Producto", "Precio"],
    [
      ["Pan", "11.000"],
      ["Chipa", "consultar"],
    ],
  );

  assert.equal(productos.length, 1);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0].fila, 3, "la fila se cuenta como en la planilla");
  assert.match(problemas[0].motivo, /Chipa/);
});

test("las filas vacías del final no son un problema", () => {
  const { productos, problemas } = filasAProductos(
    ["Producto", "Precio"],
    [["Pan", "11.000"], ["", ""], [null, null]],
  );

  assert.equal(productos.length, 1);
  assert.equal(problemas.length, 0, "nadie quiere ver 200 errores por filas vacías");
});

test("sólo lleva stock quien trajo una columna de stock", () => {
  const sinStock = filasAProductos(["Producto", "Precio"], [["Consultoría", "500.000"]]);
  assert.equal(sinStock.productos[0].controla_stock, false);

  const conStock = filasAProductos(
    ["Producto", "Precio", "Stock"],
    [["Pan", "11.000", "40"]],
  );
  assert.equal(conStock.productos[0].controla_stock, true);
  assert.equal(conStock.productos[0].stock_actual, 40);
});

test("un IVA que no existe en Paraguay se trata como la tasa general", () => {
  const { productos } = filasAProductos(
    ["Producto", "Precio", "IVA"],
    [
      ["Pan", "11.000", "10"],
      ["Libro", "50.000", "0"],
      ["Remedio", "30.000", "5"],
      ["Importado", "90.000", "21"],
    ],
  );

  assert.equal(productos[0].iva, 10);
  assert.equal(productos[1].iva, 0);
  assert.equal(productos[2].iva, 5);
  assert.equal(productos[3].iva, 10, "21 no es una tasa paraguaya");
});

test("un precio negativo se rechaza", () => {
  const { productos, problemas } = filasAProductos(
    ["Producto", "Precio"],
    [["Devolución", "-5000"]],
  );

  assert.equal(productos.length, 0);
  assert.match(problemas[0].motivo, /negativo/);
});

test("los nombres repetidos se detectan antes de importar", () => {
  const { productos } = filasAProductos(
    ["Producto", "Precio"],
    [
      ["Pan casero", "11.000"],
      ["Chipa", "5.000"],
      ["PAN CASERO", "12.000"],
    ],
  );

  assert.deepEqual(repetidos(productos), ["pan casero"]);
});
