/**
 * "Cerró 1 facturas."
 *
 *     node n8n/parches/2026-09-10-cerro-1-facturas.mjs
 *
 * Salió en la primera conversación real contra producción:
 *
 *   > me dio 25 mil ZZ Rossana Prueba
 *   Cobré ₲ 25.000 a Rossana Prueba. Cerró 1 facturas y el resto quedó a
 *   cuenta de la del 31/08. Le quedan ₲ 35.000.
 *
 * Los números están todos bien y la cartera quedó exacta. Lo que está mal es
 * el castellano, y no es un detalle: este párrafo es la prueba que la persona
 * tiene de que EOS entendió. Un producto que escribe "1 facturas" en el
 * mensaje donde confirma que movió plata se lee como un producto que no mira
 * lo que hace.
 *
 * Y de paso dice CUÁL cerró cuando es una sola, que es más útil que el número.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "iUMdg9fhAg54irmy";

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

async function traer(intentos = 6) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, { headers: CABECERAS });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === intentos) throw e;
      await new Promise((s) => setTimeout(s, 1500 * i));
    }
  }
  return null;
}

const VIEJO = `  } else if (docs.length > 1) {
    frases.push(
      cerrados > 0
        ? 'Cerró ' + cerrados + ' facturas' + (cerrados < docs.length
            ? ' y el resto quedó a cuenta de la del ' + diaMes(docs[docs.length - 1].fecha) + '.'
            : '.')
        : 'Repartido entre ' + docs.length + ' facturas.'
    );
  }`;

const NUEVO = `  } else if (docs.length > 1) {
    /*
      Cuando cierra UNA sola, se dice cuál en vez de decir "1".
      "Saldó la del 21/08" ubica a la persona; "Cerró 1 facturas" además de
      estar mal escrito no le dice nada que no supiera.
    */
    var cerradas = docs.filter(function (d) { return d.saldaba; });

    var parte = cerrados === 1
      ? 'Saldó la del ' + diaMes(cerradas[0].fecha)
      : 'Cerró ' + cerrados + ' facturas';

    if (cerrados === 0) {
      parte = 'Repartido entre ' + docs.length + ' facturas';
    }

    frases.push(
      cerrados > 0 && cerrados < docs.length
        ? parte + ' y el resto quedó a cuenta de la del ' + diaMes(docs[docs.length - 1].fecha) + '.'
        : parte + '.'
    );
  }`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
fs.writeFileSync(
  path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`),
  JSON.stringify(flujo, null, 2),
);

let tocados = 0;

for (const nodo of flujo.nodes) {
  const codigo = nodo.parameters?.jsCode;
  if (typeof codigo !== "string" || !codigo.includes(VIEJO)) continue;

  nodo.parameters.jsCode = codigo.replace(VIEJO, NUEVO);
  tocados += 1;
  console.log(`  ${nodo.name}: parcheado`);
}

if (tocados !== 1) throw new Error(`Esperaba 1 nodo y toqué ${tocados}. No se escribió nada.`);

console.log(`verificado: ${verificarFlujo(flujo, "worker")} nodos compilan`);

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
console.log("worker actualizado.");
