import test from "node:test";
import assert from "node:assert/strict";

import { AVISO_SIN_DOCUMENTOS, respuestaSinDocumentos } from "./sin-modulo.ts";

test("sin el módulo, la respuesta dice qué falta en vez de mandar un enlace roto", () => {
  assert.equal(
    respuestaSinDocumentos("Te armé el balance de septiembre."),
    `Te armé el balance de septiembre.\n\n${AVISO_SIN_DOCUMENTOS}`,
  );
  assert.equal(respuestaSinDocumentos(""), AVISO_SIN_DOCUMENTOS);
  assert.equal(respuestaSinDocumentos(undefined), AVISO_SIN_DOCUMENTOS);
});

test("el aviso no se repite si ya está", () => {
  const una = respuestaSinDocumentos("Listo.");
  assert.equal(respuestaSinDocumentos(una), una);
});
