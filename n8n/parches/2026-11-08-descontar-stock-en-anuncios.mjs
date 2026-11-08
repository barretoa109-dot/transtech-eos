/**
 * El caso del lechón (08/11/2026): AJUSTAR_STOCK no tiene una frase de
 * confirmación fija, así que el modelo anuncia la pérdida con el verbo que le
 * salga ("Voy a descontar un lechón del stock por la pérdida de hoy."). Ese
 * verbo no estaba en la lista que reconoce `esAnuncio`, así que cuando el
 * efecto interno fallaba el anuncio sobrevivía al filtro y quedaba pegado al
 * lado del error — indistinguible de una acción que sí se hizo.
 *
 * Agrega resto/restar, descuento/descontar y ajusto/ajustar (presente,
 * pasado y "voy a") a `esAnuncio`, en el nodo `08 GW Agregar Resultados
 * Worker` del gateway. El texto ya está sincronizado a mano en
 * `lib/gateway/sin-anuncios.ts` y en el JSON exportado
 * (`n8n/workflows/eos-conversational-gateway-rc1.json`), committed en el
 * mismo PR que este parche, para que los tests de consistencia pasen antes de
 * tocar nada en vivo.
 *
 *     SECO=1 node n8n/parches/2026-11-08-descontar-stock-en-anuncios.mjs   (prueba: no escribe)
 *     node n8n/parches/2026-11-08-descontar-stock-en-anuncios.mjs          (escribe)
 *
 * Se corre desde main, después del merge. Después de aplicar:
 *
 *     node n8n/exportar.mjs gateway
 *
 * y confirmar que el diff contra lo ya committed da vacío.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const ID_GATEWAY = "JRgzUkoHBKgGpyPA";

const VIEJO =
  "sumo|sumé|vuelvo a|mando|mandé|envío|envié|dejo|dejé|voy a (registrar|anotar|cargar|guardar|actualizar|mandar|agendar|corregir|sumar|dejar)";
const NUEVO =
  "sumo|sumé|resto|resté|descuento|desconté|ajusto|ajusté|vuelvo a|mando|mandé|envío|envié|dejo|dejé|voy a (registrar|anotar|cargar|guardar|actualizar|mandar|agendar|corregir|sumar|restar|descontar|ajustar|dejar)";

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

async function subir(id, flujo) {
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
  if (!r.ok) throw new Error(`PUT falló: ${r.status} ${await r.text()}`);
}

function respaldar(flujo, sufijo) {
  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-${sufijo}.json`);
  fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);
}

function nodo(flujo, prefijo) {
  const n = flujo.nodes.find((x) => x.name === prefijo || x.name.startsWith(prefijo));
  if (!n) throw new Error(`No existe el nodo "${prefijo}".`);
  return n;
}

const gateway = await traer(ID_GATEWAY);
respaldar(gateway, "gateway");

const n08 = nodo(gateway, "08 GW Agregar Resultados Worker");

if (n08.parameters.jsCode.includes(NUEVO)) {
  console.log("El gateway en vivo ya tiene el verbo 'descontar' en esAnuncio. No se tocó nada.");
} else {
  if (n08.parameters.jsCode.split(VIEJO).length !== 2) {
    throw new Error("No encuentro la lista de verbos de esAnuncio en el nodo 08 (¿ya cambió de otra forma?).");
  }

  n08.parameters.jsCode = n08.parameters.jsCode.replace(VIEJO, NUEVO);

  console.log(`gateway verificado: ${verificarFlujo(gateway, "gateway")} nodos compilan`);

  if (process.env.SECO !== "1") {
    await subir(ID_GATEWAY, gateway);
    console.log("gateway actualizado: 'descontar'/'ajustar'/'restar' en esAnuncio del nodo 08.");
  } else {
    console.log("SECO=1: verificado pero no escrito.");
  }
}
