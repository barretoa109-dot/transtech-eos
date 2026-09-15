// Script de un solo uso: regenera app/favicon.ico a partir de public/icon-192.png
// (ya cuadrado y de marca, ver PWA icons de la v RC1), en vez del favicon
// viejo que databa de antes del logo actual. No se deja como parte del build:
// se corre a mano cuando el logo cambie de nuevo.
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const TAMANOS = [16, 32];

function construirIco(pngsPorTamano) {
  const cantidad = pngsPorTamano.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo: ícono
  header.writeUInt16LE(cantidad, 4);

  const entradas = [];
  const datos = [];
  let offset = 6 + cantidad * 16;

  for (const { tamano, png } of pngsPorTamano) {
    const entrada = Buffer.alloc(16);
    entrada.writeUInt8(tamano === 256 ? 0 : tamano, 0);
    entrada.writeUInt8(tamano === 256 ? 0 : tamano, 1);
    entrada.writeUInt8(0, 2); // paleta de colores: ninguna
    entrada.writeUInt8(0, 3); // reservado
    entrada.writeUInt16LE(1, 4); // planos
    entrada.writeUInt16LE(32, 6); // bits por píxel
    entrada.writeUInt32LE(png.length, 8);
    entrada.writeUInt32LE(offset, 12);

    entradas.push(entrada);
    datos.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...entradas, ...datos]);
}

const pngsPorTamano = await Promise.all(
  TAMANOS.map(async (tamano) => ({
    tamano,
    png: await sharp("public/icon-192.png").resize(tamano, tamano).png().toBuffer(),
  })),
);

writeFileSync("app/favicon.ico", construirIco(pngsPorTamano));
console.log(`app/favicon.ico regenerado con ${TAMANOS.join("x, ")}x desde public/icon-192.png`);
