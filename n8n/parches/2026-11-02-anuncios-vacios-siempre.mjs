/**
 * El caso del relleno (02/11/2026): un anuncio sin un número adentro ("Anoté
 * el saldo.", "La tarea quedó registrada.") no informa nada, salió bien o
 * mal la acción, así que se saca siempre — no solo cuando algo falla o ya
 * estaba. Ver `n8n/parches/cambios-anuncios-vacios-siempre.mjs` y
 * `lib/gateway/sin-anuncios.ts`.
 *
 *     SECO=1 node n8n/parches/2026-11-02-anuncios-vacios-siempre.mjs   (prueba: no escribe)
 *     node n8n/parches/2026-11-02-anuncios-vacios-siempre.mjs          (escribe)
 *
 * Solo toca el gateway (nodo 08). Se corre desde main, después del merge.
 * Después de aplicar:
 *
 *     node n8n/exportar.mjs
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { transformarGateway } from "./cambios-anuncios-vacios-siempre.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const GATEWAY = "JRgzUkoHBKgGpyPA";

function env() {
  const texto = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8");
  const valores = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) valores[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return valores;
}

const { N8N_BASE_URL, N8N_API_KEY } = env();
const BASE = N8N_BASE_URL.replace(/\/$/, "");
const CABECERAS = { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" };

async function traer(id, intentos = 6) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: CABECERAS });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === intentos) throw e;
      await new Promise((s) => setTimeout(s, 1500 * i));
    }
  }
  return null;
}

function respaldar(flujo, etiqueta) {
  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const destino = path.join(RAIZ, "n8n", "respaldos", `${sello}-${etiqueta}.json`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, destino)} (updatedAt ${flujo.updatedAt})`);
}

async function escribir(id, flujo, etiqueta) {
  console.log(`verificado ${etiqueta}: ${verificarFlujo(flujo, etiqueta)} nodos compilan`);

  if (process.env.SECO === "1") return;

  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, {
    method: "PUT",
    headers: CABECERAS,
    body: JSON.stringify({
      name: flujo.name,
      nodes: flujo.nodes,
      connections: flujo.connections,
      settings: flujo.settings ?? {},
    }),
  });

  if (!r.ok) throw new Error(`PUT ${etiqueta} falló: ${r.status} ${await r.text()}`);
  console.log(`${etiqueta} actualizado.`);
}

const gateway = await traer(GATEWAY);
respaldar(gateway, "gateway");

transformarGateway(gateway);

await escribir(GATEWAY, gateway, "gateway");
