import test from "node:test";
import assert from "node:assert/strict";

import { resumirParaPush } from "./enviar.ts";

/**
 * Tests del recorte para notificaciones.
 *
 * En el teléfono se ven dos o tres líneas. Si el texto se corta solo, el
 * sistema lo trunca donde le toca —a veces en la mitad de la cifra que
 * importaba— así que conviene elegir nosotros dónde termina.
 */

test("deja pasar un texto corto sin tocarlo", () => {
  assert.equal(resumirParaPush("Todo en orden."), "Todo en orden.");
});

test("normaliza los espacios y saltos de línea", () => {
  assert.equal(resumirParaPush("Hola\n\n  mundo   raro"), "Hola mundo raro");
});

test("recorta en un espacio, no en la mitad de una palabra", () => {
  const largo =
    "Tenés un objetivo activo con progreso cero por ciento y conviene convertirlo en una secuencia concreta de acciones antes del mediodía";
  const r = resumirParaPush(largo);

  assert.ok(r.length <= 121, `quedó en ${r.length} caracteres`);
  assert.ok(r.endsWith("…"));
  assert.ok(!/\s…$/.test(r), "no debería quedar un espacio antes de los puntos");

  // La parte conservada tiene que ser prefijo del original: nada inventado.
  assert.ok(largo.startsWith(r.slice(0, -1)));
});

test("tolera texto vacío o nulo", () => {
  assert.equal(resumirParaPush(null), "");
  assert.equal(resumirParaPush("   "), "");
});

test("respeta un máximo personalizado", () => {
  const r = resumirParaPush("uno dos tres cuatro cinco seis siete ocho nueve diez", 20);
  assert.ok(r.length <= 21, `quedó en ${r.length}`);
});
