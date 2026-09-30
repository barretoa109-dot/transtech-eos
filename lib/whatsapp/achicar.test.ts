import test from "node:test";
import assert from "node:assert/strict";

import sharp from "sharp";

import { LADO_MAXIMO, achicarImagen } from "./achicar.ts";

/** Una foto "de celular": grande y con ruido, que es lo que no se comprime solo. */
async function fotoGrande(ancho: number, alto: number, formato: "jpeg" | "png" = "jpeg"): Promise<Buffer> {
  const ruido = Buffer.alloc(ancho * alto * 3);
  // Ruido de verdad: un patrón periódico lo comprime el PNG mejor que el JPEG.
  let semilla = 12345;
  for (let i = 0; i < ruido.length; i++) {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
    ruido[i] = semilla >> 23;
  }
  const img = sharp(ruido, { raw: { width: ancho, height: alto, channels: 3 } });
  return formato === "png" ? img.png().toBuffer() : img.jpeg({ quality: 95 }).toBuffer();
}

test("una foto de 4000 x 3000 queda en 1600 de lado largo, en JPEG y más liviana", async () => {
  const original = await fotoGrande(4000, 3000);
  const r = await achicarImagen(original, "image/jpeg");
  const meta = await sharp(r.bytes).metadata();
  assert.equal(r.achicada, true);
  assert.equal(r.tipo, "image/jpeg");
  assert.equal(Math.max(meta.width ?? 0, meta.height ?? 0), LADO_MAXIMO);
  assert.ok(r.bytes.length < original.length / 3, `${r.bytes.length} vs ${original.length}`);
});

test("una captura en PNG también se achica, sin fondo negro", async () => {
  const conTransparencia = await sharp({
    create: { width: 2400, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const ruidosa = await fotoGrande(2400, 1200, "png");
  const r = await achicarImagen(ruidosa, "image/png");
  assert.equal(r.achicada, true);

  const transparente = await achicarImagen(conTransparencia, "image/png");
  if (transparente.achicada) {
    const { data } = await sharp(transparente.bytes).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 200, "el fondo transparente queda blanco");
  }
});

test("una foto chica no se agranda, y nunca sale más pesada que la original", async () => {
  const chica = await fotoGrande(300, 200);
  const r = await achicarImagen(chica, "image/jpeg");
  const meta = await sharp(r.bytes).metadata();
  assert.equal(meta.width, 300);
  assert.equal(meta.height, 200);
  assert.ok(r.bytes.length <= chica.length);
});

test("lo que no es foto, o no se puede abrir, sale tal cual", async () => {
  const pdf = Buffer.from("%PDF-1.4 nada");
  assert.equal((await achicarImagen(pdf, "application/pdf")).bytes, pdf);
  const gif = Buffer.from("GIF89a");
  assert.equal((await achicarImagen(gif, "image/gif")).achicada, false);

  const errorOriginal = console.error;
  console.error = () => {};
  try {
    const roto = Buffer.from("esto no es un jpeg");
    const r = await achicarImagen(roto, "image/jpeg");
    assert.equal(r.bytes, roto);
    assert.equal(r.tipo, "image/jpeg");
  } finally {
    console.error = errorOriginal;
  }
});
