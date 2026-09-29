/**
 * El flujo que contesta correos con IA no se engancha en un ida y vuelta.
 *
 *     SECO=1 node n8n/parches/2026-09-29-correo-sin-ida-y-vuelta.mjs   (prueba)
 *     node n8n/parches/2026-09-29-correo-sin-ida-y-vuelta.mjs          (escribe)
 *
 * "EOS - Correo ESTABLE - Prueba controlada" (`fUrFN1LTuqiUlKgq`) lee la
 * casilla de Gmail cada minuto y contesta TODO correo nuevo con IA desde
 * ventas@transtech.com.py. Descartaba solo los propios y los no-reply.
 *
 * Revisado el 29/09/2026, le faltaban dos frenos:
 *
 * - Una respuesta automática ("fuera de la oficina", un acuse de recibo de un
 *   sistema de tickets) llega desde una dirección normal. EOS le contesta, esa
 *   dirección contesta de nuevo, y así cada minuto: correos sin fin desde el
 *   dominio, que es lo que manda un dominio a spam, y tokens de OpenAI.
 * - Newsletters, promociones y lo que Gmail ya marcó como spam también
 *   recibían respuesta.
 *
 * El parche agrega al nodo "Preparar correo EOS1", después del filtro de
 * siempre: descarta asuntos de respuesta automática, las categorías masivas de
 * Gmail y los hilos con tres o más "Re:", y pone un tope de tres respuestas
 * por remitente y por día guardado en los datos estáticos del workflow
 * (sobrevive entre ejecuciones y no necesita base).
 *
 * ============================================================
 * Y POR QUÉ NUNCA CORRIÓ
 * ============================================================
 *
 * El 29/09 el flujo figuraba activo pero no registraba ninguna ejecución, ni
 * con un correo entregado a la casilla. Al abrirlo, n8n decía "Unrecognized
 * node type: n8n-nodes-resend.resend": el envío usaba un nodo de la comunidad
 * que ya no está instalado en la instancia de Railway (los nodos de la
 * comunidad viven en el disco del contenedor y se pierden en un redeploy). Sin
 * ese tipo de nodo el workflow entero no arranca.
 *
 * Se reemplaza por un "HTTP Request" de n8n contra la API de Resend, con el
 * mismo nombre para no tocar las conexiones. La clave sale de
 * `$env.RESEND_API_KEY` (variable de entorno de n8n en Railway), igual que el
 * gateway lee `$env.EOS_WORKER_GATE_SECRET`: no hay credencial que cargar.
 * Si la variable no está, Resend contesta 401 y la ejecución queda en error a
 * la vista, sin mandar nada.
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
const ANCLA = "if (propio || automatico) {\n  return [];\n}";

const FRENOS = `

// Respuestas automáticas, correos masivos y hilos largos: contestarles arma un
// ida y vuelta sin fin desde ventas@ (ver n8n/parches/2026-09-29-correo-sin-ida-y-vuelta.mjs).
const etiquetas = Array.isArray(j.labelIds) ? j.labelIds : [];
const masivo = etiquetas.some((l) =>
  ['SPAM', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'].includes(l),
);
const respuestaAutomatica =
  /(respuesta autom|automatic reply|auto.?reply|autoreply|out of office|fuera de (la )?oficina|de vacaciones|undeliverable|no se pudo entregar|delivery status|mail delivery)/i.test(asuntoOriginal);
const hiloLargo = (asuntoOriginal.match(/\\b(re|rv|fw|fwd)\\s*:/gi) || []).length >= 3;

if (masivo || respuestaAutomatica || hiloLargo) {
  return [];
}

// Tope: tres respuestas por remitente y por día.
const memoria = $getWorkflowStaticData('global');
const hoy = new Date().toISOString().slice(0, 10);
if (!memoria.respuestas || memoria.respuestas.dia !== hoy) {
  memoria.respuestas = { dia: hoy, por: {} };
}
const yaRespondidas = memoria.respuestas.por[emailCliente] || 0;
if (yaRespondidas >= 3) {
  return [];
}
memoria.respuestas.por[emailCliente] = yaRespondidas + 1;`;

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

  const nodo = flujo.nodes.find((n) => n.name === "Preparar correo EOS1");
  if (!nodo) throw new Error('No existe "Preparar correo EOS1". No se tocó nada.');
  const envio = flujo.nodes.find((n) => n.name === "Enviar respuesta por Resend1");
  if (!envio) throw new Error('No existe "Enviar respuesta por Resend1". No se tocó nada.');

  const codigo = nodo.parameters.jsCode.replace(/\r\n/g, "\n");
  const faltanFrenos = !codigo.includes("getWorkflowStaticData");
  const faltaEnvio = envio.type !== "n8n-nodes-base.httpRequest";
  if (!faltanFrenos && !faltaEnvio) {
    console.log("El flujo ya tiene los frenos y el envío estándar. Nada que hacer.");
    return;
  }
  if (faltanFrenos && !codigo.includes(ANCLA)) {
    throw new Error("El nodo cambió desde que se escribió este parche. No se tocó nada.");
  }
  if (nodo.parameters.mode === "runOnceForEachItem") {
    throw new Error("El nodo corre por ítem: `return []` ahí es un error. Revisar antes de aplicar.");
  }

  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-correo.json`);
  fs.mkdirSync(path.dirname(respaldo), { recursive: true });
  fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

  if (faltanFrenos) nodo.parameters.jsCode = codigo.replace(ANCLA, ANCLA + FRENOS);

  if (faltaEnvio) {
    envio.type = "n8n-nodes-base.httpRequest";
    envio.typeVersion = 4.2;
    delete envio.credentials;
    envio.parameters = {
      method: "POST",
      url: "https://api.resend.com/emails",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Authorization", value: "={{ 'Bearer ' + $env.RESEND_API_KEY }}" },
          { name: "Content-Type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ from: $json.from, to: [$json.to], subject: $json.subject, html: $json.html }) }}",
      options: { timeout: 30000 },
    };
  }

  console.log(`verificado correo: ${verificarFlujo(flujo, "correo")} nodos compilan`);

  if (process.env.SECO === "1") {
    console.log("SECO=1: no se escribió nada.");
    return;
  }

  const r = await fetch(`${BASE}/api/v1/workflows/${CORREO}`, {
    method: "PUT",
    headers: CABECERAS,
    body: JSON.stringify({
      name: flujo.name,
      nodes: flujo.nodes,
      connections: flujo.connections,
      settings: flujo.settings ?? {},
    }),
  });
  if (!r.ok) throw new Error(`PUT falló: ${r.status} ${await r.text()}`);
  console.log("correo actualizado.");
}

await aplicar();
