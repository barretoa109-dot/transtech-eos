import assert from "node:assert/strict";
import { test } from "node:test";

import { archivoDesdeCompartido } from "./compartido.ts";

test("convierte la imagen en base64 en un archivo con los mismos bytes, nombre y tipo", async () => {
  const original = new Uint8Array([0, 1, 2, 250, 255]);
  const base64 = Buffer.from(original).toString("base64");

  const archivo = archivoDesdeCompartido({ nombre: "comprobante.jpg", mime: "image/jpeg", base64 });

  assert.equal(archivo.name, "comprobante.jpg");
  assert.equal(archivo.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await archivo.arrayBuffer()), original);
});
