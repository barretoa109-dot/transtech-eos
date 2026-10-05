/**
 * QA con modelo, con tope de gasto: pocos casos críticos, sin ejecutar nada.
 *
 *     node --experimental-strip-types evals/qa/qa-con-tope.mts                 # nuevo prompt
 *     node --experimental-strip-types evals/qa/qa-con-tope.mts --antes         # sin las reglas de INC-19
 *     node --experimental-strip-types evals/qa/qa-con-tope.mts --id a,b --tope 0.5
 *
 * Reglas de la auditoría del 01/10/2026:
 * - modelo de QA `gpt-6-luna`, razonamiento `low`, salida acotada, sin
 *   historial salvo que el caso lo necesite, contexto mínimo;
 * - el modelo efectivo se lee en el pedido Y en la respuesta de la API;
 * - antes de cada llamada se estima el costo máximo y se frena si el total
 *   pasaría el tope (US$ 1 por defecto);
 * - si Luna falla un caso crítico, ese caso solo se repite con
 *   `--respaldo <modelo>` (gpt-6.1-sol), dentro del mismo tope;
 * - NO llama al Worker, NO toca la base: solo lee qué acciones pide el modelo.
 *
 * Usa la clave de `.env.local`, que es la misma de producción: el gasto se ve
 * en esa factura. Por eso el tope lo impone este script, llamada por llamada.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { prepararEntrada } from "../../lib/gateway/entrada.ts";
import { armarPrompt } from "../../lib/gateway/prompt.ts";
import { prepararRespuesta } from "../../lib/gateway/respuesta.ts";
import { PROMPT_SISTEMA } from "../../lib/gateway/sistema.ts";
import { CAMBIOS } from "../../n8n/parches/cambios-lo-que-la-persona-decidio.mjs";
import { CASOS_QA, type CasoQA } from "./casos.ts";
import { CASOS_NATURALES } from "./natural.ts";
import { CASOS_BUSQUEDA } from "./busqueda.ts";
import { CASOS_CITAS } from "./venta-citada.ts";
import { elegirModelo } from "../../lib/eos/enrutamiento-modelo.ts";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");

function leerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const linea of fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

const MODELO_QA = "gpt-6-luna";
const ESFUERZO_QA = "low";
const SALIDA_MAXIMA = 1200;
const TOPE = Number(argumento("tope") ?? "1");
const antes = process.argv.includes("--antes");
const respaldo = argumento("respaldo");
const ids = argumento("id")?.split(",") ?? null;
/** Con --ruteo, cada caso va al modelo que le elegiría producción (gpt-6-sol o gpt-5.5). */
const ruteo = process.argv.includes("--ruteo");
const conjunto = argumento("conjunto") ?? "asesoria";

/** USD por millón: entrada, entrada en caché, salida. Luna sale de la corrida del 30/09. */
const TARIFAS: Record<string, { entrada: number; cache: number; salida: number }> = {
  "gpt-6-luna": { entrada: 0.1, cache: 0.01, salida: 0.5 },
  "gpt-6-sol": { entrada: 2, cache: 0.2, salida: 10 },
  "gpt-6.1-sol": { entrada: 2, cache: 0.2, salida: 10 },
  "gpt-5.5": { entrada: 5, cache: 0.5, salida: 30 },
};
// Para estimar ANTES de llamar: el doble, por si la tarifa real es mayor.
const MARGEN = Number(argumento("margen") ?? "2");

const clave = process.env.OPENAI_API_KEY || leerEnv().OPENAI_API_KEY;
if (!clave) throw new Error("Falta OPENAI_API_KEY.");

/** El prompt sin las reglas de INC-19, para medir el antes. */
function promptAntes(): string {
  let p = PROMPT_SISTEMA;
  for (const c of CAMBIOS) p = p.split(c.nuevo).join(c.viejo);
  if (p === PROMPT_SISTEMA) throw new Error("--antes: el prompt no tenía las reglas nuevas");
  return p;
}
const PROMPT = antes ? promptAntes() : PROMPT_SISTEMA;

type Fila = {
  caso: CasoQA;
  modelo: string;
  modeloRespuesta: string;
  verbos: string[];
  texto: string;
  entrada: number;
  cache: number;
  salida: number;
  usd: number;
  ok: boolean;
  motivo: string;
};

let gastado = 0;

function costo(modelo: string, entrada: number, cache: number, salida: number): number {
  const t = TARIFAS[modelo];
  if (!t) throw new Error(`Sin tarifa para ${modelo}: no se llama sin poder acotar el gasto.`);
  return ((entrada - cache) * t.entrada + cache * t.cache + salida * t.salida) / 1e6;
}

async function llamar(caso: CasoQA, modelo: string): Promise<Fila> {
  const entrada = prepararEntrada({
    request_id: randomUUID(),
    usuario_id: randomUUID(),
    conversacion_id: randomUUID(),
    nombre: "Cliente QA",
    mensaje: caso.mensaje,
    plan: "personal",
    contexto_negocio: caso.contexto,
    origen: "whatsapp",
    historial: caso.historial ?? [],
  });
  const { contenido } = armarPrompt(entrada);

  // Cota superior: un token cada 3 caracteres, sin caché, salida completa.
  const caracteres = PROMPT.length + JSON.stringify(contenido).length;
  const estimado = costo(modelo, Math.ceil(caracteres / 3), 0, SALIDA_MAXIMA) * MARGEN;
  if (gastado + estimado > TOPE) {
    throw new Error(`TOPE: ${caso.id} costaría hasta US$ ${estimado.toFixed(5)} y ya van ${gastado.toFixed(5)} de ${TOPE}. Se frena.`);
  }

  const pedido = {
    model: modelo,
    reasoning: { effort: ESFUERZO_QA },
    max_output_tokens: SALIDA_MAXIMA,
    input: [
      { role: "system", content: [{ type: "input_text", text: PROMPT }] },
      { role: "user", content: contenido },
    ],
  };
  if (pedido.model !== modelo) throw new Error("el pedido no lleva el modelo de QA");

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
    body: JSON.stringify(pedido),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const ai = await r.json();

  const tokensEntrada = Number(ai?.usage?.input_tokens ?? 0);
  const tokensCache = Number(ai?.usage?.input_tokens_details?.cached_tokens ?? 0);
  const tokensSalida = Number(ai?.usage?.output_tokens ?? 0);
  const usd = costo(modelo, tokensEntrada, tokensCache, tokensSalida);
  gastado += usd;

  const cuerpo = prepararRespuesta(entrada, ai);
  const verbos = cuerpo.acciones.map((a) => String(a.tipo ?? "").toUpperCase()).filter(Boolean);
  const { ok, motivo } = caso.evaluar(verbos, cuerpo.respuesta, cuerpo.acciones);

  return {
    caso,
    modelo,
    modeloRespuesta: String(ai?.model ?? "?"),
    verbos,
    texto: cuerpo.respuesta + cuerpo.acciones.filter((a) => a.tipo === "BUSCAR_WEB").map((a) => `
[BUSCAR_WEB ${JSON.stringify(a.datos)}]`).join(""),
    entrada: tokensEntrada,
    cache: tokensCache,
    salida: tokensSalida,
    usd,
    ok,
    motivo,
  };
}

const TODOS =
  conjunto === "natural" ? CASOS_NATURALES : conjunto === "busqueda" ? CASOS_BUSQUEDA : conjunto === "citas" ? CASOS_CITAS : conjunto === "todos" ? [...CASOS_QA, ...CASOS_NATURALES, ...CASOS_BUSQUEDA, ...CASOS_CITAS] : CASOS_QA;
const casos = TODOS.filter((c) => !ids || ids.includes(c.id));

function modeloPara(caso: CasoQA): string {
  if (!ruteo) return MODELO_QA;
  return elegirModelo({ mensaje: caso.mensaje, adjuntos: 0, conCita: false, historial: caso.historial ?? [] }).modelo;
}
const filas: Fila[] = [];

for (const caso of casos) {
  try {
    let fila = await llamar(caso, modeloPara(caso));
    filas.push(fila);
    if (!fila.ok && caso.critico && respaldo) {
      fila = await llamar(caso, respaldo);
      filas.push(fila);
    }
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    if (String(error).includes("TOPE")) break;
  }
}

const linea = (f: Fila) =>
  `| ${f.caso.id} | \`${f.modelo}\` → \`${f.modeloRespuesta}\` | ${f.verbos.join(" + ") || "—"} | ${f.entrada} / ${f.cache} / ${f.salida} | ${f.usd.toFixed(5)} | ${f.ok ? "OK" : "FALLA: " + f.motivo} |`;

const informe = [
  `# QA con tope — ${conjunto}${ruteo ? " · ruteo de producción" : ""}${antes ? " · prompt ANTES de INC-19" : ""} (${new Date().toISOString().slice(0, 10)})`,
  "",
  `Modelo: ${ruteo ? "el de producción para cada caso (elegirModelo: gpt-6-sol o gpt-5.5)" : `\`${MODELO_QA}\``}, razonamiento \`${ESFUERZO_QA}\`, \`max_output_tokens\` ${SALIDA_MAXIMA}, tope US$ ${TOPE}. Sin ejecutar acciones ni tocar la base.`,
  "",
  "| Caso | Modelo pedido → respondido | Acciones | Tokens (entrada / caché / salida) | USD | Resultado |",
  "|---|---|---|---|---|---|",
  ...filas.map(linea),
  "",
  `**${filas.filter((f) => f.ok).length}/${filas.length} · ${filas.length} llamadas · US$ ${gastado.toFixed(5)}**`,
  "",
  "## Respuestas",
  "",
  ...filas.flatMap((f) => [`### ${f.caso.id} (\`${f.modelo}\`)`, "", "> " + f.texto.replace(/\n/g, "\n> "), ""]),
].join("\n");

const sello = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
const destino = path.join(
  RAIZ,
  "evals",
  "qa",
  "resultados",
  `${sello}-${conjunto}${ruteo ? "-ruteo" : ""}${antes ? "-antes" : ""}${ids ? "-parcial" : ""}.md`,
);
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, informe);
console.log(informe);
