// Renderiza los 7 flyers de flyers.html a PNG de 1290 × 2796 (App Store, iPhone 6,9").
// Uso: node docs/app-nativa/flyers/render.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// playwright puede no estar en node_modules del repo: se resuelve como CommonJS (respeta NODE_PATH).
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = path.dirname(fileURLToPath(import.meta.url));
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
const page = await browser.newPage({ viewport: { width: 1290, height: 2796 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(dir, "flyers.html")).href);
await page.evaluate(() => document.fonts.ready);
for (const [id, nombre] of piezas) {
  const salida = path.join(dir, "png", `eos-app-store-${nombre}.png`);
  await page.locator(`#${id}`).screenshot({ path: salida });
  console.log(salida);
}
await browser.close();
