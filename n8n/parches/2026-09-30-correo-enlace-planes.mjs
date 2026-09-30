/**
 * Ante una consulta de precios, la respuesta de ventas@ da el enlace a los planes.
 *
 *     SECO=1 node n8n/parches/2026-09-30-correo-enlace-planes.mjs   (prueba)
 *     node n8n/parches/2026-09-30-correo-enlace-planes.mjs          (escribe)
 *
 * El 29/09/2026 la primera respuesta real a "Me gustaría conocer los precios de
 * EOS de forma detallada" pidió cuatro datos (rubro, usuarios, módulos,
 * implementación) y no dio ninguna referencia. La regla "no inventes precios"
 * está bien —los montos cambian y el modelo no los sabe—, pero la persona se
 * quedaba sin nada que mirar hasta la próxima respuesta. Ahora la respuesta
 * lleva el enlace a /planes, que siempre tiene los precios vigentes, y sigue
 * sin nombrar montos.
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
const ANCLA = "- No inventes precios, promociones, fechas, pagos aprobados, funciones, garantías ni compromisos.";
const REGLA =
  '\n- Si preguntan por precios, planes o cómo contratar, incluí el enlace a los planes vigentes: <a href="https://www.transtech.com.py/planes">transtech.com.py/planes</a>. No menciones montos: los precios están en esa página y pueden cambiar. Ofrecé además una demostración si la quieren.';

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

  const ia = flujo.nodes.find((n) => n.name === "Generar respuesta EOS1");
  const sistema = ia?.parameters?.responses?.values?.find((v) => v.role === "system");
  if (!sistema) throw new Error("No se encontró el mensaje de sistema del nodo de IA. No se tocó nada.");

  const texto = sistema.content.replace(/\r\n/g, "\n");
  if (texto.includes("transtech.com.py/planes")) {
    console.log("Las instrucciones ya dan el enlace a los planes. Nada que hacer.");
    return;
  }
  if (texto.split(ANCLA).length !== 2) throw new Error("La regla de precios cambió o se repite. No se tocó nada.");

  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-correo.json`);
  fs.mkdirSync(path.dirname(respaldo), { recursive: true });
  fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

  sistema.content = texto.replace(ANCLA, ANCLA + REGLA);
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
  console.log("correo actualizado: la respuesta de precios lleva el enlace a /planes.");
}

await aplicar();
