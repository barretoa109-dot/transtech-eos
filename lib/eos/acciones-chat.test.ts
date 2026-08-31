import assert from "node:assert/strict";
import test from "node:test";

import { agregarAccesoAprobacion } from "./acciones-chat.ts";

test("las acciones de negocio muestran cómo completar el registro", () => {
  const respuesta = agregarAccesoAprobacion(
    "Dejé la venta lista para confirmar.",
    [{ tipo: "REGISTRAR_VENTA" }],
    "https://transtech.com.py",
  );

  assert.match(respuesta, /aprobá la operación pendiente/i);
  assert.match(respuesta, /https:\/\/transtech\.com\.py\/eos\/autonomy/);
});

test("una respuesta informativa no agrega una aprobación", () => {
  assert.equal(
    agregarAccesoAprobacion("Este es tu resumen.", [], "https://transtech.com.py"),
    "Este es tu resumen.",
  );
});
