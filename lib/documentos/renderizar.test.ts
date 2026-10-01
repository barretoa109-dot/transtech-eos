import assert from "node:assert/strict";
import { test } from "node:test";

import { renderizarDocumento } from "./renderizar.ts";

/*
 * El archivo de verdad, en los tres formatos (01/10/2026): que lo que EOS
 * ofrece descargar exista, abra y no sea un "Listo" sin archivo. Lo que el
 * chat promete depende de que esto devuelva bytes válidos.
 */
const PLAN = {
  titulo: "Plan de pagos de octubre",
  moneda: "PYG",
  generadoEl: "2026-10-01",
  bloques: [
    { tipo: "titulo", texto: "Primero los préstamos", nivel: 2 },
    { tipo: "parrafo", texto: "Las cuotas se pagan antes que cualquier arreglo." },
    {
      tipo: "tabla",
      titulo: "Cuotas",
      columnas: [
        { titulo: "Préstamo", tipo: "texto" },
        { titulo: "Cuota", tipo: "dinero" },
        { titulo: "Vence", tipo: "texto" },
      ],
      filas: [
        ["Celular", 400000, "día 5"],
        ["Moto", 650000, "día 10"],
      ],
    },
    { tipo: "lista", ordenada: true, items: ["Separar ₲ 1.050.000 el día de cobro", "Pedir presupuesto de la moto"] },
  ],
};

const FIRMAS: Record<string, string> = { excel: "PK", word: "PK", pdf: "%PDF" };

for (const formato of ["excel", "pdf", "word"] as const) {
  test(`un documento pedido sale como ${formato} válido`, async () => {
    const r = await renderizarDocumento(PLAN, formato, formato);
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    assert.ok(r.cuerpo.length > 1000, `muy chico: ${r.cuerpo.length}`);
    assert.equal(r.cuerpo.subarray(0, FIRMAS[formato].length).toString("latin1"), FIRMAS[formato]);
    assert.match(r.nombre, formato === "excel" ? /\.xlsx$/ : formato === "pdf" ? /\.pdf$/ : /\.docx$/);
  });
}

test("una especificación dañada no se entrega como archivo", async () => {
  const r = await renderizarDocumento({ titulo: "", bloques: "x" }, "pdf", "pdf");
  assert.equal(r.ok, false);
});

test("un formato desconocido cae al guardado, nunca a nada", async () => {
  const r = await renderizarDocumento(PLAN, "word", "zip");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.formato, "word");
});
