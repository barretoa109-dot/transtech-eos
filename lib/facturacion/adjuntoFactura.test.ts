import assert from "node:assert/strict";
import test from "node:test";

import { elegirAdjuntoFactura, MAX_BYTES_ADJUNTO, type AdjuntoCrudo } from "./adjuntoFactura.ts";

const adjunto = (parcial: Partial<AdjuntoCrudo>): AdjuntoCrudo => ({
  id: "a1",
  filename: "kude.pdf",
  content_type: "application/pdf",
  size: 1024,
  ...parcial,
});

test("sin adjuntos, nada que elegir", () => {
  assert.equal(elegirAdjuntoFactura([]), null);
});

test("un PDF se elige por sobre una imagen", () => {
  const elegido = elegirAdjuntoFactura([
    adjunto({ id: "img", content_type: "image/jpeg", filename: "foto.jpg" }),
    adjunto({ id: "pdf", content_type: "application/pdf" }),
  ]);
  assert.deepEqual(elegido, { id: "pdf", esImagen: false });
});

test("sin PDF, se toma la imagen que no parece decorativa", () => {
  const elegido = elegirAdjuntoFactura([adjunto({ id: "foto", content_type: "image/png", filename: "ticket.png" })]);
  assert.deepEqual(elegido, { id: "foto", esImagen: true });
});

test("un logo o firma de la firma del correo no cuenta", () => {
  assert.equal(
    elegirAdjuntoFactura([adjunto({ content_type: "image/png", filename: "logo.png" })]),
    null,
  );
  assert.equal(
    elegirAdjuntoFactura([adjunto({ content_type: "image/png", filename: "image001.png" })]),
    null,
  );
});

test("el XML del Documento Electrónico se ignora: no se parsea el schema de SIFEN", () => {
  assert.equal(
    elegirAdjuntoFactura([adjunto({ content_type: "application/xml", filename: "de.xml" })]),
    null,
  );
});

test("un adjunto gigante se descarta aunque sea PDF", () => {
  assert.equal(elegirAdjuntoFactura([adjunto({ size: MAX_BYTES_ADJUNTO + 1 })]), null);
});

test("un adjunto de tamaño cero (referencia rota) se descarta", () => {
  assert.equal(elegirAdjuntoFactura([adjunto({ size: 0 })]), null);
});
