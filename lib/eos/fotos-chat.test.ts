import test from "node:test";
import assert from "node:assert/strict";

import {
  etiquetaDeAdjuntos,
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

test("si la persona no escribió nada, la burbuja queda solo con las fotos", () => {
  assert.equal(
    textoSinReferenciaDeFotos("Analizá estas 2 imágenes\n\n[Imágenes adjuntas: a.jpg, b.jpg]", 2),
    "",
  );
  assert.equal(
    textoSinReferenciaDeFotos("Analizá esta imagen: a.jpg\n\n[Imagen adjunta: a.jpg]", 1),
    "",
  );

  // Lo que sí escribió la persona se queda, aunque empiece igual.
  assert.equal(
    textoSinReferenciaDeFotos("Analizá estas 2 imágenes y sumá los totales\n\n[Imágenes adjuntas: a.jpg, b.jpg]", 2),
    "Analizá estas 2 imágenes y sumá los totales",
  );

  // Sin miniaturas, el texto se ve entero como siempre.
  assert.equal(
    textoSinReferenciaDeFotos("Analizá estas 2 imágenes\n\n[Imágenes adjuntas: a.jpg, b.jpg]", 0),
    "Analizá estas 2 imágenes\n\n[Imágenes adjuntas: a.jpg, b.jpg]",
  );
});

test("fotos y videos se nombran para poder ocultar la línea cuando se ven", () => {
  assert.equal(etiquetaDeAdjuntos(["image/jpeg"]), "Imagen adjunta");
  assert.equal(etiquetaDeAdjuntos(["video/mp4"]), "Video adjunto");
  assert.equal(etiquetaDeAdjuntos(["video/mp4", "video/quicktime"]), "Videos adjuntos");
  assert.equal(etiquetaDeAdjuntos(["image/png", "video/mp4"]), "Fotos y videos adjuntos");
  assert.equal(etiquetaDeAdjuntos(["image/png", "application/pdf"]), "Archivos adjuntos");

  assert.equal(textoSinReferenciaDeFotos("Analizá este video: a.mov\n\n[Video adjunto: a.mov]", 1), "");
  assert.equal(
    textoSinReferenciaDeFotos("¿Qué falta en la góndola?\n\n[Fotos y videos adjuntos: a.jpg, b.mov]", 2),
    "¿Qué falta en la góndola?",
  );
  assert.equal(textoSinReferenciaDeFotos("Analizá estos 2 archivos\n\n[Fotos y videos adjuntos: a.jpg, b.mov]", 2), "");
});

test("la duración de un video vuelve de la metadata, y solo si es un número", () => {
  const [video, foto] = fotosDeMetadata({
    imagenes: [
      { ruta: `${YO}/v.jpg`, nombre: "v.mov", tipo: "video/quicktime", duracion: 42.5 },
      { ruta: `${YO}/f.jpg`, nombre: "f.jpg", tipo: "image/jpeg", duracion: "mucho" },
    ],
  });

  assert.equal(video.duracion, 42.5);
  assert.equal("duracion" in foto, false);
});
