import test from "node:test";
import assert from "node:assert/strict";

import {
  fotosDeMetadata,
  rutaDeFoto,
  rutaEsDe,
  textoSinReferenciaDeFotos,
  tipoDeFotoAceptado,
} from "./fotos-chat.ts";

const YO = "7f1c2d3e-0000-4000-8000-000000000001";
const OTRO = "7f1c2d3e-0000-4000-8000-000000000002";

test("la ruta de una foto nueva empieza con el usuario y sale firmable", () => {
  const ruta = rutaDeFoto(YO, "a1b2c3d4-0000-4000-8000-000000000009", "image/png");
  assert.equal(ruta, `${YO}/a1b2c3d4-0000-4000-8000-000000000009.png`);
  assert.equal(rutaEsDe(YO, ruta), true);
});

test("no se firma la foto de otra cuenta ni una ruta con trampa", () => {
  assert.equal(rutaEsDe(YO, `${OTRO}/abc.jpg`), false);
  assert.equal(rutaEsDe(YO, `${YO}/../${OTRO}/abc.jpg`), false);
  assert.equal(rutaEsDe(YO, `${YO}/sub/abc.jpg`), false);
  assert.equal(rutaEsDe(YO, `${YO}/abc.svg`), false);
  assert.equal(rutaEsDe(YO, 42), false);
  assert.equal(rutaEsDe("", `/abc.jpg`), false);
});

test("solo se aceptan fotos, no PDF ni SVG", () => {
  assert.equal(tipoDeFotoAceptado("image/jpeg"), true);
  assert.equal(tipoDeFotoAceptado("IMAGE/PNG"), true);
  assert.equal(tipoDeFotoAceptado("image/svg+xml"), false);
  assert.equal(tipoDeFotoAceptado("application/pdf"), false);
});

test("la metadata se lee con desconfianza y nunca da más de diez", () => {
  assert.deepEqual(fotosDeMetadata(null), []);
  assert.deepEqual(fotosDeMetadata({ imagenes: "x" }), []);

  const muchas = Array.from({ length: 14 }, (_, i) => ({ ruta: `${YO}/f${i}.jpg`, nombre: `f${i}.jpg` }));
  const fotos = fotosDeMetadata({ imagenes: [null, { nombre: "sin ruta" }, ...muchas] });

  assert.equal(fotos.length, 10);
  assert.deepEqual(fotos[0], { ruta: `${YO}/f0.jpg`, nombre: "f0.jpg", tipo: "" });
});

test("se saca la línea de las fotos solo si todas tienen miniatura", () => {
  assert.equal(
    textoSinReferenciaDeFotos("Cambiá esto\n\n[Imagen adjunta: IMG_4957.jpg]", 1),
    "Cambiá esto",
  );
  assert.equal(textoSinReferenciaDeFotos("Mirá\n\n[Imágenes adjuntas: a.jpg, b.jpg]", 2), "Mirá");

  // Una de las dos no se pudo guardar: la línea es lo único que la nombra.
  assert.equal(
    textoSinReferenciaDeFotos("Mirá\n\n[Imágenes adjuntas: a.jpg, b.jpg]", 1),
    "Mirá\n\n[Imágenes adjuntas: a.jpg, b.jpg]",
  );

  // Con un PDF en el mismo mensaje, la línea nombra al PDF y se queda.
  assert.equal(
    textoSinReferenciaDeFotos("Mirá\n\n[Archivos adjuntos: a.jpg, b.pdf]", 1),
    "Mirá\n\n[Archivos adjuntos: a.jpg, b.pdf]",
  );

  assert.equal(textoSinReferenciaDeFotos("Sin fotos", 0), "Sin fotos");
});
