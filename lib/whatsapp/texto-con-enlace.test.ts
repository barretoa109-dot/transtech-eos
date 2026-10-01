import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENTO_GUARDADO, textoConEnlace } from "./texto-con-enlace.ts";

const EXCEL = "https://www.transtech.com.py/descargar?tipo=excel&nombre=control&command_id=1";

test("el enlace del Excel no se repite si la respuesta ya lo trae", () => {
  const respuesta = `Tu Excel ya está listo.\n\nDescargar archivo: ${EXCEL}`;
  assert.equal(textoConEnlace(respuesta, EXCEL), respuesta);
});

test("un enlace absoluto que no está en el texto se agrega al final", () => {
  assert.equal(textoConEnlace("Listo.", EXCEL), `Listo.\n\n${EXCEL}`);
});

test("un documento guardado no va como enlace: se manda adjunto", () => {
  const doc = "/api/documentos/123e4567-e89b-42d3-a456-426614174000?formato=xlsx";
  assert.ok(DOCUMENTO_GUARDADO.test(doc));
  assert.equal(textoConEnlace("Tu informe.", doc), "Tu informe.");
});

test("sin enlace o con uno relativo desconocido, el texto queda igual", () => {
  assert.equal(textoConEnlace("Hola", ""), "Hola");
  assert.equal(textoConEnlace("Hola", "/otra/ruta"), "Hola");
});
