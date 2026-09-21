/**
 * Que "decisión" sea una decisión y no cualquier operación.
 *
 *     node n8n/parches/2026-09-21-decisiones-de-verdad.mjs
 *
 * ============================================================
 * QUÉ SE ENCONTRÓ (20 de septiembre de 2026)
 * ============================================================
 *
 * Las 14 decisiones de cuentas reales las creó este workflow (`n8n-conversation-v6`)
 * y casi ninguna era una decisión: "Aprobación de compra registrada", "Agregar
 * productos con precios de venta", tres variantes de la misma compra. Ninguna con
 * métrica. Por eso la memoria de negocio no aprende de resultados: no hay
 * resultados que aprender de una operación con su propio registro.
 *
 * ============================================================
 * QUÉ SE PROBÓ ANTES DE TOCAR NADA
 * ============================================================
 *
 * Con la clave de OpenAI se corrieron el prompt de antes y el nuevo contra las 14
 * conversaciones reales y 10 casos escritos a mano, con el mismo modelo del
 * workflow (gpt-5.4-mini). Sobre los 20 casos de respuesta clara (7 decisiones
 * reales y 13 operaciones o aprobaciones):
 *
 *     prompt de antes:  12 aciertos · aceptaba 5/7 decisiones · rechazaba 7/13 operaciones
 *     prompt nuevo:     20 aciertos · aceptó 7/7 decisiones  · rechazó 13/13 operaciones
 *
 * ADVERTENCIA HONESTA: los 20 casos los etiquetó quien escribió el prompt nuevo
 * después de leerlos, y son pocos. Es una señal fuerte, no una garantía. Los 4 casos
 * discutibles (dos de fijación de precios, el inicio de un negocio, una compra
 * chica) se dejan afuera de la cuenta; el prompt nuevo rechazó dos de esos cuatro,
 * que es lo que pide "ante la duda, no es decisión".
 *
 * ============================================================
 * QUÉ CAMBIA
 * ============================================================
 *
 * - Nodo `02 F6 Extraer decision con OpenAI`: el prompt del sistema. Define qué SÍ es
 *   una decisión (elegir entre alternativas o comprometerse con un rumbo que se
 *   pueda revisar) y qué NO (operaciones con su propio registro, aprobar lo que EOS
 *   propuso, preguntas, ideas). Pide además una frase de `revision`: qué mirar y
 *   cuándo.
 * - Nodo `03 F6 Validar decision`: la versión del prompt pasa a `decision-capture-v7`
 *   y la frase de revisión se guarda en `metadata.revision`. La fecha de revisión
 *   sigue saliendo de la v179 (14 días).
 *
 * No borra nada de lo ya registrado. Es reversible: el respaldo previo queda en
 * `n8n/respaldos/`.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "xwFkncvx2T7DYAm8";

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

const PROMPT_NUEVO =
  "Analiza la conversacion de TransTech EOS y determina si el usuario tomo una DECISION de negocio o de plata que valga la pena revisar mas adelante.\n\n" +
  "ES una decision: elegir entre alternativas o comprometerse con un rumbo cuyo resultado se puede mirar despues. Por ejemplo: invertir plata y como, subir o bajar precios como politica, contratar, cambiar de proveedor, endeudarse, abrir o cerrar una linea de negocio, comprometer plata a futuro.\n\n" +
  "NO es una decision, aunque suene a que si:\n" +
  "- Cargar, registrar, corregir o cambiar datos que EOS guarda en su propio registro: una venta, una compra, un producto, el precio o el nombre de un producto, el stock, un contacto, un gasto. Eso es una operacion, tiene su registro y no se evalua.\n" +
  "- Aprobar o confirmar algo que EOS le propuso o va a ejecutar ('aprobado', 'si', 'dale', 'confirmo').\n" +
  "- Preguntas, ideas tentativas, recomendaciones de EOS o intenciones ambiguas.\n\n" +
  "Ante la duda, NO es decision: es preferible perder una decision dudosa que llenar la lista de operaciones.\n\n" +
  'Devuelve exclusivamente JSON valido sin markdown: {"es_decision":true|false,"titulo":"...","decision":"...","contexto":"...","razon":"...","resultado_esperado":"...","revision":"que mirar y cuando, en una frase","confianza":0.0}. Si no es decision, usa es_decision false y cadenas vacias. No inventes datos.';

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
fs.writeFileSync(path.join(RAIZ, "n8n", "respaldos", `${sello}-decisiones.json`), JSON.stringify(flujo, null, 2));

const extraer = flujo.nodes.find((n) => n.name === "02 F6 Extraer decision con OpenAI");
if (!extraer) throw new Error("no existe el nodo 02");

const mensaje = extraer.parameters?.responses?.values?.[0];
if (!mensaje || typeof mensaje.content !== "string") throw new Error("el nodo 02 no tiene el formato esperado");
if (mensaje.content.includes("DECISION de negocio")) throw new Error("Ya tiene el prompt nuevo. No se escribió nada.");

const corte = mensaje.content.indexOf("\n\nUsuario:");
if (corte < 0) throw new Error("no encuentro dónde termina el prompt del sistema");
mensaje.content = "=" + PROMPT_NUEVO + mensaje.content.slice(corte);

const validar = flujo.nodes.find((n) => n.name === "03 F6 Validar decision");
if (!validar) throw new Error("no existe el nodo 03");

const codigo = validar.parameters.jsCode;
const ANCLA_META = "metadata: { prompt_version: 'decision-capture-v6', execution_id: String($execution.id || '') }";
if (!codigo.includes(ANCLA_META)) throw new Error("no encuentro el metadata del nodo 03");
validar.parameters.jsCode = codigo.replace(
  ANCLA_META,
  "metadata: { prompt_version: 'decision-capture-v7', revision: text(parsed.revision, 400) || null, execution_id: String($execution.id || '') }",
);

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

const despues = await traer();
console.log(`decisiones actualizado. Activo: ${despues?.active}. Reexportar con: node n8n/exportar.mjs decisiones`);
