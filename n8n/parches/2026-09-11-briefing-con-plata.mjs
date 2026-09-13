/**
 * Que el briefing de la mañana sepa cuánta plata hay.
 *
 *     node n8n/parches/2026-09-11-briefing-con-plata.mjs
 *
 * La vista `eos_daily_briefing_context_v5` ya trae el campo `finanzas` desde
 * la v162. Faltan las dos puntas de este lado: que el nodo 02 lo deje pasar —
 * arma el contexto campo por campo y descarta lo que no nombra— y que el
 * prompt del nodo 03 sepa qué hacer con él.
 *
 * ============================================================
 * LAS REGLAS DE LA PLATA VAN EN EL PROMPT, NO EN LA VISTA
 * ============================================================
 *
 * El briefing lo escribe un modelo con "usá ÚNICAMENTE el contexto recibido",
 * que evita que invente hechos pero no que sume guaraníes con dólares ni que
 * presente un saldo declarado hace tres semanas como el de hoy.
 *
 * Son las dos formas de mentir con datos ciertos, y las dos se evitan con tres
 * renglones de instrucción.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "bFY6PPhJyTPJ4X2P";

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

// ------------------------------------------------------------------- nodo 02
const PREP_VIEJO = `  metricas: source.metricas && typeof source.metricas === 'object' ? source.metricas : {},`;

const PREP_NUEVO = `  metricas: source.metricas && typeof source.metricas === 'object' ? source.metricas : {},

  /*
    La plata, desde la v162.

    Hasta entonces el briefing de un producto de finanzas no sabía una sola
    cifra: traía objetivos, tareas, seguimientos y contadores, y ni un guaraní.
    Podía hablar de todo menos de si el mes cierra.

    Va entero y sin recortar: son cinco agregados, no una lista que pueda
    crecer.
  */
  finanzas: source.finanzas && typeof source.finanzas === 'object' ? source.finanzas : {},`;

// ------------------------------------------------------------------- nodo 03
const PROMPT_VIEJO = `- No menciones que sos una IA.`;

const PROMPT_NUEVO = `- No menciones que sos una IA.

Reglas sobre la plata, que no se negocian:
- NO SUMES MONEDAS DISTINTAS. Cada moneda va por separado, siempre. Un total que mezcla guaranies con dolares a una cotizacion inventada se ve preciso y esta mal.
- Los saldos de finanzas.tiene son DECLARADOS por la persona y traen su fecha en el campo al. Deci desde cuando: "tenes X segun lo que declaraste el <fecha>", nunca "tenes X". EOS no ve la cuenta de nadie.
- finanzas.mes.negocio y finanzas.mes.personal son plata DISTINTA y no se mezclan nunca. Si hablas de las dos, decilo por separado y con su rotulo.
- Si una cifra no esta en el contexto, no la calcules ni la estimes: deci que falta ese dato. Un numero inventado con cara de exacto es peor que un hueco.
- finanzas.debe trae las deudas con su cuota y el dia del mes; finanzas.tarjetas trae el dia de vencimiento. Eso es lo que hace util un briefing de la manana: lo que cae esta semana.`;

const flujo = await traer(ID);
if (!flujo) throw new Error("no pude leer el workflow del briefing");

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
fs.writeFileSync(
  path.join(RAIZ, "n8n", "respaldos", `${sello}-briefing.json`),
  JSON.stringify(flujo, null, 2),
);

function cambiar(texto, viejo, nuevo, donde) {
  const partes = texto.split(viejo);
  if (partes.length !== 2) {
    throw new Error(
      `[${donde}] el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`,
    );
  }
  return partes.join(nuevo);
}

const n02 = flujo.nodes.find((n) => n.name.startsWith("02 F5"));
const n03 = flujo.nodes.find((n) => n.name.startsWith("03 F5"));
if (!n02 || !n03) throw new Error("no encuentro los nodos 02 y 03");

if (n02.parameters.jsCode.includes("finanzas:")) {
  throw new Error("el nodo 02 ya pasa finanzas. No se escribió nada.");
}

n02.parameters.jsCode = cambiar(n02.parameters.jsCode, PREP_VIEJO, PREP_NUEVO, "02/contexto");

const mensaje = n03.parameters.responses.values[0];
mensaje.content = cambiar(mensaje.content, PROMPT_VIEJO, PROMPT_NUEVO, "03/prompt");

console.log(`verificado: ${verificarFlujo(flujo, "briefing")} nodos compilan`);

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
console.log("briefing actualizado: el nodo 02 pasa la plata y el 03 sabe qué hacer con ella.");
