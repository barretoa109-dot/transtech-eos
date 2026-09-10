import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCIONES_DURABLES,
  huboEfecto,
  leerEvidencia,
  SIN_EVIDENCIA,
  verificarAcciones,
} from "./verificacion.ts";
import { ACCIONES_CON_RIESGO } from "../autonomia/riesgo.ts";

const VACIO = { ok: true, acciones_ejecutadas: [], acciones_idempotentes: [], errores: [] };

test("sin bloque worker, la evidencia dice que nadie informó nada", () => {
  for (const crudo of [undefined, null, "", 7, [], "worker"]) {
    assert.equal(leerEvidencia(crudo).informado, false, `${JSON.stringify(crudo)} no es evidencia`);
  }

  assert.equal(leerEvidencia(VACIO).informado, true);
});

test("lee las listas del worker sin importar mayúsculas ni espacios", () => {
  const e = leerEvidencia({
    acciones_ejecutadas: [" registrar_venta ", "CREAR_PRODUCTO"],
    acciones_idempotentes: ["ajustar_stock"],
    errores: [{ accion: "registrar_compra", error: "  sin proveedor  " }],
  });

  assert.deepEqual(e.ejecutadas, ["REGISTRAR_VENTA", "CREAR_PRODUCTO"]);
  assert.deepEqual(e.idempotentes, ["AJUSTAR_STOCK"]);
  assert.deepEqual(e.errores, [{ accion: "REGISTRAR_COMPRA", error: "sin proveedor" }]);
});

test("un worker con basura adentro no rompe ni inventa", () => {
  const e = leerEvidencia({ acciones_ejecutadas: "REGISTRAR_VENTA", errores: { a: 1 } });

  assert.deepEqual(e.ejecutadas, []);
  assert.deepEqual(e.errores, []);
  assert.equal(e.informado, true);
});

test("los cinco estados salen de la evidencia y no de una deducción", () => {
  const acciones = [{ tipo: "REGISTRAR_VENTA" }];

  const ejecutada = verificarAcciones(acciones, leerEvidencia({ acciones_ejecutadas: ["REGISTRAR_VENTA"] }), false);
  assert.equal(ejecutada[0].estado, "ejecutada");

  const repetida = verificarAcciones(acciones, leerEvidencia({ acciones_idempotentes: ["REGISTRAR_VENTA"] }), false);
  assert.equal(repetida[0].estado, "repetida");

  const fallida = verificarAcciones(
    acciones,
    leerEvidencia({ errores: [{ accion: "REGISTRAR_VENTA", error: "no encontré el producto" }] }),
    false,
  );
  assert.equal(fallida[0].estado, "fallida");
  assert.equal(fallida[0].motivo, "no encontré el producto");

  const pendiente = verificarAcciones(acciones, SIN_EVIDENCIA, true);
  assert.equal(pendiente[0].estado, "pendiente_aprobacion");

  const muda = verificarAcciones(acciones, SIN_EVIDENCIA, false);
  assert.equal(muda[0].estado, "sin_evidencia");
});

test("ejecutada le gana a pendiente: lo hecho manda sobre lo que se estaba por hacer", () => {
  const v = verificarAcciones(
    [{ tipo: "REGISTRAR_VENTA" }],
    leerEvidencia({ acciones_ejecutadas: ["REGISTRAR_VENTA"] }),
    true,
  );

  assert.equal(v[0].estado, "ejecutada");
  assert.ok(huboEfecto(v));
});

test("un error sin acción se le atribuye igual: nada se puede dar por hecho", () => {
  const v = verificarAcciones(
    [{ tipo: "REGISTRAR_COMPRA" }],
    leerEvidencia({ errores: [{ error: "El worker tardó demasiado." }] }),
    false,
  );

  assert.equal(v[0].estado, "fallida");
  assert.equal(v[0].motivo, "El worker tardó demasiado.");
  assert.ok(!huboEfecto(v));
});

test("las acciones sin efecto durable no se verifican", () => {
  assert.deepEqual(
    verificarAcciones([{ tipo: "RESPONDER" }, { tipo: "VER_BRIEFING" }], SIN_EVIDENCIA, false),
    [],
  );
});

test("una acción repetida en el mismo mensaje se verifica una sola vez", () => {
  const v = verificarAcciones(
    [{ tipo: "REGISTRAR_VENTA" }, { tipo: "REGISTRAR_VENTA" }],
    SIN_EVIDENCIA,
    false,
  );

  assert.equal(v.length, 1);
});

/*
 * El quinto de los nueve lugares donde hay que dar de alta una acción.
 *
 * Si alguien agrega una acción a `SYSTEM_RISK` y se olvida de acá, la acción
 * se ejecuta y nadie verifica que haya pasado: EOS puede decir que la hizo sin
 * que nadie lo haya comprobado. Esta prueba hace imposible ese olvido, porque
 * la lista se DERIVA en vez de escribirse.
 */
test("toda acción con riesgo declarado es durable o es de solo lectura", () => {
  const lectura = new Set(["RESPONDER", "VER_DASHBOARD", "VER_BRIEFING"]);

  for (const accion of ACCIONES_CON_RIESGO) {
    assert.ok(
      ACCIONES_DURABLES.has(accion) || lectura.has(accion),
      `${accion} no está clasificada: no se verificaría nunca`,
    );
  }

  assert.equal(ACCIONES_DURABLES.size, ACCIONES_CON_RIESGO.size - lectura.size);
});
