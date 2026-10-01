import assert from "node:assert/strict";
import { test } from "node:test";

import { metadatosDePagina } from "./metadatos.ts";

test("la vista previa al compartir usa el título y la descripción de la página", () => {
  const m = metadatosDePagina({ titulo: "Planes · TransTech EOS", descripcion: "Armá el EOS que vas a usar.", ruta: "/planes" });
  assert.deepEqual(m.title, { absolute: "Planes · TransTech EOS" }, "sin absolute, la plantilla del layout duplica la marca");
  assert.equal(m.openGraph?.title, "Planes · TransTech EOS");
  assert.equal(m.openGraph?.description, "Armá el EOS que vas a usar.");
  assert.equal(m.twitter?.title, "Planes · TransTech EOS");
  assert.equal(m.alternates?.canonical, "/planes");
});

test("sin ruta no se declara canónica (un layout que cubre subpáginas)", () => {
  const m = metadatosDePagina({ titulo: "EOS", descripcion: "x" });
  assert.equal(m.alternates, undefined);
});
