/**
 * Fase 1.5 del diseño multiagente (docs/arquitectura-multiagente-2026-11-06.md,
 * sección "Próximo paso"): "confirmar con cuentas reales sin módulo ERP que el
 * núcleo sigue contestando igual de bien en finanzas personales". Esto SÍ
 * llama al modelo — a diferencia de `medir-modulo-erp-crm.mts`, que es gratis.
 *
 *     node --experimental-strip-types evals/bateria/medir-nucleo-personal.mts --tope 0.8
 *
 * Toma los casos de la batería que el propio clasificador de
 * `necesitaModuloErpCrm` nunca necesita (ninguna de las acciones exclusivas de
 * ERP/CRM entre lo esperado) — son los que la bandera `EOS_GATEWAY_NUCLEO_SIN_ERP`
 * mandaría con `PROMPT_NUCLEO` en vez del completo. Cada uno se pregunta DOS
 * veces, con el mismo modelo que elegiría producción (`elegirModelo`): una con
 * `PROMPT_SISTEMA` (lo de hoy) y otra con `PROMPT_NUCLEO` (lo que se prendería).
 *
 * El número que importa es REGRESIONES: un caso que el completo contesta bien
 * y el núcleo no. Cero regresiones es la barra para animarse a prender la
 * bandera en un ambiente de prueba — no se prende nada desde este script, solo
 * mide y deja un archivo en evals/bateria/resultados/.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { prepararEntrada } from "../../lib/gateway/entrada.ts";
import { armarPrompt } from "../../lib/gateway/prompt.ts";
import { SIN_INTERPRETAR, SIN_RESPUESTA, prepararRespuesta } from "../../lib/gateway/respuesta.ts";
import { ESFUERZO, MODELO, PROMPT_SISTEMA } from "../../lib/gateway/sistema.ts";
import { NOMBRES_ERP_CRM_EXCLUSIVOS, PROMPT_NUCLEO } from "../../lib/gateway/prompt-modulos.ts";
import { elegirModelo } from "../../lib/eos/enrutamiento-modelo.ts";
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

const clave = process.env.OPENAI_API_KEY || leerEnv().OPENAI_API_KEY;
if (!clave) {
  console.error("Falta OPENAI_API_KEY (en el entorno o en .env.local).");
  process.exit(1);
}

const argIndice = process.argv.indexOf("--tope");
const TOPE = Number(argIndice >= 0 ? process.argv[argIndice + 1] : "0.8");

// Las mismas tarifas que ya usa busqueda-real.mts: entrada, caché, salida por millón.
const TARIFAS: Record<string, [number, number, number]> = { "gpt-6-sol": [2, 0.2, 10], "gpt-5.5": [5, 0.5, 30] };
let gastado = 0;

function costo(modelo: string, ai: { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } }) {
  const [e, c, s] = TARIFAS[modelo] ?? TARIFAS["gpt-5.5"];
  const u = ai.usage ?? {};
  const cache = u.input_tokens_details?.cached_tokens ?? 0;
  return (((u.input_tokens ?? 0) - cache) * e + cache * c + (u.output_tokens ?? 0) * s) / 1e6;
}

function necesitaErpCrm(esperado: string[][]): boolean {
  return esperado.some((combinacion) => combinacion.some((verbo) => NOMBRES_ERP_CRM_EXCLUSIVOS.has(verbo)));
}

/** La misma comparación que `correr.mts::evaluar`, copiada acá para no importar ese
 * archivo: su módulo corre la batería completa como efecto de solo cargarlo. */
function clave_(verbos: string[]): string {
  return [...new Set(verbos)].sort().join("+");
}
function evaluar(frase: Frase, obtenido: string[], texto = ""): { ok: boolean; motivo: string } {
  const dicho = (frase.noDebeDecir ?? []).find((patron) => new RegExp(patron, "i").test(texto));
  if (dicho) return { ok: false, motivo: `dijo algo que no debía (/${dicho}/)` };

  const sinResponder = obtenido.filter((v) => v !== "RESPONDER");
  const prohibido = sinResponder.find((v) => frase.prohibido?.includes(v));
  if (prohibido) return { ok: false, motivo: `usó ${prohibido}, que está prohibido acá` };

  const obtenida = clave_(sinResponder);
  const ok = frase.esperado.some((combo) => clave_(combo) === obtenida);
  return { ok, motivo: ok ? "" : `esperaba ${frase.esperado.map((c) => clave_(c) || "(nada)").join(" o ")}` };
}

const personales = FRASES.filter((f) => !necesitaErpCrm(f.esperado));

type Resultado = { frase: Frase; ok: boolean; motivo: string; texto: string; usado: string; intentado: boolean };

async function preguntarCon(frase: Frase, promptSistema: string, modelo: string): Promise<{ verbos: string[]; texto: string }> {
  if (gastado + 0.08 > TOPE) throw new Error(`TOPE: van US$ ${gastado.toFixed(4)} de ${TOPE}`);

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

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
    body: JSON.stringify({
      model: modelo,
      reasoning: { effort: ESFUERZO },
      input: [
        { role: "system", content: [{ type: "input_text", text: promptSistema }] },
        { role: "user", content: contenido },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI respondió ${r.status}`);
  const ai = await r.json();
  gastado += costo(modelo, ai);

  const cuerpo = prepararRespuesta(entrada, ai);
  const verbos = cuerpo.acciones.map((a) => String(a.tipo ?? "").toUpperCase()).filter(Boolean);
  return { verbos: cuerpo.documento ? [...verbos, "DOCUMENTO"] : verbos, texto: cuerpo.respuesta };
}

/** El mismo modelo que elegiría producción, con la misma vuelta al completo si contesta ilegible. */
async function preguntar(frase: Frase, promptSistema: string): Promise<{ verbos: string[]; texto: string; usado: string }> {
  const eleccion = elegirModelo({
    mensaje: frase.mensaje,
    adjuntos: 0,
    conCita: frase.mensaje.startsWith("En respuesta a este mensaje"),
    historial: frase.historial ?? [],
  });
  const primera = await preguntarCon(frase, promptSistema, eleccion.modelo);
  if (eleccion.modelo !== MODELO && (primera.texto === SIN_INTERPRETAR || primera.texto === SIN_RESPUESTA)) {
    const segunda = await preguntarCon(frase, promptSistema, MODELO);
    return { ...segunda, usado: MODELO };
  }
  return { ...primera, usado: eleccion.modelo };
}

async function correrVariante(promptSistema: string): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  let siguiente = 0;
  const PARALELO = 4;

  async function trabajador() {
    while (siguiente < personales.length) {
      const frase = personales[siguiente++];
      try {
        const { verbos, texto, usado } = await preguntar(frase, promptSistema);
        const { ok, motivo } = evaluar(frase, verbos, texto);
        resultados.push({ frase, ok, motivo, texto, usado, intentado: true });
        process.stdout.write(ok ? "." : "x");
      } catch (error) {
        const detenido = error instanceof Error && error.message.startsWith("TOPE");
        resultados.push({
          frase,
          ok: false,
          motivo: detenido ? "tope alcanzado" : `error: ${error instanceof Error ? error.message : String(error)}`,
          texto: "",
          usado: "",
          intentado: !detenido, // un error real SÍ se intentó; el tope corta antes de intentar.
        });
        process.stdout.write(detenido ? "!" : "E");
        if (detenido) siguiente = personales.length; // no sigas gastando: cerrá esta variante.
      }
    }
  }

  await Promise.all(Array.from({ length: PARALELO }, trabajador));
  process.stdout.write("\n");
  // Sin forzar: si el tope cortó antes de llegar a una frase, no hay entrada
  // para ella y se completa con "no intentada" en vez de reventar el script.
  return personales.map(
    (f) => resultados.find((r) => r.frase === f) ?? { frase: f, ok: false, motivo: "no se intentó (tope)", texto: "", usado: "", intentado: false },
  );
}

console.log(`${personales.length} de ${FRASES.length} casos no necesitan ERP/CRM. Núcleo: ${PROMPT_NUCLEO.length} caracteres vs completo: ${PROMPT_SISTEMA.length}.`);
console.log("Completo (lo de hoy):");
const completo = await correrVariante(PROMPT_SISTEMA);
console.log("Núcleo (lo que prendería la bandera):");
const nucleo = await correrVariante(PROMPT_NUCLEO);

const intentadas = (rs: Resultado[]) => rs.filter((r) => r.intentado).length;
const porcentaje = (rs: Resultado[]) => {
  const n = intentadas(rs);
  return n ? Math.round((rs.filter((r) => r.ok).length / n) * 1000) / 10 : 0;
};

// Solo compara lo que se corrió de verdad en las dos variantes: un caso que el
// tope cortó en una de las dos no es ni regresión ni mejora, es "sin dato".
const comparables = personales.filter((f, i) => completo[i].intentado && nucleo[i].intentado);
const regresiones = comparables.filter((f) => {
  const i = personales.indexOf(f);
  return completo[i].ok && !nucleo[i].ok;
});
const mejoras = comparables.filter((f) => {
  const i = personales.indexOf(f);
  return !completo[i].ok && nucleo[i].ok;
});

const lineas: string[] = [
  `# Núcleo vs completo, solo casos personales — ${new Date().toISOString().slice(0, 10)}`,
  "",
  `Gastado: US$ ${gastado.toFixed(4)} de un tope de US$ ${TOPE}.`,
  "",
  `Completo: **${porcentaje(completo)} %** (${completo.filter((r) => r.ok).length}/${intentadas(completo)} intentadas de ${completo.length}).`,
  `Núcleo: **${porcentaje(nucleo)} %** (${nucleo.filter((r) => r.ok).length}/${intentadas(nucleo)} intentadas de ${nucleo.length}).`,
  `Comparables (las dos variantes se corrieron para ese caso): ${comparables.length} de ${personales.length}.`,
  "",
  `**Regresiones (el completo acertaba y el núcleo no): ${regresiones.length}** — tiene que ser 0 para animarse a prender la bandera.`,
  ...regresiones.map((f) => {
    const i = personales.indexOf(f);
    return `- \`${f.id}\` — "${f.mensaje}" → núcleo: ${nucleo[i].motivo}`;
  }),
  "",
  mejoras.length > 0 ? `Casos donde el núcleo acertó y el completo no: ${mejoras.length} (curioso, no es la barra que importa).` : "",
  "",
].filter((l, i, arr) => l !== "" || arr[i - 1] !== "");

const carpeta = path.join(RAIZ, "evals", "bateria", "resultados");
fs.mkdirSync(carpeta, { recursive: true });
const marca = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
const archivo = path.join(carpeta, `${marca}-nucleo-personal.md`);
fs.writeFileSync(archivo, lineas.join("\n"));

console.log("\n" + lineas.join("\n"));
console.log(`Guardado en ${path.relative(RAIZ, archivo)}`);
process.exit(regresiones.length === 0 ? 0 : 1);
