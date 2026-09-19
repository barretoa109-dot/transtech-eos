import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aplicarPrompt, aplicarWorker } from "../../n8n/parches/cambios-chat-vence-el.mjs";

/**
 * El chat entiende "me paga el 30" y lo dice de vuelta (v182).
 *
 * Toma el prompt del gateway y las frases del worker de los workflows EXPORTADOS
 * —lo que corre—. Si el parche todavía no se aplicó a n8n, lo aplica sobre una
 * COPIA en memoria y prueba eso: se valida antes de tocar producción, y después
 * de aplicarlo el mismo test sigue protegiendo lo que quedó corriendo.
 */

const leer = (nombre: string) =>
  JSON.parse(readFileSync(new URL(`../../n8n/workflows/${nombre}`, import.meta.url), "utf8"));

const gateway = leer("eos-conversational-gateway-rc1.json");
const worker = leer("eos-background-worker-rc1.json");

const promptOriginal: string = gateway.nodes.find((n: { name: string }) => n.name.startsWith("HTTP Request")).parameters.jsonBody;
const prompt = promptOriginal.includes("vence_en_dias") ? promptOriginal : aplicarPrompt(promptOriginal, "copia");

const codigoOriginal: string = worker.nodes.find((n: { name: string }) => n.name === "05 INT Respuesta").parameters.jsCode;
const codigo = codigoOriginal.includes("r.condicion === 'credito'") ? codigoOriginal : aplicarWorker(codigoOriginal, "copia");

// ------------------------------------------------------------------ el prompt

test("el prompt le enseña al modelo los tres campos, en la venta y en la compra", () => {
  for (const campo of ["vence_dia", "vence_en_dias", "vence_el"]) {
    assert.ok(prompt.includes(campo), campo);
  }

  const venta = prompt.slice(prompt.indexOf("REGISTRAR_VENTA\n  datos"), prompt.indexOf("AJUSTAR_STOCK\n  datos"));
  assert.match(venta, /vence_dia\?, vence_en_dias\?, vence_el\?/);
  assert.match(venta, /me paga el 30/);

  const compra = prompt.slice(prompt.indexOf("REGISTRAR_COMPRA\n  datos"), prompt.indexOf("REGISTRAR_COBRO\n  datos"));
  assert.match(compra, /vence_dia\?, vence_en_dias\?, vence_el\?/);
  assert.match(compra, /hay que PAGAR/);
});

test("el prompt NO le pide al modelo que calcule la fecha: no sabe qué día es hoy", () => {
  const venta = prompt.slice(prompt.indexOf("REGISTRAR_VENTA\n  datos"), prompt.indexOf("AJUSTAR_STOCK\n  datos"));
  assert.match(venta, /no hagas la\n  cuenta vos/);
  assert.match(venta, /SOLO si dicen la fecha completa con el año/);
});

test("el prompt no preguntaría el vencimiento: si no lo dicen, queda sin él", () => {
  assert.match(prompt, /Si no dicen cuándo, no lo preguntes/);
});

test("el prompt no rompe el literal de plantilla donde vive (sin comillas invertidas)", () => {
  assert.ok(!prompt.slice(prompt.indexOf("REGISTRAR_VENTA\n  datos"), prompt.indexOf("AJUSTAR_STOCK\n  datos")).includes("`"));
});

test("el parche del prompt es idempotente", () => {
  assert.throws(() => aplicarPrompt(prompt, "ya aplicado"), /ya conoce vence_en_dias/);
});

// ------------------------------------------------------------------ las frases

type Frases = { fraseDeVenta: (r: unknown) => string; fraseDeCompra: (r: unknown) => string };

function cargar(): Frases {
  const fin = codigo.indexOf("const prep = $('03 INT Preparar Efecto')");
  const cuerpo = codigo.slice(0, fin);
  const plata = (n: number) => String(n);
  const signoDe = () => "₲ ";
  return new Function("plata", "signoDe", `${cuerpo}\nreturn { fraseDeVenta, fraseDeCompra };`)(plata, signoDe) as Frases;
}

const f = cargar();
const anio = new Date(Date.now() - 3 * 3600000).getUTCFullYear();

test("una venta a crédito con fecha dice cuándo te la pagan", () => {
  const t = f.fraseDeVenta({ resultado: { total: 60000, condicion: "credito", vence_el: `${anio}-09-30` } });
  assert.match(t, /Registré la venta por ₲ 60.000./);
  assert.match(t, /Quedó a crédito: te la pagan el 30 de septiembre\./);
});

test("una venta a crédito SIN fecha no agrega nada (no hay qué decir)", () => {
  const t = f.fraseDeVenta({ resultado: { total: 60000, condicion: "credito", vence_el: null } });
  assert.doesNotMatch(t, /crédito/);
});

test("una venta al contado no menciona vencimiento", () => {
  const t = f.fraseDeVenta({ resultado: { total: 60000, condicion: "contado", vence_el: null } });
  assert.doesNotMatch(t, /crédito|pagan/);
});

test("una respuesta vieja, sin los campos nuevos, se dice como siempre (tolera la base sin la v182)", () => {
  assert.equal(
    f.fraseDeVenta({ resultado: { total: 60000 } }),
    "Registré la venta por ₲ 60.000. La ves en Negocio > Ventas.",
  );
});

const compra = (extra: Record<string, unknown>) => ({
  resultado: { compra: [{ concepto: "Flete", en_catalogo: false, mueve_stock: false }], total_compra: 50000, sin_catalogo: ["Flete"], ...extra },
});

test("una compra a crédito con fecha dice cuándo pagar y avisa que va a avisar", () => {
  const t = f.fraseDeCompra(compra({ condicion: "credito", vence_el: `${anio}-10-05` }));
  assert.match(t, /Quedó a pagar el 5 de octubre, y te aviso cuando esté por vencer\./);
});

test("una compra a crédito YA NO dice que el gasto está en el panel: la plata no salió", () => {
  for (const vence of [`${anio}-10-05`, null]) {
    const t = f.fraseDeCompra(compra({ condicion: "credito", vence_el: vence }));
    assert.doesNotMatch(t, /el gasto ya está en el panel financiero/);
  }
});

test("una compra a crédito sin fecha lo dice: todavía no es un gasto del mes", () => {
  const t = f.fraseDeCompra(compra({ condicion: "credito", vence_el: null }));
  assert.match(t, /sin fecha de pago, así que todavía no cuenta como gasto del mes/);
});

test("una compra al contado sigue diciendo que el gasto ya está en el panel", () => {
  assert.match(f.fraseDeCompra(compra({ condicion: "contado" })), /el gasto ya está en el panel financiero/);
});

test("una respuesta vieja de compra, sin condición, se dice como siempre", () => {
  assert.match(f.fraseDeCompra(compra({})), /el gasto ya está en el panel financiero/);
});

test("el parche del worker es idempotente y exige el de fechas legibles", () => {
  assert.throws(() => aplicarWorker(codigo, "ya aplicado"), /ya conocen la condición/);
  assert.throws(() => aplicarWorker("function fraseDeVenta() {}", "sin helper"), /falta fechaLarga/);
});
