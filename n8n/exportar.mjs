/**
 * Reexportar los workflows de n8n al repositorio, sin credenciales.
 *
 *     node n8n/exportar.mjs            (los dos)
 *     node n8n/exportar.mjs gateway    (uno)
 *
 * Cada parche reexporta al final, pero la instancia de n8n está en Railway y
 * la conexión se corta seguido: el 7 de septiembre un parche aplicó el PUT y
 * murió en el GET siguiente, dejando el workflow cambiado en producción y la
 * copia del repo vieja. Esa divergencia es invisible —el chat funciona— hasta
 * que alguien lee el JSON del repo creyendo que es lo que está corriendo.
 *
 * Reintenta, porque la falla es de red y no del contenido.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);

const FLUJOS = {
  gateway: { id: "JRgzUkoHBKgGpyPA", archivo: "eos-conversational-gateway-rc1.json" },
  worker: { id: "iUMdg9fhAg54irmy", archivo: "eos-background-worker-rc1.json" },
};

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

async function traer(id, intentos = 6) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/v1/workflows/${id}`, {
        headers: { "X-N8N-API-KEY": N8N_API_KEY },
      });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === intentos) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  return null;
}

const pedidos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FLUJOS);

for (const nombre of pedidos) {
  const flujo = FLUJOS[nombre];
  if (!flujo) throw new Error(`No conozco el workflow "${nombre}". Son: ${Object.keys(FLUJOS).join(", ")}`);

  const w = await traer(flujo.id);
  for (const n of w.nodes) delete n.credentials;

  const destino = path.join(RAIZ, "n8n", "workflows", flujo.archivo);
  const antes = fs.existsSync(destino) ? fs.readFileSync(destino, "utf8") : "";
  const ahora = JSON.stringify(
    { name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings },
    null,
    2,
  );

  fs.writeFileSync(destino, ahora);
  console.log(`${nombre}: ${antes === ahora ? "sin cambios" : "actualizado"} (updatedAt ${w.updatedAt})`);
}
