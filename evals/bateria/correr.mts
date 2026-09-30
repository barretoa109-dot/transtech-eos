/**
 * Corre la batería de frases contra el modelo, SIN ejecutar ninguna acción.
 *
 *     npm run bateria                       # el modelo de producción
 *     npm run bateria -- --modelo gpt-5-mini  # para decidir el enrutamiento (plan maestro, fila 23)
 *     npm run bateria -- --grupo correccion   # solo un grupo
 *     npm run bateria -- --id ropa-cobro,agro-anular  # frases sueltas
 *     npm run bateria -- --rubro ferreteria   # solo un rubro (almacen, ropa, ferreteria, agro, comida, servicios)
 *     npm run bateria -- --esfuerzo low       # razonamiento: none, low, medium o high
 *
 * Arma el pedido con las MISMAS funciones del gateway en TypeScript
 * (`prepararEntrada`, `armarPrompt`, `PROMPT_SISTEMA`, `prepararRespuesta`):
 * una prueba que no reproduce el pedido real da respuestas con cara de
 * resultado. Solo lee qué acciones pidió el modelo; no llama al Worker ni
 * toca la base. Necesita `OPENAI_API_KEY` en `.env.local` y cuesta alrededor
 * de un dólar por corrida completa.
 *
 * Deja el resultado en `evals/bateria/resultados/AAAA-MM-DD[-modelo].md`, para
 * que la Bitácora del plan cite un archivo y no una impresión.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { prepararEntrada } from "../../lib/gateway/entrada.ts";
import { armarPrompt } from "../../lib/gateway/prompt.ts";
import { prepararRespuesta } from "../../lib/gateway/respuesta.ts";
import { ESFUERZO, MODELO, PROMPT_SISTEMA } from "../../lib/gateway/sistema.ts";
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

const clave = process.env.OPENAI_API_KEY || leerEnv().OPENAI_API_KEY;
if (!clave) {
  console.error("Falta OPENAI_API_KEY (en el entorno o en .env.local).");
  process.exit(1);
}

const modelo = argumento("modelo") ?? MODELO;
const grupo = argumento("grupo");
/*
 * El esfuerzo de razonamiento. Sin la bandera se usa el mismo que el gateway
 * (`ESFUERZO` de lib/gateway/sistema.ts), para que la batería mida lo que
 * corre en producción.
 */
const esfuerzo = argumento("esfuerzo") ?? ESFUERZO;
const rubro = argumento("rubro");
const ids = argumento("id")?.split(",") ?? null;
const frases = FRASES.filter(
  (f) => (!grupo || f.grupo === grupo) && (!rubro || (f.rubro ?? "almacen") === rubro) && (!ids || ids.includes(f.id)),
);
const PARALELO = 4;
const TOKENS = { entrada: 0, cacheada: 0, salida: 0 };

type Resultado = {
  frase: Frase;
  obtenido: string[];
  ok: boolean;
  motivo: string;
  texto: string;
  /** Lo que tardó OpenAI en contestar, medido desde acá. */
  ms: number;
  /** Tokens de razonamiento: se pagan y se esperan sin que se vean. */
  razonamiento: number;
};

function clave_(verbos: string[]): string {
  return [...new Set(verbos)].sort().join("+");
}

export function evaluar(frase: Frase, obtenido: string[]): { ok: boolean; motivo: string } {
  const sinResponder = obtenido.filter((v) => v !== "RESPONDER");
  const prohibido = sinResponder.find((v) => frase.prohibido?.includes(v));
  if (prohibido) return { ok: false, motivo: `usó ${prohibido}, que está prohibido acá` };

  const obtenida = clave_(sinResponder);
  const ok = frase.esperado.some((combo) => clave_(combo) === obtenida);
  return { ok, motivo: ok ? "" : `esperaba ${frase.esperado.map((c) => clave_(c) || "(nada)").join(" o ")}` };
}

async function preguntar(frase: Frase): Promise<{ verbos: string[]; texto: string; ms: number; razonamiento: number }> {
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
  const respuesta = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
    body: JSON.stringify({
      model: modelo,
      reasoning: { effort: esfuerzo },
      input: [
        { role: "system", content: [{ type: "input_text", text: PROMPT_SISTEMA }] },
        { role: "user", content: contenido },
      ],
    }),
  });

  if (!respuesta.ok) throw new Error(`OpenAI respondió ${respuesta.status}`);
  const ai = await respuesta.json();
  const ms = Date.now() - comienzo;
  const razonamiento = Number(ai?.usage?.output_tokens_details?.reasoning_tokens ?? 0);
  // Para comparar modelos por lo que cuesta de verdad, no por el precio de lista.
  const entradaTotal = Number(ai?.usage?.input_tokens ?? 0);
  const cacheada = Number(ai?.usage?.input_tokens_details?.cached_tokens ?? 0);
  TOKENS.entrada += entradaTotal - cacheada;
  TOKENS.cacheada += cacheada;
  TOKENS.salida += Number(ai?.usage?.output_tokens ?? 0);
  const cuerpo = prepararRespuesta(entrada, ai);
  const verbos = cuerpo.acciones.map((a) => String(a.tipo ?? "").toUpperCase()).filter(Boolean);
  // Los documentos a pedido no viajan como acción: el modelo los manda en el
  // campo `documento` y `procesar-mensaje.ts` genera el archivo en el formato
  // que pidió la persona. Para la batería cuentan como "DOCUMENTO".
  return { verbos: cuerpo.documento ? [...verbos, "DOCUMENTO"] : verbos, texto: cuerpo.respuesta, ms, razonamiento };
}

async function correr(): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  let siguiente = 0;

  async function trabajador() {
    while (siguiente < frases.length) {
      const frase = frases[siguiente++];
      try {
        const { verbos: obtenido, texto, ms, razonamiento } = await preguntar(frase);
        const { ok, motivo } = evaluar(frase, obtenido);
        resultados.push({ frase, obtenido, ok, motivo, texto, ms, razonamiento });
        process.stdout.write(ok ? "." : "x");
      } catch (error) {
        resultados.push({
          frase,
          obtenido: [],
          ok: false,
          motivo: `error: ${error instanceof Error ? error.message : String(error)}`,
          texto: "",
          ms: 0,
          razonamiento: 0,
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

/*
 * D2: cuánto mide la confirmación que escribe el modelo cuando registra algo.
 * La meta es una o dos líneas con el dato que importa. Se mide el texto del
 * MODELO; la frase que agrega el Worker ("La venta quedó registrada...") va
 * aparte y se suma después.
 */
const GRUPOS_QUE_REGISTRAN = new Set(["venta", "compra", "producto", "cobro", "correccion"]);
const LINEAS_MAXIMAS = 2;

function lineasDe(texto: string): number {
  return texto
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean).length;
}

function largoDeConfirmaciones(rs: Resultado[]): string[] {
  const conAccion = rs.filter((r) => GRUPOS_QUE_REGISTRAN.has(r.frase.grupo) && r.ok && r.obtenido.length > 0);
  if (conAccion.length === 0) return [];
  const chars = conAccion.map((r) => r.texto.length).sort((a, b) => a - b);
  const mediana = chars[Math.floor(chars.length / 2)];
  const largas = conAccion.filter((r) => lineasDe(r.texto) > LINEAS_MAXIMAS);
  return [
    "## Largo de las confirmaciones (D2)",
    "",
    `${conAccion.length} confirmaciones · mediana ${mediana} caracteres · máximo ${chars[chars.length - 1]} · **${largas.length} con más de ${LINEAS_MAXIMAS} líneas** (meta: 0).`,
    "",
    ...conAccion.map(
      (r) => `- \`${r.frase.id}\` (${r.texto.length} car., ${lineasDe(r.texto)} lín.): ${r.texto.replace(/\s*\n+\s*/g, " ⏎ ")}`,
    ),
    "",
  ];
}

/*
 * Encargado-02 del tablero: la mediana de respuesta tiene que bajar de 8 s, y
 * el modelo es la parte más grande. Se mide con las mismas frases que miden el
 * acierto, para que un cambio de esfuerzo se juzgue por las dos cosas a la
 * vez. Van 4 pedidos en paralelo: sirve para comparar corridas entre sí, no
 * como la latencia exacta de producción.
 */
function tiempos(rs: Resultado[]): string[] {
  const medidos = rs.filter((r) => r.ms > 0);
  if (medidos.length === 0) return [];
  const ms = medidos.map((r) => r.ms).sort((a, b) => a - b);
  const rz = medidos.map((r) => r.razonamiento).sort((a, b) => a - b);
  const p = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))];
  const s = (n: number) => (n / 1000).toFixed(1).replace(".", ",");
  return [
    "## Tiempo del modelo",
    "",
    `Mediana ${s(p(ms, 0.5))} s · p90 ${s(p(ms, 0.9))} s · máximo ${s(ms[ms.length - 1])} s. Tokens de razonamiento: mediana ${p(rz, 0.5)}, p90 ${p(rz, 0.9)}.`,
    "",
  ];
}

const resultados = await correr();

/** Precios por millón de tokens (entrada, cacheada, salida), de developers.openai.com/api/docs/pricing el 30/09/2026. */
const PRECIOS: Record<string, [number, number, number]> = {
  "gpt-5.5": [5, 0.5, 30],
  "gpt-6-sol": [2, 0.2, 10],
  "gpt-6.1-sol": [2, 0.1, 10],
  "gpt-6-luna": [0.1, 0.01, 0.5],
  "gpt-5.4-mini": [0.75, 0.075, 4.5],
};

function costo(): string[] {
  const p = PRECIOS[modelo];
  const tokens = `${TOKENS.entrada} de entrada sin caché, ${TOKENS.cacheada} en caché, ${TOKENS.salida} de salida`;
  if (!p) return ["## Costo", "", `Tokens: ${tokens}. Sin precio cargado para \`${modelo}\`.`, ""];
  const usd = (TOKENS.entrada * p[0] + TOKENS.cacheada * p[1] + TOKENS.salida * p[2]) / 1e6;
  const porFrase = usd / Math.max(resultados.length, 1);
  return [
    "## Costo",
    "",
    `Tokens: ${tokens}. **USD ${usd.toFixed(4)} la corrida · USD ${porFrase.toFixed(5)} por mensaje.**`,
    "",
  ];
}
// Con la hora: dos corridas del mismo día no se pisan (el registro es evidencia).
const fecha = new Date().toISOString().slice(0, 10);
const marca = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
const grupos = [...new Set(resultados.map((r) => r.frase.grupo))];

const lineas: string[] = [
  `# Batería de frases — ${fecha}`,
  "",
  `Modelo: \`${modelo}\` · esfuerzo \`${esfuerzo}\` · ${resultados.length} frases · **${porcentaje(resultados)} % de verbo correcto** (meta: ≥ 95 %).`,
  "",
  "| Grupo | Acierto |",
  "|---|---|",
  ...grupos.map((g) => {
    const rs = resultados.filter((r) => r.frase.grupo === g);
    return `| ${g} | ${rs.filter((r) => r.ok).length}/${rs.length} (${porcentaje(rs)} %) |`;
  }),
  "",
  "| Rubro | Acierto |",
  "|---|---|",
  ...[...new Set(resultados.map((r) => r.frase.rubro ?? "almacen"))].map((rb) => {
    const rs = resultados.filter((r) => (r.frase.rubro ?? "almacen") === rb);
    return `| ${rb} | ${rs.filter((r) => r.ok).length}/${rs.length} (${porcentaje(rs)} %) |`;
  }),
  "",
  ...tiempos(resultados),
  ...costo(),
  ...largoDeConfirmaciones(resultados),
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
const sufijo =
  (modelo === MODELO ? "" : `-${modelo.replace(/[^a-z0-9.-]/gi, "_")}`) +
  (esfuerzo === ESFUERZO ? "" : `-esfuerzo-${esfuerzo.replace(/[^a-z]/gi, "")}`);
const archivo = path.join(carpeta, `${marca}${grupo ? `-${grupo}` : ""}${sufijo}.md`);
fs.writeFileSync(archivo, lineas.join("\n"));

console.log(lineas.join("\n"));
console.log(`Guardado en ${path.relative(RAIZ, archivo)}`);
process.exit(porcentaje(resultados) >= 95 ? 0 : 1);
