/**
 * Corre la MISMA batería de frases que `correr.mts`, pero contra la API de
 * Claude en vez de OpenAI — para decidir, con datos propios y no con una
 * opinión, si conviene migrar (pregunta del dueño, 02/11/2026).
 *
 *     npm run bateria:claude                          # claude-sonnet-5-5
 *     npm run bateria:claude -- --modelo claude-opus-5-5
 *     npm run bateria:claude -- --grupo correccion
 *
 * Arma el pedido con las MISMAS `prepararEntrada` / `armarPrompt` /
 * `PROMPT_SISTEMA` del gateway (igual que `correr.mts`), para que la
 * comparación sea sobre el mismo prompt y no sobre uno reescrito a mano.
 * Evalúa con la misma regla de verbos (`evaluar`, duplicada acá a propósito:
 * `correr.mts` ejecuta la batería completa apenas se lo importa, así que no
 * se puede importar sin disparar una corrida de OpenAI).
 *
 * Necesita `ANTHROPIC_API_KEY` en `.env.local`. No ejecuta ninguna acción ni
 * toca el worker ni la base — solo lee qué pidió el modelo, igual que la
 * batería de OpenAI.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { prepararEntrada } from "../../lib/gateway/entrada.ts";
import { armarPrompt, type ParteOpenAI } from "../../lib/gateway/prompt.ts";
import { prepararRespuesta } from "../../lib/gateway/respuesta.ts";
import { PROMPT_SISTEMA } from "../../lib/gateway/sistema.ts";
import { FRASES, contextoDe, type Frase } from "./frases.ts";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");

function leerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const archivo = path.join(RAIZ, ".env.local");
  if (!fs.existsSync(archivo)) return env;
  for (const linea of fs.readFileSync(archivo, "utf8").split(/\r?\n/)) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const clave = process.env.ANTHROPIC_API_KEY || leerEnv().ANTHROPIC_API_KEY;
if (!clave) {
  console.error("Falta ANTHROPIC_API_KEY (en el entorno o en .env.local).");
  process.exit(1);
}

const modelo = argumento("modelo") ?? "claude-sonnet-5-5";
const grupo = argumento("grupo");
const rubro = argumento("rubro");
const ids = argumento("id")?.split(",") ?? null;
const frases = FRASES.filter(
  (f) => (!grupo || f.grupo === grupo) && (!rubro || (f.rubro ?? "almacen") === rubro) && (!ids || ids.includes(f.id)),
);
const PARALELO = 4;
const MAX_TOKENS_SALIDA = 4096;

type Resultado = {
  frase: Frase;
  obtenido: string[];
  ok: boolean;
  motivo: string;
  texto: string;
  ms: number;
};

function clave_(verbos: string[]): string {
  return [...new Set(verbos)].sort().join("+");
}

// Misma regla que `correr.mts` (ver el comentario de arriba del porqué está duplicada).
function evaluar(frase: Frase, obtenido: string[], texto = ""): { ok: boolean; motivo: string } {
  const dicho = (frase.noDebeDecir ?? []).find((patron) => new RegExp(patron, "i").test(texto));
  if (dicho) return { ok: false, motivo: `dijo algo que no debía (/${dicho}/): pidió un dato que estaba a la vista` };

  const sinResponder = obtenido.filter((v) => v !== "RESPONDER");
  const prohibido = sinResponder.find((v) => frase.prohibido?.includes(v));
  if (prohibido) return { ok: false, motivo: `usó ${prohibido}, que está prohibido acá` };

  const obtenida = clave_(sinResponder);
  const ok = frase.esperado.some((combo) => clave_(combo) === obtenida);
  return { ok, motivo: ok ? "" : `esperaba ${frase.esperado.map((c) => clave_(c) || "(nada)").join(" o ")}` };
}

/** `ParteOpenAI[]` (input_text/input_image) al formato de bloques de Anthropic. */
function aBloquesAnthropic(contenido: ParteOpenAI[]): Record<string, unknown>[] {
  return contenido.map((parte) => {
    if (parte.type === "input_text") return { type: "text", text: parte.text };
    // data:image/png;base64,AAAA... → { type: "base64", media_type, data }
    const m = /^data:([^;]+);base64,(.+)$/.exec(parte.image_url);
    if (!m) return { type: "text", text: "[imagen omitida: no vino en base64]" };
    return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  });
}

async function preguntar(frase: Frase): Promise<{ verbos: string[]; texto: string; ms: number }> {
  const entrada = prepararEntrada({
    request_id: randomUUID(),
    usuario_id: randomUUID(),
    conversacion_id: randomUUID(),
    nombre: "Carmen",
    mensaje: frase.mensaje,
    plan: "business",
    contexto_negocio: contextoDe(frase),
    origen: "whatsapp",
    historial: frase.historial ?? [],
  });
  const { contenido } = armarPrompt(entrada);

  const comienzo = Date.now();
  const respuesta = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": clave,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: MAX_TOKENS_SALIDA,
      // Caché de prompt: el sistema pesa ~15k tokens y es igual en las 215
      // frases. Sin esto, cada pedido lo paga entero — con USD 5 de crédito
      // no alcanza. `ephemeral` dura 5 minutos, de sobra con PARALELO=4.
      system: [{ type: "text", text: PROMPT_SISTEMA, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: aBloquesAnthropic(contenido) }],
    }),
  });

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text();
    throw new Error(`Anthropic respondió ${respuesta.status}: ${cuerpo.slice(0, 300)}`);
  }
  const ai = await respuesta.json();
  const ms = Date.now() - comienzo;
  if (process.env.EOS_BATERIA_DEBUG_USO) console.error(`[uso] ${frase.id}:`, JSON.stringify(ai.usage));

  const texto = (Array.isArray(ai.content) ? ai.content : [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n");

  // `prepararRespuesta` solo necesita `.text` (ver `extraerTexto`) y
  // `.usage.input_tokens` / `.usage.output_tokens`: el mismo parser que usa
  // la respuesta de OpenAI, sin tocar nada de producción.
  const cuerpo = prepararRespuesta(entrada, {
    text: texto,
    usage: { input_tokens: ai.usage?.input_tokens ?? 0, output_tokens: ai.usage?.output_tokens ?? 0 },
  });
  const verbos = cuerpo.acciones.map((a) => String(a.tipo ?? "").toUpperCase()).filter(Boolean);
  return { verbos: cuerpo.documento ? [...verbos, "DOCUMENTO"] : verbos, texto: cuerpo.respuesta, ms };
}

async function correr(): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  let siguiente = 0;

  async function trabajador() {
    while (siguiente < frases.length) {
      const frase = frases[siguiente++];
      try {
        const { verbos: obtenido, texto, ms } = await preguntar(frase);
        const { ok, motivo } = evaluar(frase, obtenido, texto);
        resultados.push({ frase, obtenido, ok, motivo, texto, ms });
        process.stdout.write(ok ? "." : "x");
      } catch (error) {
        resultados.push({
          frase,
          obtenido: [],
          ok: false,
          motivo: `error: ${error instanceof Error ? error.message : String(error)}`,
          texto: "",
          ms: 0,
        });
        process.stdout.write("E");
      }
    }
  }

  await Promise.all(Array.from({ length: PARALELO }, trabajador));
  process.stdout.write("\n");
  return frases.map((f) => resultados.find((r) => r.frase === f)!);
}

const porcentaje = (rs: Resultado[]) => (rs.length ? Math.round((rs.filter((r) => r.ok).length / rs.length) * 1000) / 10 : 0);

function tiempos(rs: Resultado[]): string[] {
  const medidos = rs.filter((r) => r.ms > 0);
  if (medidos.length === 0) return [];
  const ms = medidos.map((r) => r.ms).sort((a, b) => a - b);
  const p = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))];
  const s = (n: number) => (n / 1000).toFixed(1).replace(".", ",");
  return ["## Tiempo del modelo", "", `Mediana ${s(p(ms, 0.5))} s · p90 ${s(p(ms, 0.9))} s · máximo ${s(ms[ms.length - 1])} s.`, ""];
}

const resultados = await correr();
const fecha = new Date().toISOString().slice(0, 10);
const marca = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
const grupos = [...new Set(resultados.map((r) => r.frase.grupo))];

const lineas: string[] = [
  `# Batería de frases (Claude) — ${fecha}`,
  "",
  `Modelo: \`${modelo}\` · ${resultados.length} frases · **${porcentaje(resultados)} % de verbo correcto** (meta: ≥ 95 %, misma meta que la batería de OpenAI).`,
  "",
  "| Grupo | Acierto |",
  "|---|---|",
  ...grupos.map((g) => {
    const rs = resultados.filter((r) => r.frase.grupo === g);
    return `| ${g} | ${rs.filter((r) => r.ok).length}/${rs.length} (${porcentaje(rs)} %) |`;
  }),
  "",
  ...tiempos(resultados),
  "## Las que fallaron",
  "",
  ...(resultados.some((r) => !r.ok)
    ? resultados
        .filter((r) => !r.ok)
        .map((r) => `- \`${r.frase.id}\` — "${r.frase.mensaje}" → ${clave_(r.obtenido) || "(nada)"}; ${r.motivo}. _${r.frase.porque}_ Respondió: «${r.texto.replace(/\s*\n+\s*/g, " ⏎ ")}»`)
    : ["Ninguna."]),
  "",
];

const carpeta = path.join(RAIZ, "evals", "bateria", "resultados");
fs.mkdirSync(carpeta, { recursive: true });
const archivo = path.join(carpeta, `${marca}${grupo ? `-${grupo}` : ""}-claude-${modelo.replace(/[^a-z0-9.-]/gi, "_")}.md`);
fs.writeFileSync(archivo, lineas.join("\n"));

console.log(lineas.join("\n"));
console.log(`Guardado en ${path.relative(RAIZ, archivo)}`);
process.exit(porcentaje(resultados) >= 95 ? 0 : 1);
