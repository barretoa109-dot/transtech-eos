/**
 * El registro de decisiones terminaba en "error" con cada mensaje que no era
 * una decisión.
 *
 *     SECO=1 node n8n/parches/2026-09-29-decisiones-sin-error.mjs   (prueba)
 *     node n8n/parches/2026-09-29-decisiones-sin-error.mjs          (escribe)
 *
 * Los nodos 01 y 03 corren en modo "una vez por ítem" y descartan con
 * `return []`. En ese modo n8n exige devolver UN objeto y falla con "A 'json'
 * property isn't an object [item 0]". Medido el 2026-09-29: la ejecución de un
 * mensaje real sin palabras de decisión (21:37 UTC del 28, antes de cualquier
 * parche) y la prueba sin secreto terminaron las dos en error en el nodo 01.
 * No escribía nada malo, pero dejaba el registro de n8n lleno de errores
 * falsos, que tapan los verdaderos.
 *
 * Se pasan los dos nodos a "una vez para todos" (el webhook entrega un solo
 * ítem), donde `return []` significa "nada que seguir" y corta limpio. El
 * código original se conserva entero dentro de una función que recibe el ítem
 * como `$json`; en el 03, `.item` (que no existe en ese modo) pasa a
 * `.first()`.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const DECISIONES = "xwFkncvx2T7DYAm8";

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

const r0 = await fetch(`${BASE}/api/v1/workflows/${DECISIONES}`, { headers: CABECERAS });
if (!r0.ok) throw new Error(`GET ${r0.status}`);
const flujo = await r0.json();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-decisiones.json`);
fs.mkdirSync(path.dirname(respaldo), { recursive: true });
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

const ORIGEN_03 = "$('01 F6 Detectar candidato').item.json";

function envolver(codigo) {
  return `// Modo "una vez para todos": el webhook trae un solo ítem. return [] corta limpio.
const salida = (($json) => {
${codigo}
})($input.first().json);
if (!salida || Array.isArray(salida)) return [];
return [{ ...salida, pairedItem: 0 }];
`;
}

async function aplicar() {
  for (const nombre of ["01 F6 Detectar candidato", "03 F6 Validar decision"]) {
    const n = flujo.nodes.find((x) => x.name === nombre);
    if (!n) throw new Error(`No existe "${nombre}". No se tocó nada.`);
    if (n.parameters.mode !== "runOnceForEachItem") {
      console.log(`"${nombre}" ya no está en modo por ítem. No se tocó nada.`);
      return;
    }
    let codigo = n.parameters.jsCode;
    if (nombre.startsWith("03")) {
      if (!codigo.includes(ORIGEN_03)) throw new Error("El nodo 03 cambió. No se tocó nada.");
      codigo = codigo.replace(ORIGEN_03, "$('01 F6 Detectar candidato').first().json");
    } else if (!codigo.includes("EOS_WORKER_GATE_SECRET")) {
      throw new Error("El nodo 01 no tiene la guardia del secreto: correr antes 2026-09-28-webhooks-cerrados.mjs decisiones.");
    }
    n.parameters.jsCode = envolver(codigo);
    delete n.parameters.mode; // el valor por defecto es "una vez para todos"
  }

  console.log(`verificado decisiones: ${verificarFlujo(flujo, "decisiones")} nodos compilan`);

  if (process.env.SECO === "1") {
    console.log("SECO=1: no se escribió nada.");
    return;
  }

  const r = await fetch(`${BASE}/api/v1/workflows/${DECISIONES}`, {
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
  console.log("decisiones actualizado.");

  // Sin secreto: tiene que terminar en "success", sin pasar del nodo 01.
  await fetch(`${BASE}/webhook/eos-decision-capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario_id: "00000000-0000-4000-8000-000000000000", mensaje: "decidí probar", respuesta: "ok" }),
  });
  await new Promise((s) => setTimeout(s, 3000));
  const ex = await (
    await fetch(`${BASE}/api/v1/executions?workflowId=${DECISIONES}&limit=1&includeData=true`, { headers: CABECERAS })
  ).json();
  const ultima = ex.data?.[0];
  const nodos = Object.keys(ultima?.data?.resultData?.runData ?? {});
  console.log(`prueba sin secreto: ${ultima?.status} · nodos: ${nodos.join(" > ")} (se espera success, sin OpenAI)`);
  console.log("Seguir con: node n8n/exportar.mjs decisiones");
}

await aplicar();
