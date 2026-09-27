/**
 * Corre la batería de frases contra el modelo, SIN ejecutar ninguna acción.
 *
 *     npm run bateria                       # el modelo de producción
 *     npm run bateria -- --modelo gpt-5-mini  # para decidir el enrutamiento (plan maestro, fila 23)
 *     npm run bateria -- --grupo correccion   # solo un grupo
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
import { MODELO, PROMPT_SISTEMA } from "../../lib/gateway/sistema.ts";
import { CONTEXTO_NEGOCIO, FRASES, type Frase } from "./frases.ts";

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
const frases = grupo ? FRASES.filter((f) => f.grupo === grupo) : FRASES;
const PARALELO = 4;

type Resultado = { frase: Frase; obtenido: string[]; ok: boolean; motivo: string; texto: string };

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

async function preguntar(frase: Frase): Promise<{ verbos: string[]; texto: string }> {
  const entrada = prepararEntrada({
    request_id: randomUUID(),
    usuario_id: randomUUID(),
    conversacion_id: randomUUID(),
    nombre: "Carmen",
    mensaje: frase.mensaje,
    plan: "business",
    contexto_negocio: CONTEXTO_NEGOCIO,
    origen: "whatsapp",
    historial: frase.historial ?? [],
  });
  const { contenido } = armarPrompt(entrada);

  const respuesta = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
    body: JSON.stringify({
      model: modelo,
      input: [
        { role: "system", content: [{ type: "input_text", text: PROMPT_SISTEMA }] },
        { role: "user", content: contenido },
      ],
    }),
  });

  if (!respuesta.ok) throw new Error(`OpenAI respondió ${respuesta.status}`);
  const cuerpo = prepararRespuesta(entrada, await respuesta.json());
  const verbos = cuerpo.acciones.map((a) => String(a.tipo ?? "").toUpperCase()).filter(Boolean);
  // Los documentos a pedido no viajan como acción: el modelo los manda en el
  // campo `documento` y `procesar-mensaje.ts` genera el archivo en el formato
  // que pidió la persona. Para la batería cuentan como "DOCUMENTO".
  return { verbos: cuerpo.documento ? [...verbos, "DOCUMENTO"] : verbos, texto: cuerpo.respuesta };
}

async function correr(): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  let siguiente = 0;

  async function trabajador() {
    while (siguiente < frases.length) {
      const frase = frases[siguiente++];
      try {
        const { verbos: obtenido, texto } = await preguntar(frase);
        const { ok, motivo } = evaluar(frase, obtenido);
        resultados.push({ frase, obtenido, ok, motivo, texto });
        process.stdout.write(ok ? "." : "x");
      } catch (error) {
        resultados.push({
          frase,
          obtenido: [],
          ok: false,
          motivo: `error: ${error instanceof Error ? error.message : String(error)}`,
          texto: "",
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

const resultados = await correr();
// Con la hora: dos corridas del mismo día no se pisan (el registro es evidencia).
const fecha = new Date().toISOString().slice(0, 10);
const marca = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
const grupos = [...new Set(resultados.map((r) => r.frase.grupo))];

const lineas: string[] = [
  `# Batería de frases — ${fecha}`,
  "",
  `Modelo: \`${modelo}\` · ${resultados.length} frases · **${porcentaje(resultados)} % de verbo correcto** (meta: ≥ 95 %).`,
  "",
  "| Grupo | Acierto |",
  "|---|---|",
  ...grupos.map((g) => {
    const rs = resultados.filter((r) => r.frase.grupo === g);
    return `| ${g} | ${rs.filter((r) => r.ok).length}/${rs.length} (${porcentaje(rs)} %) |`;
  }),
  "",
  ...largoDeConfirmaciones(resultados),
  "## Las que fallaron",
  "",
  ...(resultados.some((r) => !r.ok)
    ? resultados
        .filter((r) => !r.ok)
        .map((r) => `- \`${r.frase.id}\` — "${r.frase.mensaje}" → ${clave_(r.obtenido) || "(nada)"}; ${r.motivo}. _${r.frase.porque}_`)
    : ["Ninguna."]),
  "",
];

const carpeta = path.join(RAIZ, "evals", "bateria", "resultados");
fs.mkdirSync(carpeta, { recursive: true });
const sufijo = modelo === MODELO ? "" : `-${modelo.replace(/[^a-z0-9.-]/gi, "_")}`;
const archivo = path.join(carpeta, `${marca}${grupo ? `-${grupo}` : ""}${sufijo}.md`);
fs.writeFileSync(archivo, lineas.join("\n"));

console.log(lineas.join("\n"));
console.log(`Guardado en ${path.relative(RAIZ, archivo)}`);
process.exit(porcentaje(resultados) >= 95 ? 0 : 1);
