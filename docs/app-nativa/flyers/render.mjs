// Renderiza los 7 flyers de flyers.html a PNG, en cada tamaño que pide App Store Connect.
// Uso: node docs/app-nativa/flyers/render.mjs
//
// El diseño se arma una sola vez a 1290 × 2796 y para cada tamaño se escala
// entero dentro del lienzo de destino: el navegador lo vuelve a dibujar a esa
// escala (texto y vectores nítidos), y la captura sale con los píxeles exactos
// que valida Apple. Si la proporción difiere un poco, se recortan uno o dos
// píxeles de fondo a los costados, nunca contenido.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// playwright puede no estar en node_modules del repo: se resuelve como CommonJS (respeta NODE_PATH).
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = path.dirname(fileURLToPath(import.meta.url));

const BASE = { ancho: 1290, alto: 2796 };

// Espacios de capturas de iPhone en App Store Connect.
const tamanios = [
  // "iPhone con Dynamic Island (pantalla mediana)": 6,1" y 6,3". Acepta 1206 × 2622 o 1179 × 2556.
  { carpeta: "iphone-6.3", ancho: 1206, alto: 2622 },
  // Pantalla grande: 6,7" y 6,9".
  { carpeta: "iphone-6.9", ancho: 1290, alto: 2796 },
];

// Orden de la ficha: [id de la sección en flyers.html, nombre del archivo].
const piezas = [
  ["fp", "1-crece"],
  ["f1", "2-organiza"],
  ["f4", "3-administra"],
  ["fd", "4-deudas"],
  ["f5", "5-ahorro-metas"],
  ["f2", "6-negocio"],
  ["f6", "7-documentos"],
];

const browser = await chromium.launch();
for (const t of tamanios) {
  const page = await browser.newPage({ viewport: { width: BASE.ancho, height: BASE.alto }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(dir, "flyers.html")).href);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(({ base, t }) => {
    const escala = t.alto / base.alto;
    for (const flyer of document.querySelectorAll(".flyer")) {
      const lienzo = document.createElement("div");
      lienzo.style.cssText = `position:absolute;top:0;left:50%;width:${base.ancho}px;height:${base.alto}px;transform-origin:top center;transform:translateX(-50%) scale(${escala})`;
      lienzo.append(...flyer.childNodes);
      flyer.append(lienzo);
      flyer.style.width = `${t.ancho}px`;
      flyer.style.height = `${t.alto}px`;
    }
  }, { base: BASE, t });
  const carpeta = path.join(dir, "png", t.carpeta);
  mkdirSync(carpeta, { recursive: true });
  for (const [id, nombre] of piezas) {
    const salida = path.join(carpeta, `eos-${t.carpeta}-${nombre}.png`);
    await page.locator(`#${id}`).screenshot({ path: salida });
    console.log(path.relative(dir, salida));
  }
  await page.close();
}
await browser.close();
