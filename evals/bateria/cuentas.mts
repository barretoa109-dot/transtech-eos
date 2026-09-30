/**
 * ¿Las cuentas salen bien? (complemento de la batería, 30/09/2026).
 *
 *     node --experimental-strip-types evals/bateria/cuentas.mts --esfuerzo low [--modelo gpt-6-sol]
 *
 * La batería mide qué verbo elige el modelo; esto mide si los NÚMEROS de la
 * respuesta son los correctos: tipo de cambio, margen, envío repartido, IVA,
 * quincenas. Sirve para decidir el esfuerzo de razonamiento sin arriesgar la
 * promesa de que EOS nunca miente. No ejecuta nada.
 *
 * Un caso pasa si la respuesta (o los datos de la acción) contiene el número
 * esperado escrito como lo escribe EOS (con punto de miles).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { prepararEntrada } from "../../lib/gateway/entrada.ts";
import { armarPrompt } from "../../lib/gateway/prompt.ts";
import { prepararRespuesta } from "../../lib/gateway/respuesta.ts";
import { ESFUERZO, MODELO, PROMPT_SISTEMA } from "../../lib/gateway/sistema.ts";
import { CONTEXTO_NEGOCIO } from "./frases.ts";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");

type Caso = { id: string; mensaje: string; esperado: number[]; porque: string };

const CASOS: Caso[] = [
  { id: "dolar-envio", mensaje: "compré 3 tops a USD 12 cada uno, el dólar a 7.300, y pagué 45 mil de envío por los tres. ¿Cuánto me cuesta cada top en guaraníes?", esperado: [102600], porque: "12 × 7.300 = 87.600 + 15.000 de envío." },
  { id: "margen", mensaje: "si la remera me cuesta 52 mil y la vendo a 85 mil, ¿cuánto gano por remera y qué margen es sobre el precio?", esperado: [33000, 39], porque: "85 − 52 = 33 mil; 33/85 = 38,8 %." },
  { id: "total-venta", mensaje: "¿cuánto es 7 bolsas de balanceado a 180 mil más 4 harinas a 60 mil?", esperado: [1500000], porque: "1.260.000 + 240.000." },
  { id: "iva-incluido", mensaje: "vendí por 1.100.000 con IVA 10 % incluido, ¿cuánto es el IVA?", esperado: [100000], porque: "1.100.000 / 11." },
  { id: "quincena-mensual", mensaje: "le pago al capataz 1.500.000 por quincena, ¿cuánto es por mes?", esperado: [3000000], porque: "2 quincenas." },
  { id: "precio-con-margen", mensaje: "me cuesta 140 mil y quiero ganar 30 % sobre el costo, ¿a cuánto lo vendo?", esperado: [182000], porque: "140 × 1,3." },
  { id: "descuento", mensaje: "si al balanceado de 180 mil le hago 10 % de descuento a Juan, ¿a cuánto le queda?", esperado: [162000], porque: "180 × 0,9." },
  { id: "deuda-cuotas", mensaje: "Juan me debe 900 mil y me va a pagar en 3 cuotas iguales, ¿de cuánto es cada una?", esperado: [300000], porque: "900 / 3." },
  { id: "dolar-varios", mensaje: "pedí 2 vestidos a USD 19,03 y 1 calza a USD 8,50, el dólar a 5.988,99. ¿Cuánto es todo en guaraníes, redondeado?", esperado: [278846], porque: "(38,06 + 8,50) × 5.988,99 = 278.845,4 → 278.846 (o 278.845 redondeando cada ítem)." },
  { id: "ganancia-mes", mensaje: "este mes vendí 12.400.000, la mercadería me costó 8.100.000 y los gastos fijos son 2.300.000. ¿Cuánto me quedó?", esperado: [2000000], porque: "12,4 − 8,1 − 2,3." },
  { id: "stock-dias", mensaje: "tengo 80 bolsas de cemento y vendo 12 por día, ¿para cuántos días me alcanza?", esperado: [6], porque: "80 / 12 = 6,67 → 6 días completos (o casi 7)." },
  { id: "envio-porcentual", mensaje: "compré mercadería por 2.400.000 y el flete fue 5 % del total, ¿cuánto pagué en total?", esperado: [2520000], porque: "2,4 M × 1,05." },
];

function leerClave(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const m = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8").match(/^OPENAI_API_KEY=(.*)$/m);
  if (!m) throw new Error("Falta OPENAI_API_KEY.");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/** Todos los números del texto, entendiendo "102.600", "102600", "38,8" y "3 millones". */
export function numerosDe(texto: string): number[] {
  const salida: number[] = [];
  const t = texto.replace(/\s*millones?/gi, "000000").replace(/(\d)\s+mil\b/gi, "$1000");
  for (const m of t.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g)) {
    const limpio = m[0].replace(/\./g, "").replace(",", ".");
    const n = Number(limpio);
    if (Number.isFinite(n)) salida.push(n);
  }
  return salida;
}

const clave = leerClave();
const esfuerzo = argumento("esfuerzo") ?? ESFUERZO;
const modelo = argumento("modelo") ?? MODELO;

async function probar(c: Caso) {
  const entrada = prepararEntrada({
    request_id: randomUUID(),
    usuario_id: randomUUID(),
    conversacion_id: randomUUID(),
    nombre: "Carmen",
    mensaje: c.mensaje,
    plan: "business",
    contexto_negocio: CONTEXTO_NEGOCIO,
    origen: "whatsapp",
    historial: [],
  });
  const { contenido } = armarPrompt(entrada);
  const t0 = Date.now();
  const r = await fetch("https://api.openai.com/v1/responses", {
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
  if (!r.ok) throw new Error(`OpenAI respondió ${r.status}`);
  const cuerpo = prepararRespuesta(entrada, await r.json());
  const texto = `${cuerpo.respuesta} ${JSON.stringify(cuerpo.acciones)}`;
  const vistos = numerosDe(texto);
  // Un porcentaje se acepta redondeado (38,8 → 39).
  const ok = c.esperado.every((e) => vistos.some((v) => v === e || (e < 100 && Math.round(v) === e)));
  return { c, ok, ms: Date.now() - t0, respuesta: cuerpo.respuesta };
}

const resultados = [];
for (const c of CASOS) resultados.push(await probar(c));

const bien = resultados.filter((r) => r.ok).length;
const lineas = [
  `# Cuentas — ${new Date().toISOString().slice(0, 10)}`,
  "",
  `Modelo \`${MODELO}\` · esfuerzo \`${esfuerzo}\` · **${bien}/${resultados.length} cuentas bien**.`,
  "",
  ...resultados.map(
    (r) =>
      `- ${r.ok ? "✔" : "✖"} \`${r.c.id}\` (${(r.ms / 1000).toFixed(1)} s): «${r.respuesta.replace(/\s*\n+\s*/g, " ⏎ ")}»${r.ok ? "" : ` — esperaba ${r.c.esperado.join(" y ")} (${r.c.porque})`}`,
  ),
  "",
];
const carpeta = path.join(RAIZ, "evals", "bateria", "resultados");
const archivo = path.join(carpeta, `${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}-cuentas-${modelo}-${esfuerzo}.md`);
fs.writeFileSync(archivo, lineas.join("\n"));
console.log(lineas.join("\n"));
