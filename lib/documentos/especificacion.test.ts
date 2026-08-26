import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatearCelda,
  normalizarDocumento,
  totalesDeTabla,
  type Bloque,
} from "./especificacion.ts";

/**
 * Estos tests están escritos desde la desconfianza: el que llena la estructura
 * es un modelo de lenguaje, así que casi todo lo que se prueba acá es que la
 * basura no llegue a exceljs ni a pdfkit. Ver el comentario de cabecera de
 * `especificacion.ts`.
 */

function tabla(documento: ReturnType<typeof normalizarDocumento>): Extract<Bloque, { tipo: "tabla" }> {
  assert.ok(documento.ok);
  const bloque = documento.documento.bloques.find((b) => b.tipo === "tabla");
  assert.ok(bloque && bloque.tipo === "tabla");
  return bloque;
}

test("un documento sin título no se arma", () => {
  const resultado = normalizarDocumento({ bloques: [{ tipo: "parrafo", texto: "Hola" }] });

  assert.equal(resultado.ok, false);
  assert.ok(!resultado.ok && resultado.motivo.includes("título"));
});

test("un documento sin nada que escribir no se arma", () => {
  // Un archivo con la carátula y ninguna página adentro es peor que un error:
  // el usuario lo abre, lo ve vacío y no sabe si falló EOS o falló él.
  const resultado = normalizarDocumento({ titulo: "Necesidades", bloques: [] });

  assert.equal(resultado.ok, false);
});

test("acepta el JSON como cadena, que es como suele llegar del modelo", () => {
  const resultado = normalizarDocumento(
    JSON.stringify({ titulo: "Acta", bloques: [{ tipo: "parrafo", texto: "Se acordó." }] }),
  );

  assert.ok(resultado.ok);
  assert.equal(resultado.documento.titulo, "Acta");
});

test("una fila con menos celdas que columnas se completa con vacíos, no se corre", () => {
  // Es EL error que hace que un informe mienta: si la fila corta se compacta,
  // el importe de la tercera columna aparece bajo el título de la segunda.
  const resultado = normalizarDocumento({
    titulo: "Compras",
    bloques: [
      {
        tipo: "tabla",
        columnas: [
          { titulo: "Ítem", tipo: "texto" },
          { titulo: "Cantidad", tipo: "numero" },
          { titulo: "Precio", tipo: "dinero" },
        ],
        filas: [["Papel", 3, 25_000], ["Tinta"]],
      },
    ],
  });

  const t = tabla(resultado);
  assert.deepEqual(t.filas[1], ["Tinta", null, null]);
});

test("una fila escrita como objeto se ordena por el título de la columna", () => {
  const resultado = normalizarDocumento({
    titulo: "Clientes",
    bloques: [
      {
        tipo: "tabla",
        columnas: [
          { titulo: "Nombre", tipo: "texto" },
          { titulo: "Deuda", tipo: "dinero" },
        ],
        filas: [{ Deuda: 90_000, Nombre: "Rossana" }],
      },
    ],
  });

  assert.deepEqual(tabla(resultado).filas[0], ["Rossana", 90_000]);
});

test("los importes con puntos y comas paraguayos entran como números", () => {
  const resultado = normalizarDocumento({
    titulo: "Gastos",
    bloques: [
      {
        tipo: "tabla",
        columnas: [{ titulo: "Monto", tipo: "dinero" }],
        filas: [["₲ 1.250.000"], ["1,250,000.50"], ["no es un número"]],
      },
    ],
  });

  const t = tabla(resultado);
  assert.deepEqual(t.filas, [[1_250_000], [1_250_000.5], [null]]);
});

test("una tabla enorme se recorta y el recorte se avisa", () => {
  const filas = Array.from({ length: 5_000 }, (_, i) => [`Fila ${i}`, i]);

  const resultado = normalizarDocumento({
    titulo: "Movimientos",
    bloques: [
      {
        tipo: "tabla",
        columnas: [
          { titulo: "Detalle", tipo: "texto" },
          { titulo: "Monto", tipo: "numero" },
        ],
        filas,
      },
    ],
  });

  assert.ok(resultado.ok);
  assert.equal(tabla(resultado).filas.length, 2_000);
  assert.ok(resultado.recortes.some((r) => r.includes("5000 filas")));
});

test("el presupuesto de celdas es del documento entero, no de cada tabla", () => {
  // Diez tablas de dos mil filas son veinte mil filas igual: si el tope fuera
  // por tabla, el archivo seguiría siendo imposible de generar.
  const bloques = Array.from({ length: 10 }, () => ({
    tipo: "tabla",
    columnas: [
      { titulo: "A", tipo: "texto" },
      { titulo: "B", tipo: "numero" },
    ],
    filas: Array.from({ length: 2_000 }, (_, i) => [`x${i}`, i]),
  }));

  const resultado = normalizarDocumento({ titulo: "Todo", bloques });

  assert.ok(resultado.ok);

  const celdas = resultado.documento.bloques.reduce(
    (total, b) => (b.tipo === "tabla" ? total + b.filas.length * b.columnas.length : total),
    0,
  );

  assert.ok(celdas <= 20_000, `se colaron ${celdas} celdas`);
});

test("un bloque que no se entiende se descarta sin tumbar el documento", () => {
  const resultado = normalizarDocumento({
    titulo: "Mixto",
    bloques: [
      { tipo: "grafico_3d", datos: [1, 2, 3] },
      { tipo: "parrafo", texto: "Esto sí se entiende." },
      42,
    ],
  });

  assert.ok(resultado.ok);
  assert.equal(resultado.documento.bloques.length, 1);
});

test("los caracteres de control no llegan al archivo", () => {
  // Un carácter de control dentro del XML de un .docx lo deja ilegible para
  // Word: no da un error, abre roto.
  const resultado = normalizarDocumento({
    titulo: "Con\u0000trol",
    bloques: [{ tipo: "parrafo", texto: "linea\u0007uno" }],
  });

  assert.ok(resultado.ok);
  assert.equal(resultado.documento.titulo, "Control");
  assert.equal((resultado.documento.bloques[0] as { texto: string }).texto, "lineauno");
});

test("un total pedido sobre una columna de texto se ignora", () => {
  const resultado = normalizarDocumento({
    titulo: "Ventas",
    bloques: [
      {
        tipo: "tabla",
        columnas: [
          { titulo: "Cliente", tipo: "texto", total: true },
          { titulo: "Monto", tipo: "dinero", total: true },
        ],
        filas: [["Ana", 100], ["Beto", 200]],
      },
    ],
  });

  const totales = totalesDeTabla(tabla(resultado));
  assert.deepEqual(totales, [null, 300]);
});

test("los guaraníes se escriben sin decimales y los dólares con dos", () => {
  const pyg = formatearCelda(1_500_000, { titulo: "x", tipo: "dinero" }, "PYG");
  const usd = formatearCelda(1_500.5, { titulo: "x", tipo: "dinero", moneda: "USD" }, "PYG");

  assert.equal(pyg, "₲ 1.500.000");
  assert.equal(usd, "US$ 1.500,50");
});

test("en el PDF el guaraní se escribe Gs. porque la fuente no tiene el signo", () => {
  const pdf = formatearCelda(1_000, { titulo: "x", tipo: "dinero" }, "PYG", false);

  assert.equal(pdf, "Gs. 1.000");
});

test("los separadores de miles no se confunden con decimales", () => {
  // "1.250" en Paraguay son mil doscientos cincuenta. "1.25" son uno con
  // veinticinco. La diferencia es cuántos dígitos vienen después del punto.
  const resultado = normalizarDocumento({
    titulo: "Números",
    bloques: [
      {
        tipo: "tabla",
        columnas: [{ titulo: "Valor", tipo: "numero" }],
        filas: [["1.250"], ["1.25"], ["1,5"], ["-2.500"], ["12"]],
      },
    ],
  });

  assert.deepEqual(tabla(resultado).filas, [[1_250], [1.25], [1.5], [-2_500], [12]]);
});
