/**
 * Aceptación de la búsqueda web, con la cadena COMPLETA y búsqueda real.
 *
 *     node --experimental-strip-types evals/qa/busqueda-real.mts --tope 0.4
 *
 * mensaje → el modelo de producción decide (BUSCAR_WEB y su consulta) →
 * la consulta se limpia → búsqueda REAL (web_search) → el mismo modelo
 * sintetiza con la conversación y el contexto → el servidor controla citas
 * y enlaces → pregunta de seguimiento sin repetir nada.
 *
 * Usa el código de producción (prepararEntrada, armarPrompt, elegirModelo,
 * resolverBusqueda, crearBuscador, investigar). La base es una en memoria: no
 * escribe nada en Supabase. Contexto de negocio sintético, de ningún cliente.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { prepararEntrada } from "../../lib/gateway/entrada.ts";
import { armarPrompt, type ParteOpenAI } from "../../lib/gateway/prompt.ts";
import { prepararRespuesta } from "../../lib/gateway/respuesta.ts";
import { ESFUERZO, PROMPT_SISTEMA } from "../../lib/gateway/sistema.ts";
import { elegirModelo } from "../../lib/eos/enrutamiento-modelo.ts";
import { resolverBusqueda } from "../../lib/gateway/con-busqueda.ts";
import { crearBuscador } from "../../lib/busqueda/servicio.ts";
import { CONTEXTOS_RUBRO } from "../bateria/rubros.ts";
import type { Turno } from "../bateria/frases.ts";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(RAIZ, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const clave = env.OPENAI_API_KEY as string;
const i = process.argv.indexOf("--tope");
const TOPE = Number(i >= 0 ? process.argv[i + 1] : "0.4");
const HOY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());

const TARIFAS: Record<string, [number, number, number]> = { "gpt-6-sol": [2, 0.2, 10], "gpt-5.5": [5, 0.5, 30] };
let gastado = 0;
const registro: string[] = [];

function costo(modelo: string, ai: { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } }) {
  const [e, c, s] = TARIFAS[modelo] ?? TARIFAS["gpt-5.5"];
  const u = ai.usage ?? {};
  const cache = u.input_tokens_details?.cached_tokens ?? 0;
  return (((u.input_tokens ?? 0) - cache) * e + cache * c + (u.output_tokens ?? 0) * s) / 1e6;
}

async function llamar(modelo: string, contenido: ParteOpenAI[]) {
  if (gastado + 0.08 > TOPE) throw new Error(`TOPE: van US$ ${gastado.toFixed(4)} de ${TOPE}`);
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
    body: JSON.stringify({
      model: modelo,
      reasoning: { effort: ESFUERZO },
      input: [
        { role: "system", content: [{ type: "input_text", text: PROMPT_SISTEMA }] },
        { role: "user", content: contenido },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  const ai = await r.json();
  const usd = costo(modelo, ai);
  gastado += usd;
  registro.push(`| ${modelo} → ${ai.model} | ${ai.usage?.input_tokens} / ${ai.usage?.input_tokens_details?.cached_tokens ?? 0} / ${ai.usage?.output_tokens} | ${usd.toFixed(5)} |`);
  return ai;
}

/** La base en memoria: la caché y las métricas viven acá y no en Supabase. */
function baseEnMemoria() {
  const cache = new Map<string, unknown>();
  return {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      const q = {
        insert: async () => ({ error: null }),
        upsert: async (f: { clave: string }) => (cache.set(f.clave, f), { error: null }),
        select: () => q,
        eq: (c: string, v: unknown) => ((filtros[c] = v), q),
        neq: () => q,
        gt: () => q,
        gte: () => q,
        lt: () => q,
        delete: () => q,
        maybeSingle: async () => ({ data: tabla.includes("cache") ? (cache.get(String(filtros.clave)) ?? null) : null }),
        then: (ok: (v: unknown) => unknown) => ok({ count: 0 }),
      };
      return q;
    },
  };
}

async function turno(contexto: string, historial: Turno[], mensaje: string) {
  const entrada = prepararEntrada({
    request_id: randomUUID(),
    usuario_id: randomUUID(),
    conversacion_id: randomUUID(),
    nombre: "Cliente QA",
    mensaje,
    plan: "business",
    contexto_negocio: contexto,
    origen: "eos-web",
    historial,
  });
  const { contenido } = armarPrompt(entrada);
  const modelo = elegirModelo({ mensaje, adjuntos: 0, conCita: false, historial }).modelo;
  const cuerpo = prepararRespuesta(entrada, await llamar(modelo, contenido));
  const pedido = cuerpo.acciones.find((a) => a.tipo === "BUSCAR_WEB");
  const tareas: Promise<unknown>[] = [];

  await resolverBusqueda(cuerpo, contenido, {
    buscar: crearBuscador({
      admin: baseEnMemoria(),
      usuarioId: "qa",
      contexto,
      nombre: "Cliente QA",
      clave,
      hoy: HOY,
      env: {},
      registrar: (t) => tareas.push(t),
    }),
    sintetizar: async (extendido) => prepararRespuesta(entrada, await llamar(modelo, extendido)),
  });
  await Promise.all(tareas);
  const b = cuerpo.metadata.busqueda as Record<string, unknown> | undefined;
  if (b?.costo_usd) gastado += Number(b.costo_usd);
  return { modelo, pedido, cuerpo, busqueda: b };
}

const FERRETERIA = CONTEXTOS_RUBRO.ferreteria;
const salida: string[] = [`# Búsqueda web — aceptación con búsqueda real (${HOY})`, ""];

function anotar(titulo: string, mensaje: string, r: Awaited<ReturnType<typeof turno>>) {
  salida.push(
    `## ${titulo}`,
    "",
    `**Mensaje:** ${mensaje}`,
    "",
    `**Modelo:** \`${r.modelo}\` · **BUSCAR_WEB:** ${r.pedido ? "`" + JSON.stringify(r.pedido.datos) + "`" : "no"} · **Acciones finales:** ${r.cuerpo.acciones.map((a) => a.tipo).join(", ") || "ninguna"}`,
    "",
    `**Búsqueda:** ${r.busqueda ? "`" + JSON.stringify(r.busqueda) + "`" : "—"}`,
    "",
    "**Respuesta:**",
    "",
    "> " + r.cuerpo.respuesta.replace(/\n/g, "\n> "),
    "",
  );
  console.log(`\n=== ${titulo}\n${r.cuerpo.respuesta}\n[${JSON.stringify(r.busqueda ?? {})}]`);
}

try {
  // 1. Mercado en Paraguay + lo que dice la persona contra la fuente + su contexto.
  const m1 =
    "un proveedor me dijo que la bolsa de cemento de 50 kg está a 40 mil en todos lados y que yo estoy caro, ¿es así?";
  const r1 = await turno(FERRETERIA, [], m1);
  anotar("1. Precio de mercado en Paraguay, con una afirmación que contrasta", m1, r1);

  // 2. Seguimiento: no repite, no vuelve a buscar, usa lo encontrado + su negocio.
  const historial: Turno[] = [
    { rol: "usuario", texto: m1 },
    { rol: "eos", texto: r1.cuerpo.respuesta },
  ];
  const m2 = "¿y qué me conviene hacer con mi precio?";
  const r2 = await turno(FERRETERIA, historial, m2);
  anotar("2. Seguimiento sin repetir nada", m2, r2);

  // 3. Algo que la web no tiene: dice que no hay evidencia, no inventa.
  const m3 = "buscá el precio oficial de la pintura Ñandutí Ultra 25 litros modelo QX-9917 en Paraguay";
  const r3 = await turno(FERRETERIA, [], m3);
  anotar("3. Sin evidencia suficiente", m3, r3);
} catch (e) {
  console.error(String(e));
  salida.push(`**Se frenó:** ${String(e)}`, "");
}

salida.push("## Llamadas al modelo de la conversación", "", "| Modelo | Tokens (entrada / caché / salida) | USD |", "|---|---|---|", ...registro, "", `**Total (conversación + búsquedas): US$ ${gastado.toFixed(5)}**`);
const destino = path.join(RAIZ, "evals", "qa", "resultados", `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13)}-busqueda-real.md`);
fs.writeFileSync(destino, salida.join("\n") + "\n");
console.log(`\nTotal US$ ${gastado.toFixed(5)} → ${path.relative(RAIZ, destino)}`);
