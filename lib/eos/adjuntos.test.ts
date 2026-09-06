import test from "node:test";
import assert from "node:assert/strict";

import {
  LADO_MAXIMO_IMAGEN,
  MAX_ADJUNTOS,
  medidaParaModelo,
  revisarAdjuntos,
  textoPorDefecto,
  type Adjunto,
} from "./adjuntos.ts";

function foto(p: Partial<Adjunto> = {}): Adjunto {
  return { nombre: "factura.jpg", tipo: "image/jpeg", tamanio: 300_000, base64: "x".repeat(400), ...p };
}

test("una imagen que ya entra no se toca", () => {
  // Reprocesarla la recomprime sin ganar un byte y le agrega artefactos.
  assert.equal(medidaParaModelo(800, 600), null);
  assert.equal(medidaParaModelo(LADO_MAXIMO_IMAGEN, LADO_MAXIMO_IMAGEN), null);
});

test("una foto de teléfono se achica al lado largo y conserva la proporción", () => {
  const medida = medidaParaModelo(4000, 3000)!;

  assert.equal(medida.ancho, LADO_MAXIMO_IMAGEN);
  assert.equal(medida.alto, Math.round(3000 * (LADO_MAXIMO_IMAGEN / 4000)));
  assert.ok(Math.abs(medida.ancho / medida.alto - 4000 / 3000) < 0.01);
});

test("una imagen vertical se achica por el alto, no por el ancho", () => {
  const medida = medidaParaModelo(3000, 4000)!;

  assert.equal(medida.alto, LADO_MAXIMO_IMAGEN);
  assert.ok(medida.ancho < LADO_MAXIMO_IMAGEN);
});

test("una imagen larguísima y finita no se queda en cero píxeles", () => {
  // Una captura de pantalla de una conversación larga: 400 × 20000.
  const medida = medidaParaModelo(400, 20000)!;

  assert.equal(medida.alto, LADO_MAXIMO_IMAGEN);
  assert.ok(medida.ancho >= 1, "un lado en 0 hace que el canvas tire");
});

test("medidas imposibles devuelven null en vez de romper", () => {
  assert.equal(medidaParaModelo(0, 100), null);
  assert.equal(medidaParaModelo(100, -1), null);
  assert.equal(medidaParaModelo(Number.NaN, 100), null);
});

test("hasta diez archivos pasan", () => {
  const diez = Array.from({ length: MAX_ADJUNTOS }, (_, i) => foto({ nombre: `f${i}.jpg` }));
  assert.equal(revisarAdjuntos(diez), null);
});

test("once no pasan, y el motivo dice cuántos sobran", () => {
  const once = Array.from({ length: MAX_ADJUNTOS + 1 }, (_, i) => foto({ nombre: `f${i}.jpg` }));
  const rechazo = revisarAdjuntos(once)!;

  assert.ok(rechazo);
  assert.match(rechazo.motivo, /11/);
  assert.match(rechazo.motivo, /Sacá 1/);
});

test("sin adjuntos no hay nada que rechazar", () => {
  assert.equal(revisarAdjuntos([]), null);
});

test("un archivo incompleto se rechaza antes de viajar", () => {
  assert.ok(revisarAdjuntos([foto({ base64: "" })]));
  assert.ok(revisarAdjuntos([foto({ nombre: "" })]));
  assert.ok(revisarAdjuntos([foto({ tipo: "" })]));
});

test("el archivo de más de 15 MB se rechaza con su nombre", () => {
  const rechazo = revisarAdjuntos([foto({ nombre: "video.jpg", tamanio: 20 * 1024 * 1024 })])!;

  assert.ok(rechazo);
  assert.match(rechazo.motivo, /video\.jpg/);
});

test("diez archivos chicos pasan aunque uno solo grande no pasaría", () => {
  // El tope por archivo y el tope del total son distintos a propósito: la
  // suma es lo que tiene que entrar en el cuerpo del pedido.
  const diez = Array.from({ length: 10 }, () => foto({ base64: "x".repeat(1_000_000) }));
  assert.equal(revisarAdjuntos(diez), null);
});

test("diez archivos pesados sí se frenan por el total", () => {
  const diez = Array.from({ length: 10 }, () => foto({ base64: "x".repeat(3_000_000) }));
  const rechazo = revisarAdjuntos(diez)!;

  assert.ok(rechazo);
  assert.match(rechazo.motivo, /demasiado/i);
});

test("con un adjunto el texto por defecto lo nombra", () => {
  assert.equal(textoPorDefecto([foto({ nombre: "boleta.jpg" })]), "Analizá esta imagen: boleta.jpg");
});

test("un archivo que no es imagen se nombra como archivo", () => {
  assert.equal(
    textoPorDefecto([foto({ nombre: "balance.pdf", tipo: "application/pdf" })]),
    "Analizá este archivo: balance.pdf",
  );
});

test("con varios se cuentan en vez de nombrarlos todos", () => {
  // Nombrarlos deja un mensaje de cuatro renglones que nadie quiso escribir.
  const texto = textoPorDefecto([foto(), foto({ nombre: "b.jpg" }), foto({ nombre: "c.jpg" })]);

  assert.equal(texto, "Analizá estas 3 imágenes");
  assert.doesNotMatch(texto, /\.jpg/);
});

test("si mezcla imágenes con otros archivos dice 'archivos', y concuerda", () => {
  const texto = textoPorDefecto([foto(), foto({ nombre: "b.pdf", tipo: "application/pdf" })]);

  assert.equal(texto, "Analizá estos 2 archivos");
  assert.notEqual(texto, "Analizá estas 2 archivos");
});

test("sin adjuntos el texto por defecto queda vacío", () => {
  assert.equal(textoPorDefecto([]), "");
});
