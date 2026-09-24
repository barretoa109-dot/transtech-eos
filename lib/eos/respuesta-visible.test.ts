import assert from "node:assert/strict";
import { test } from "node:test";

import { AVISO_ACCION_NO_COMPLETADA, limpiarRespuestaVisible } from "./respuesta-visible.ts";

test("el caso real del 24/09: saca los 409 crudos y deja lo que sí se hizo", () => {
  const crudo = [
    "Listo, te lo anoto.",
    "",
    '409 - "{"ok":false,"execute":false,"decision":"block","error":"El replay cambió el payload de la orden original.","code":"EOS_COMMAND_PAYLOAD_MISMATCH"}"',
    "",
    '409 - "{"ok":false,"execute":false,"decision":"block","error":"La orden existente no coincide exactamente con esta solicitud.","code":"EOS_COMMAND_PAYLOAD_MISMATCH"}"',
    "",
    "Cargué Green ****7450. Cierra el 15 y vence el 6.",
  ].join("\n");

  const r = limpiarRespuestaVisible(crudo);
  assert.ok(!r.texto.includes("409"));
  assert.ok(!r.texto.includes("EOS_COMMAND"));
  assert.ok(!r.texto.includes("{"));
  assert.ok(r.texto.includes("Cargué Green ****7450."));
  assert.ok(r.texto.includes(AVISO_ACCION_NO_COMPLETADA));
  assert.equal(r.lineasTecnicas, 2);
});

test("saca la confirmación automática de memoria sin tocar el resto", () => {
  const r = limpiarRespuestaVisible(
    "Con Gs. 1.700.000 no alcanza.\n\nGuardé esa información en la memoria empresarial.",
  );
  assert.equal(r.texto, "Con Gs. 1.700.000 no alcanza.");
  assert.equal(r.confirmacionMemoria, true);
  assert.equal(r.lineasTecnicas, 0);
});

test("no toca montos, fechas, tarjetas ni texto normal", () => {
  const normal = [
    "Necesitás Gs. 3.945.000 al mes.",
    "La tarjeta ****7450 vence el 06/10.",
    "Te conviene apartar 20% (unos 340.000) el día 5.",
    "Mirá Negocio > Ventas.",
  ].join("\n");
  const r = limpiarRespuestaVisible(normal);
  assert.equal(r.texto, normal);
  assert.equal(r.lineasTecnicas, 0);
});

test("saca pilas de error y rutas del código", () => {
  const r = limpiarRespuestaVisible(
    [
      "Algo salió mal.",
      "TypeError: Cannot read properties of undefined",
      "    at procesarMensajeEOS (lib/eos/procesar-mensaje.ts:1200:5)",
      "ver app/api/eos/route.ts",
      "POST /api/internal/worker-authorize/v1",
    ].join("\n"),
  );
  assert.equal(r.texto, `Algo salió mal.\n\n${AVISO_ACCION_NO_COMPLETADA}`);
  assert.equal(r.lineasTecnicas, 4);
});

test("si todo era técnico, queda solo el aviso humano", () => {
  const r = limpiarRespuestaVisible('500 - {"error":"boom"}');
  assert.equal(r.texto, AVISO_ACCION_NO_COMPLETADA);
});

test("si no queda nada, usa el respaldo", () => {
  const r = limpiarRespuestaVisible("Guardé esa información en la memoria empresarial.", "Listo.");
  assert.equal(r.texto, "Listo.");
});

test("no repite el aviso si ya estaba", () => {
  const r = limpiarRespuestaVisible(`${AVISO_ACCION_NO_COMPLETADA}\n409 - "{\\"ok\\":false}"`);
  assert.equal(r.texto.split(AVISO_ACCION_NO_COMPLETADA).length - 1, 1);
});

test("el caso real de la campera: no pide el costo que ya se puso en la misma respuesta", () => {
  const crudo = [
    "Venta a registrar: 1 Campera Marron Claro a ₲230.000. También voy a cargar el producto con costo ₲207.052 para que el margen quede calculado.",
    "",
    "A “Campera Marron Claro”, que ya estaba sin costo, le puse ₲ 207.052.",
    "",
    "Registré la venta por ₲ 230.000. La ves en Negocio > Ventas. Como “Campera Marron Claro” no estaba en tu catálogo, lo cargué a ₲ 230.000. Todavía no sé cuánto te cuesta “Campera Marron Claro”, así que el margen queda pendiente: decime el costo y lo completo.",
  ].join("\n");
  const r = limpiarRespuestaVisible(crudo);
  assert.ok(!r.texto.includes("decime el costo"));
  assert.ok(r.texto.includes("le puse ₲ 207.052."));
  assert.ok(r.texto.endsWith("lo cargué a ₲ 230.000."));
});

test("si el costo de ESE producto no se puso, el pedido se mantiene", () => {
  const crudo =
    "A “Otro”, que ya estaba sin costo, le puse ₲ 10.000.\n\nTodavía no sé cuánto te cuesta “Campera”, así que el margen queda pendiente: decime el costo y lo completo.";
  assert.ok(limpiarRespuestaVisible(crudo).texto.includes("decime el costo"));
});
