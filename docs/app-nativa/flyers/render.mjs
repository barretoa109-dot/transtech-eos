// Renderiza los 6 flyers de flyers.html a PNG de 1290 × 2796 (App Store, iPhone 6,9").
// Uso: node docs/app-nativa/flyers/render.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// playwright puede no estar en node_modules del repo: se resuelve como CommonJS (respeta NODE_PATH).
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = path.dirname(fileURLToPath(import.meta.url));
const nombres = ["1-conversa", "2-negocio", "3-ventas-cobros", "4-finanzas", "5-objetivos", "6-documentos"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1290, height: 2796 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(dir, "flyers.html")).href);
await page.evaluate(() => document.fonts.ready);
for (let i = 0; i < nombres.length; i++) {
  const salida = path.join(dir, "png", `eos-app-store-${nombres[i]}.png`);
  await page.locator(`#f${i + 1}`).screenshot({ path: salida });
  console.log(salida);
}
await browser.close();
