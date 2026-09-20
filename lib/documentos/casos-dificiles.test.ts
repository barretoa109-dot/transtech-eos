import assert from "node:assert/strict";
import test from "node:test";

import { renderizarDocumento } from "./renderizar.ts";
import { verificarArchivo } from "./verificar.ts";
import { normalizarDocumento } from "./especificacion.ts";

/*
 * Pedidos difíciles, en los tres formatos.
 *
 * `docs/documentos-a-pedido.md` dice que EOS describe el documento y el
 * repositorio lo dibuja, así que el punto débil es lo que el modelo puede
 * escribir y ningún ejemplo previó: textos raros, tablas enormes, celdas
 * vacías, montos negativos. Cada caso se dibuja en Excel, PDF y Word con las
 * mismas bibliotecas de producción y el archivo tiene que pasar el verificador
 * que corre antes de entregarlo.
 */

const FORMATOS = ["excel", "pdf", "word"] as const;

const CASOS: Array<[string, unknown]> = [
  [
    "acentos, eñes, comillas, símbolos y emoji",
    {
      titulo: "Reunión de socios — año 2026 «Ñandutí» & Cía. 😀",
      subtitulo: "Peñón, Ñemby, Capiatá · 100 % del plan",
      moneda: "PYG",
      bloques: [
        { tipo: "titulo", texto: "Resumen ejecutivo ✅", nivel: 1 },
        { tipo: "parrafo", texto: "Cobró “a crédito” 50 % y el resto ‘contado’; ¿cuánto queda? → Gs. 1.250.000 (€ 200, US$ 30)." },
        { tipo: "lista", items: ["Pagar a José Ñu", "Llamar a la señora de Luque", "Revisión de IVA 10 %"] },
        { tipo: "nota", texto: "Se ven bien los acentos: áéíóú ÁÉÍÓÚ üÜ ñÑ ¿? ¡!" },
      ],
    },
  ],
  [
    "una palabra larguísima sin espacios",
    {
      titulo: "Referencia",
      bloques: [
        { tipo: "parrafo", texto: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(30) },
        {
          tipo: "tabla",
          columnas: [{ titulo: "Detalle", tipo: "texto" }, { titulo: "Monto", tipo: "dinero" }],
          filas: [["x".repeat(400), 1000]],
        },
      ],
    },
  ],
  [
    "tabla de 300 filas y doce columnas",
    {
      titulo: "Inventario completo",
      moneda: "PYG",
      bloques: [
        {
          tipo: "tabla",
          titulo: "Stock",
          columnas: [
            { titulo: "Código", tipo: "texto" },
            { titulo: "Producto", tipo: "texto" },
            { titulo: "Categoría", tipo: "texto" },
            { titulo: "Proveedor", tipo: "texto" },
            { titulo: "Stock", tipo: "numero", total: true },
            { titulo: "Mínimo", tipo: "numero" },
            { titulo: "Costo", tipo: "dinero" },
            { titulo: "Precio", tipo: "dinero" },
            { titulo: "Margen", tipo: "porcentaje" },
            { titulo: "Alta", tipo: "fecha" },
            { titulo: "Ubicación", tipo: "texto" },
            { titulo: "Valor", tipo: "dinero", total: true },
          ],
          filas: Array.from({ length: 300 }, (_, i) => [
            `P-${i}`, `Producto número ${i} con nombre bastante largo`, "Almacén", "Proveedor S.A.",
            i, 5, 10_000 + i, 15_000 + i, 0.33, "2026-08-31", "Depósito 1", (10_000 + i) * i,
          ]),
        },
      ],
    },
  ],
  [
    "montos negativos, ceros y celdas vacías",
    {
      titulo: "Flujo del mes",
      moneda: "PYG",
      bloques: [
        {
          tipo: "tabla",
          columnas: [{ titulo: "Concepto", tipo: "texto" }, { titulo: "Monto", tipo: "dinero", total: true }],
          filas: [["Ventas", 5_000_000], ["Devoluciones", -350_000], ["Sin dato", null], ["Cero", 0]],
        },
        { tipo: "indicadores", items: [{ etiqueta: "Resultado", valor: "-1.200.000", detalle: "Pérdida" }] },
      ],
    },
  ],
  [
    "un documento en dólares",
    {
      titulo: "Presupuesto en dólares",
      moneda: "USD",
      bloques: [
        {
          tipo: "tabla",
          columnas: [{ titulo: "Ítem", tipo: "texto" }, { titulo: "Monto", tipo: "dinero", total: true }],
          filas: [["Licencia", 1234.56], ["Soporte", 99.5]],
        },
      ],
    },
  ],
];

for (const [nombre, especificacion] of CASOS) {
  for (const formato of FORMATOS) {
    test(`${nombre}: sale un ${formato} entregable`, async () => {
      assert.equal(normalizarDocumento(especificacion).ok, true, "el documento debe ser aceptado");

      const salida = await renderizarDocumento(especificacion, formato, formato);

      assert.equal(salida.ok, true, salida.ok ? "" : salida.error);
      if (!salida.ok) return;

      const verificacion = verificarArchivo(formato, salida.cuerpo);
      assert.deepEqual(verificacion, { ok: true });
    });
  }
}

/*
 * Que el archivo sea válido no alcanza: tiene que decir lo que se pidió. Excel
 * y Word son zips de XML, así que se abre el archivo y se busca el texto con sus
 * acentos. (El PDF va comprimido y no se puede leer así; su cifrado de texto lo
 * cubren los tests de `especificacion.test.ts`.)
 */
test("el Excel y el Word conservan los acentos, las eñes y los montos", async () => {
  const { default: JSZip } = await import("jszip");
  const [, especificacion] = CASOS[0];

  for (const [formato, ruta] of [
    ["excel", "xl/sharedStrings.xml"],
    ["word", "word/document.xml"],
  ] as const) {
    const salida = await renderizarDocumento(especificacion, formato, formato);
    assert.equal(salida.ok, true);
    if (!salida.ok) return;

    const zip = await JSZip.loadAsync(salida.cuerpo);
    const xml = await zip.file(ruta)!.async("string");

    for (const texto of ["Ñandutí", "Reunión de socios", "Capiatá", "señora de Luque", "1.250.000"]) {
      assert.ok(xml.includes(texto), `${formato}: falta «${texto}»`);
    }
  }
});
