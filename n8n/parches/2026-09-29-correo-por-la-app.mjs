/**
 * El flujo de correo manda sus respuestas a través de la app, no con su propia
 * clave de Resend.
 *
 *     SECO=1 node n8n/parches/2026-09-29-correo-por-la-app.mjs   (prueba)
 *     node n8n/parches/2026-09-29-correo-por-la-app.mjs          (escribe)
 *
 * Se aplica DESPUÉS de que `/api/internal/correo-ventas` esté desplegada.
 *
 * El 29/09/2026 cada respuesta fallaba con 401: `$env.RESEND_API_KEY` llegaba
 * vacía al proceso de n8n (la variable estaba en Railway, pero el deploy que la
 * aplicaba no había tomado; n8n veía todas las demás). En vez de mantener una
 * segunda copia de la clave, el nodo "Enviar respuesta por Resend1" le pasa
 * destinatario, asunto y cuerpo a la app, autenticado con
 * `$env.EOS_WORKER_GATE_SECRET`, que n8n sí tiene y ya usa para el worker.
 * Qué valida la ruta: `lib/email/correo-ventas.ts`.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const CORREO = "fUrFN1LTuqiUlKgq";
const DESTINO = "https://www.transtech.com.py/api/internal/correo-ventas";

function env() {
  if (process.env.N8N_BASE_URL && process.env.N8N_API_KEY) return process.env;
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

async function aplicar() {
  const r0 = await fetch(`${BASE}/api/v1/workflows/${CORREO}`, { headers: CABECERAS });
  if (!r0.ok) throw new Error(`GET ${r0.status}`);
  const flujo = await r0.json();

  const envio = flujo.nodes.find((n) => n.name === "Enviar respuesta por Resend1");
  if (!envio || envio.type !== "n8n-nodes-base.httpRequest") {
    throw new Error("El nodo de envío no es el HTTP Request del parche anterior. No se tocó nada.");
  }
  if (envio.parameters.url === DESTINO) {
    console.log("El flujo ya manda por la app. Nada que hacer.");
    return;
  }

  // Que la ruta exista antes de apuntarle: sin secreto tiene que contestar 401, no 404.
  const sonda = await fetch(DESTINO, { method: "POST", body: "{}" });
  if (sonda.status !== 401) {
    throw new Error(`${DESTINO} contestó ${sonda.status} sin secreto (se esperaba 401). ¿Está desplegada? No se tocó nada.`);
  }

  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-correo.json`);
  fs.mkdirSync(path.dirname(respaldo), { recursive: true });
  fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

  envio.parameters = {
    method: "POST",
    url: DESTINO,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "Authorization", value: "={{ 'Bearer ' + $env.EOS_WORKER_GATE_SECRET }}" },
        { name: "Content-Type", value: "application/json" },
      ],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ to: $json.to, subject: $json.subject, html: $json.html }) }}",
    options: { timeout: 30000 },
  };
  for (const n of flujo.nodes) delete n.settings;

  console.log(`verificado correo: ${verificarFlujo(flujo, "correo")} nodos compilan`);
  if (process.env.SECO === "1") {
    console.log("SECO=1: no se escribió nada.");
    return;
  }

  const r = await fetch(`${BASE}/api/v1/workflows/${CORREO}`, {
    method: "PUT",
    headers: CABECERAS,
    body: JSON.stringify({ name: flujo.name, nodes: flujo.nodes, connections: flujo.connections, settings: flujo.settings ?? {} }),
  });
  if (!r.ok) throw new Error(`PUT falló: ${r.status} ${await r.text()}`);
  console.log("correo actualizado: ahora manda por la app.");
}

await aplicar();
