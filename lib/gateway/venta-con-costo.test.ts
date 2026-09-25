import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aplicarPrompt, aplicarWorker } from "../../n8n/parches/cambios-venta-con-costo.mjs";
import { limpiarRespuestaVisible } from "../eos/respuesta-visible.ts";
import { PROMPT_SISTEMA } from "./sistema.ts";

/**
 * El costo que EOS ya sabe viaja con la venta (v198, 25/09/2026).
 *
 * Caso real: Sofía dictó una venta, EOS le mostró el margen de cada producto
 * con su costo, y en el mismo mensaje le dijo "De 2 de esos productos no sé el
 * costo". Toma el prompt y las frases de los workflows EXPORTADOS —lo que
 * corre—; si el parche todavía no se aplicó a n8n, lo aplica sobre una COPIA
 * en memoria y prueba eso.
 */

const leer = (nombre: string) =>
  JSON.parse(readFileSync(new URL(`../../n8n/workflows/${nombre}`, import.meta.url), "utf8"));

const gateway = leer("eos-conversational-gateway-rc1.json");
const worker = leer("eos-background-worker-rc1.json");

const promptOriginal: string = gateway.nodes.find((n: { name: string }) => n.name.startsWith("HTTP Request")).parameters.jsonBody;
const prompt = promptOriginal.includes("costo_unitario?") ? promptOriginal : aplicarPrompt(promptOriginal, "copia");

const codigoOriginal: string = worker.nodes.find((n: { name: string }) => n.name === "05 INT Respuesta").parameters.jsCode;
const codigo = codigoOriginal.includes("le puse el costo de") ? codigoOriginal : aplicarWorker(codigoOriginal, "copia");

const venta = (texto: string) => texto.slice(texto.indexOf("REGISTRAR_VENTA\n  datos"), texto.indexOf("AJUSTAR_STOCK\n  datos"));

// ------------------------------------------------------------------ el prompt

test("el prompt le da a la venta dónde llevar el costo", () => {
  assert.match(venta(prompt), /items: \[\{ producto, cantidad, precio_unitario\?, costo_unitario\? \}\]/);
});

test("el prompt exige que el costo usado para el margen vaya en la venta", () => {
  assert.match(venta(prompt), /el\n {2}costo que usaste para calcularlo TIENE que ir en su costo_unitario/);
  assert.match(venta(prompt), /Si no lo sabés, no lo inventes/);
});

test("el prompt de TypeScript es el mismo que el de n8n", () => {
  assert.ok(PROMPT_SISTEMA.includes("costo_unitario?"), "correr node n8n/parches/sincronizar-prompt.mjs");
});

test("el prompt no rompe el literal de plantilla donde vive", () => {
  assert.ok(!venta(prompt).includes("`"));
  assert.ok(!venta(prompt).includes("${"));
});

test("los parches son idempotentes", () => {
  assert.throws(() => aplicarPrompt(prompt, "ya aplicado"), /ya conoce costo_unitario/);
  assert.throws(() => aplicarWorker(codigo, "ya aplicado"), /ya conoce costos_puestos/);
});

// ------------------------------------------------------------------ las frases

function cargar(): (r: unknown) => string {
  const fin = codigo.indexOf("const prep = $('03 INT Preparar Efecto')");
  const cuerpo = codigo.slice(0, fin);
  const plata = (n: number) => String(n);
  const signoDe = () => "₲ ";
  return new Function("plata", "signoDe", `${cuerpo}\nreturn fraseDeVenta;`)(plata, signoDe) as (r: unknown) => string;
}

const fraseDeVenta = cargar();

test("el caso de Sofía: con el costo en la venta no dice que no lo sabe", () => {
  const t = fraseDeVenta({
    resultado: {
      total: 308000,
      productos_creados: [
        { nombre: "Zapatos Mary Jane", precio_venta: 180000 },
        { nombre: "Maija pantalones", precio_venta: 128000 },
      ],
      costos_puestos: [
        { nombre: "Zapatos Mary Jane", costo: 146473.88 },
        { nombre: "Maija pantalones", costo: 116382.08 },
      ],
      sin_costo: [],
    },
  });

  assert.doesNotMatch(t, /no sé/);
  assert.match(t, /Les puse el costo a “Zapatos Mary Jane” \(₲ 146\.473,88\), “Maija pantalones” \(₲ 116\.382,08\)/);
  assert.match(t, /sus márgenes ya están calculados/);
});

test("un solo costo puesto se dice con su número", () => {
  const t = fraseDeVenta({ resultado: { total: 1, costos_puestos: [{ nombre: "Campera", costo: 207052 }] } });
  assert.match(t, /A “Campera” le puse el costo de ₲ 207\.052, así que su margen ya está calculado\./);
});

test("varios sin costo se NOMBRAN, no 'de 2 de esos productos'", () => {
  const t = fraseDeVenta({ resultado: { total: 1, sin_costo: ["Top", "Short", "Vestido"] } });
  assert.doesNotMatch(t, /De 3 de esos/);
  assert.match(t, /Todavía no sé cuánto te cuestan “Top”, “Short” y “Vestido”, así que sus márgenes quedan pendientes/);
});

test("uno sin costo sigue con la frase de siempre", () => {
  const t = fraseDeVenta({ resultado: { total: 1, sin_costo: ["Top"] } });
  assert.match(t, /Todavía no sé cuánto te cuesta “Top”, así que el margen queda pendiente: decime el costo y lo completo\./);
});

test("sin `costos_puestos` (base sin la v198) no se rompe", () => {
  assert.equal(fraseDeVenta({ resultado: { total: 100 } }), "Registré la venta por ₲ 100. La ves en Negocio > Ventas.");
});

// ------------------------------------------------ la red de respuesta-visible

test("un costo puesto por ACTUALIZAR_PRODUCTO saca el pedido plural de ese producto", () => {
  const crudo = [
    "Actualicé 2 productos. “Zapatos Mary Jane”: costo 146.473,88 (no tenía). “Maija pantalones”: costo 116.382,08 (no tenía). Lo ves en Negocio > Productos.",
    "",
    "Registré la venta por ₲ 308.000. La ves en Negocio > Ventas. Todavía no sé cuánto te cuestan “Zapatos Mary Jane” y “Maija pantalones”, así que sus márgenes quedan pendientes: pasame los costos y los completo.",
  ].join("\n");
  const r = limpiarRespuestaVisible(crudo).texto;
  assert.doesNotMatch(r, /no sé/);
  assert.ok(r.endsWith("La ves en Negocio > Ventas."));
});

test("si solo uno de los pedidos se resolvió, queda el otro en singular", () => {
  const crudo =
    "Actualicé “Zapatos Mary Jane”: costo 146.473 (no tenía).\n\nTodavía no sé cuánto te cuestan “Zapatos Mary Jane” y “Top”, así que sus márgenes quedan pendientes: pasame los costos y los completo.";
  const r = limpiarRespuestaVisible(crudo).texto;
  assert.match(r, /Todavía no sé cuánto te cuesta “Top”, así que el margen queda pendiente: decime el costo y lo completo\./);
  assert.doesNotMatch(r, /cuestan/);
});

test("el costo que el MODELO escribió en su texto no cuenta como puesto", () => {
  const crudo =
    "Zapatos Mary Jane: venta ₲180.000, costo ₲146.473.\n\nTodavía no sé cuánto te cuesta “Zapatos Mary Jane”, así que el margen queda pendiente: decime el costo y lo completo.";
  assert.match(limpiarRespuestaVisible(crudo).texto, /decime el costo/);
});

test("la frase plural de la venta cuenta como costo puesto", () => {
  const crudo =
    "Les puse el costo a “A” (₲ 10), “B” (₲ 20), así que sus márgenes ya están calculados. Todavía no sé cuánto te cuesta “A”, así que el margen queda pendiente: decime el costo y lo completo.";
  assert.doesNotMatch(limpiarRespuestaVisible(crudo).texto, /decime el costo/);
});
