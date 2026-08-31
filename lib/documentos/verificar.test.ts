import assert from "node:assert/strict";
import test from "node:test";

import { avisoDeCifras, cifrasContradictorias, verificarArchivo } from "./verificar.ts";
import { crearExcelDocumento } from "./excel.ts";
import { crearPdfDocumento } from "./pdf.ts";
import { crearWordDocumento } from "./word.ts";
import type { Documento } from "./especificacion.ts";

const DOCUMENTO: Documento = {
  titulo: "Cuadro de necesidades",
  subtitulo: "Prueba",
  moneda: "PYG",
  generadoEl: "2026-08-31",
  bloques: [
    { tipo: "titulo", texto: "Resumen", nivel: 1 },
    { tipo: "parrafo", texto: "Un párrafo cualquiera para que la hoja tenga algo." },
    {
      tipo: "tabla",
      titulo: "Necesidades",
      columnas: [
        { titulo: "Concepto", tipo: "texto" },
        { titulo: "Monto", tipo: "dinero", total: true },
      ],
      filas: [
        ["Alquiler", 2_500_000],
        ["Servicios", 480_000],
      ],
    },
  ],
};

// ============================================================
// Lo que importa primero: NO rechazar un archivo sano.
// ============================================================
//
// Un verificador con falsos positivos es peor que no tener ninguno: rompe
// descargas que funcionaban. Por eso se prueba contra los archivos REALES que
// arman las mismas tres bibliotecas que usa producción, no contra bytes
// inventados a mano que siempre van a pasar.

test("deja pasar un Excel de verdad", async () => {
  const cuerpo = new Uint8Array(await crearExcelDocumento(DOCUMENTO));
  assert.deepEqual(verificarArchivo("excel", cuerpo), { ok: true });
});

test("deja pasar un PDF de verdad", async () => {
  const cuerpo = new Uint8Array(await crearPdfDocumento(DOCUMENTO));
  assert.deepEqual(verificarArchivo("pdf", cuerpo), { ok: true });
});

test("deja pasar un Word de verdad", async () => {
  const cuerpo = new Uint8Array(await crearWordDocumento(DOCUMENTO));
  assert.deepEqual(verificarArchivo("word", cuerpo), { ok: true });
});

// ============================================================
// Y ahora sí, lo que tiene que frenar.
// ============================================================

test("un archivo vacío o ausente no se entrega", () => {
  for (const formato of ["excel", "pdf", "word"] as const) {
    for (const cuerpo of [null, undefined, new Uint8Array(0)]) {
      const resultado = verificarArchivo(formato, cuerpo);
      assert.equal(resultado.ok, false);
      assert.match((resultado as { motivo: string }).motivo, /sin un solo byte/);
    }
  }
});

test("un archivo demasiado chico para su formato no se entrega", () => {
  assert.equal(verificarArchivo("excel", new Uint8Array(300)).ok, false);
  assert.equal(verificarArchivo("word", new Uint8Array(300)).ok, false);
  assert.equal(verificarArchivo("pdf", new Uint8Array(100)).ok, false);
});

test("un archivo que no empieza con la firma de su formato no se entrega", () => {
  const basura = new Uint8Array(2048).fill(0x41); // 'A' repetida

  for (const formato of ["excel", "pdf", "word"] as const) {
    const resultado = verificarArchivo(formato, basura);
    assert.equal(resultado.ok, false);
    assert.match((resultado as { motivo: string }).motivo, /no empieza con la firma/);
  }
});

test("un PDF sano cortado por la mitad se detecta", async () => {
  const entero = new Uint8Array(await crearPdfDocumento(DOCUMENTO));
  const cortado = entero.slice(0, Math.floor(entero.length / 2));

  assert.equal(verificarArchivo("pdf", entero).ok, true);

  const resultado = verificarArchivo("pdf", cortado);
  assert.equal(resultado.ok, false);
  assert.match((resultado as { motivo: string }).motivo, /cortado/);
});

test("un Excel sano cortado por la mitad se detecta", async () => {
  const entero = new Uint8Array(await crearExcelDocumento(DOCUMENTO));
  const cortado = entero.slice(0, Math.floor(entero.length / 2));

  assert.equal(verificarArchivo("excel", entero).ok, true);

  const resultado = verificarArchivo("excel", cortado);
  assert.equal(resultado.ok, false);
  assert.match((resultado as { motivo: string }).motivo, /cortado/);
});

test("un Word sano cortado por la mitad se detecta", async () => {
  const entero = new Uint8Array(await crearWordDocumento(DOCUMENTO));
  const cortado = entero.slice(0, Math.floor(entero.length / 2));

  const resultado = verificarArchivo("word", cortado);
  assert.equal(resultado.ok, false);
  assert.match((resultado as { motivo: string }).motivo, /cortado/);
});

test("un PDF con la firma correcta pero sin cierre no se entrega", () => {
  const falso = new Uint8Array(2048);
  falso.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0); // "%PDF-"

  const resultado = verificarArchivo("pdf", falso);
  assert.equal(resultado.ok, false);
  assert.match((resultado as { motivo: string }).motivo, /cortado/);
});

// ============================================================
// Cifras que se contradicen entre sí
// ============================================================
//
// Un archivo que no abre se nota enseguida. Uno cuyo total está mal se nota
// tarde y delante de otro.

test("una tabla cuyo total sí suma no genera ningún problema", () => {
  const problemas = cifrasContradictorias({
    bloques: [
      {
        tipo: "tabla",
        titulo: "Gastos",
        columnas: [{ titulo: "Concepto" }, { titulo: "Monto" }],
        filas: [
          ["Alquiler", 2_500_000],
          ["Servicios", 480_000],
          ["Total", 2_980_000],
        ],
      },
    ],
  });

  assert.deepEqual(problemas, []);
});

test("un total que no coincide con sus filas se detecta", () => {
  const problemas = cifrasContradictorias({
    bloques: [
      {
        tipo: "tabla",
        titulo: "Gastos",
        columnas: [{ titulo: "Concepto" }, { titulo: "Monto" }],
        filas: [
          ["Alquiler", 2_500_000],
          ["Servicios", 480_000],
          ["Total", 3_000_000],
        ],
      },
    ],
  });

  assert.equal(problemas.length, 1);
  assert.equal(problemas[0].declarado, 3_000_000);
  assert.equal(problemas[0].suma, 2_980_000);
  assert.equal(problemas[0].columna, "Monto");
});

test("una diferencia de redondeo no se marca como contradicción", () => {
  const problemas = cifrasContradictorias({
    bloques: [
      {
        tipo: "tabla",
        columnas: [{ titulo: "Concepto" }, { titulo: "Monto" }],
        filas: [
          ["Uno", 100],
          ["Dos", 200],
          ["Total", 301],
        ],
      },
    ],
  });

  assert.deepEqual(problemas, []);
});

test("los subtotales no se cuentan dos veces dentro del total general", () => {
  const problemas = cifrasContradictorias({
    bloques: [
      {
        tipo: "tabla",
        columnas: [{ titulo: "Concepto" }, { titulo: "Monto" }],
        filas: [
          ["Alquiler", 1_000],
          ["Luz", 500],
          ["Subtotal fijos", 1_500],
          ["Nafta", 300],
          ["Total", 1_800],
        ],
      },
    ],
  });

  assert.deepEqual(problemas, []);
});

test("una tabla sin fila de total no se toca", () => {
  const problemas = cifrasContradictorias({
    bloques: [
      {
        tipo: "tabla",
        columnas: [{ titulo: "Concepto" }, { titulo: "Monto" }],
        filas: [
          ["Alquiler", 1_000],
          ["Luz", 500],
        ],
      },
    ],
  });

  assert.deepEqual(problemas, []);
});

test("una fila que dice Total sin filas numéricas arriba no se contrasta", () => {
  const problemas = cifrasContradictorias({
    bloques: [
      {
        tipo: "tabla",
        columnas: [{ titulo: "Concepto" }, { titulo: "Monto" }],
        filas: [["Total del mes", 5_000]],
      },
    ],
  });

  assert.deepEqual(problemas, []);
});

test("los bloques que no son tablas se ignoran", () => {
  const problemas = cifrasContradictorias({
    bloques: [
      { tipo: "parrafo", texto: "Total: cualquier cosa" },
      { tipo: "titulo", texto: "Total", nivel: 1 },
    ],
  });

  assert.deepEqual(problemas, []);
});

test("el aviso nombra la columna, la tabla y los dos números", () => {
  const problemas = cifrasContradictorias({
    bloques: [
      {
        tipo: "tabla",
        titulo: "Ventas del mes",
        columnas: [{ titulo: "Cliente" }, { titulo: "Importe" }],
        filas: [
          ["Uno", 100],
          ["Total", 900],
        ],
      },
    ],
  });

  const texto = avisoDeCifras(problemas);

  assert.match(texto, /Importe/);
  assert.match(texto, /Ventas del mes/);
  assert.match(texto, /900/);
  assert.match(texto, /100/);
});
