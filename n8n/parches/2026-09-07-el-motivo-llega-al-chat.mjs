/**
 * El último tramo: que el motivo del error llegue al chat.
 *
 *     node n8n/parches/2026-09-07-el-motivo-llega-al-chat.mjs
 *
 * ============================================================
 * TRES PÉRDIDAS, ESTA ES LA TERCERA
 * ============================================================
 *
 * Cuando una acción del negocio falla por una regla —no encontré el producto,
 * no encontré el contacto, falta el módulo— el motivo tenía que atravesar tres
 * saltos, y se perdía en los tres:
 *
 *   1. La aplicación respondía 500 con "No fue posible ejecutar el efecto
 *      interno" para las seis reglas de negocio. Arreglado en el repositorio
 *      (`lib/eos/errores-accion.ts`): ahora responde 422 con una frase que
 *      dice el siguiente paso.
 *
 *   2. El nodo 05 del worker ponía el objeto de error de Axios —con su stack—
 *      en el campo `respuesta`. Arreglado por los dos parches anteriores de
 *      hoy: ahora extrae el texto del cuerpo.
 *
 *   3. **Este.** El nodo 08 del gateway junta lo que devolvió el worker, y los
 *      resultados con error solo aportan el NOMBRE de la acción: sale "No pude
 *      completar automáticamente: REGISTRAR_VENTA" y el motivo, que venía
 *      adentro del mismo resultado, se descarta.
 *
 * Probado de punta a punta contra producción: alguien pidió "vendí 3 bolsas de
 * balanceado a Rossana" y leyó esa frase seca. El resultado ya traía "No
 * encontré a Rossana entre tus contactos. Pedime que la agende primero" — la
 * diferencia entre un callejón sin salida y algo que se resuelve en cinco
 * segundos.
 *
 * ============================================================
 * QUÉ QUEDA IGUAL
 * ============================================================
 *
 * La frase con el nombre de la acción no desaparece: se reserva para cuando de
 * verdad no hay motivo. Si el worker devolvió su propia frase genérica —"No
 * fue posible completar la acción interna."— eso no es un motivo, y decir cuál
 * acción falló es más útil.
 *
 * El mismo criterio está en `lib/gateway/resultados.ts`, que es el puerto en
 * TypeScript de este nodo, con sus pruebas. Los dos tienen que decir lo mismo.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "JRgzUkoHBKgGpyPA";

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

async function traer() {
  const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, { headers: CABECERAS });
  if (!r.ok) throw new Error(`GET falló: ${r.status} ${await r.text()}`);
  return r.json();
}

const VIEJO = `if (errores.length) {
  const accionesConError = errores
    .map(accionDe)
    .filter(Boolean);

  if (accionesConError.length) {
    respuesta =
      \`\${respuesta}\\n\\nNo pude completar automáticamente: \${
        [...new Set(accionesConError)].join(', ')
      }.\`.trim();
  }
}`;

const NUEVO = `if (errores.length) {
  /*
    Un error se dice, y se dice POR QUÉ si se sabe.

    Antes esto solo nombraba la acción, y el motivo —que viene adentro del
    mismo resultado— se descartaba. "No pude completar automáticamente:
    REGISTRAR_VENTA" deja a la persona en un callejón sin salida; "no encontré
    a Rossana entre tus contactos, pedime que la agende primero" la deja a un
    paso de resolverlo.

    Mismo criterio que \`lib/gateway/resultados.ts\`, que es el puerto de este
    nodo. Los dos tienen que decir lo mismo.
  */
  const MOTIVO_GENERICO = 'No fue posible completar la acción interna.';

  const motivos = [];
  const sinMotivo = [];

  for (const error of errores) {
    const texto = extraerTexto(error);

    if (texto && texto !== MOTIVO_GENERICO) motivos.push(texto);
    else sinMotivo.push(accionDe(error));
  }

  const unicos = [...new Set(motivos)].filter(
    (t) => !respuesta.includes(t)
  );

  if (unicos.length) {
    respuesta = \`\${respuesta}\\n\\n\${unicos.join('\\n\\n')}\`.trim();
  }

  // Sin motivo se nombra la acción, que es lo único que se sabe.
  const accionesConError = [...new Set(sinMotivo.filter(Boolean))];

  if (accionesConError.length) {
    respuesta =
      \`\${respuesta}\\n\\nNo pude completar automáticamente: \${
        accionesConError.join(', ')
      }.\`.trim();
  }
}`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-gateway.json`);
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

const nodo = flujo.nodes.find((n) => n.name.startsWith("08 GW"));
if (!nodo) throw new Error('No existe el nodo "08 GW Agregar Resultados Worker".');

if (nodo.parameters.jsCode.includes("MOTIVO_GENERICO")) {
  throw new Error("El nodo 08 ya está parcheado. No se escribió nada.");
}

if (!nodo.parameters.jsCode.includes(VIEJO)) {
  throw new Error("El bloque de errores ya no está tal cual. No se escribió nada.");
}

nodo.parameters.jsCode = nodo.parameters.jsCode.replace(VIEJO, NUEVO);

const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, {
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
console.log("workflow actualizado.");

const nuevo = await traer();
for (const n of nuevo.nodes) delete n.credentials;
fs.writeFileSync(
  path.join(RAIZ, "n8n", "workflows", "eos-conversational-gateway-rc1.json"),
  JSON.stringify(
    { name: nuevo.name, nodes: nuevo.nodes, connections: nuevo.connections, settings: nuevo.settings },
    null,
    2,
  ),
);
console.log("reexportado a n8n/workflows/eos-conversational-gateway-rc1.json");
