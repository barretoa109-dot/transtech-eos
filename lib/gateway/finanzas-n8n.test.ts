import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { transformarGateway, transformarWorker } from "../../n8n/parches/transformar-finanzas-confirma-lo-guardado.mjs";
import { verificarFlujo } from "../../n8n/parches/verificar.mjs";
import { fraseDeCompraTarjeta, fraseDePagoTarjeta, fraseDePersonal, fraseDeTarjeta } from "./frases-finanzas.ts";

/**
 * El parche del caso Green, aplicado sobre los workflows EXPORTADOS.
 *
 * Si el parche todavía no corrió en n8n, se aplica sobre una copia en memoria;
 * después de correrlo y reexportar, la transformación no hace nada (tiene su
 * marca) y la prueba protege lo que quedó corriendo.
 *
 * Lo que importa: que n8n (camino de imágenes) diga EXACTAMENTE lo mismo que
 * TypeScript (camino de texto). El 29/09/2026 uno decía "Anoté la compra." y
 * el otro "Anoté Punto Farma por ₲ 46.000 en Green ****7450…".
 */

type Nodo = { name: string; parameters: Record<string, string> };
type Flujo = { nodes: Nodo[] };

const leer = (nombre: string): Flujo =>
  JSON.parse(readFileSync(new URL(`../../n8n/workflows/${nombre}`, import.meta.url), "utf8"));

const worker = transformarWorker(leer("eos-background-worker-rc1.json")) as Flujo;
const gateway = transformarGateway(leer("eos-conversational-gateway-rc1.json")) as Flujo;

function frasesDelWorker(): (accion: string, result: unknown) => string | null {
  const codigo = worker.nodes.find((n) => n.name === "05 INT Respuesta")!.parameters.jsCode;
  const corte = codigo.indexOf("const prep");
  return new Function(`${codigo.slice(0, corte)}\nreturn fraseDeAccion;`)();
}

const COMPRA = {
  cuotas: 1, moneda: "PYG", tarjeta: "Green ****7450", descripcion: "Punto Farma",
  monto_cuota: 46000, monto_total: 46000, cuota_estimada: false, tarjeta_creada: false,
};

test("los dos workflows parcheados compilan", () => {
  assert.ok(verificarFlujo(worker, "worker") > 0);
  assert.ok(verificarFlujo(gateway, "gateway") > 0);
});

test("n8n y TypeScript dicen lo mismo de la compra, la tarjeta, los movimientos y el pago de tarjeta", () => {
  const frase = frasesDelWorker();
  const casos: [string, Record<string, unknown>, (r: unknown) => string | null][] = [
    ["REGISTRAR_COMPRA_TARJETA", COMPRA, fraseDeCompraTarjeta],
    ["REGISTRAR_COMPRA_TARJETA", { ...COMPRA, ya_estaba: true, anotada_a_las: "17:34" }, fraseDeCompraTarjeta],
    ["REGISTRAR_TARJETA", { tarjeta: "Green ****7450", moneda: "PYG", sin_cambios: true, cambios: [] }, fraseDeTarjeta],
    [
      "REGISTRAR_MOVIMIENTO_PERSONAL",
      { movimientos: [], repetidos: [{ monto: 22650, moneda: "PYG", fecha: "2026-09-27", como: "Punto Farma - Molas López" }] },
      fraseDePersonal,
    ],
    // v222: sin el parche, n8n decía "No quedó registrado el pago." sobre un pago que sí quedó.
    [
      "REGISTRAR_PAGO_DEUDA",
      { es_tarjeta: true, tarjeta: "Green ****7450", pagado: 188000, moneda: "PYG", saldo_antes: 2832181, saldo_despues: 2644181 },
      fraseDePagoTarjeta,
    ],
  ];
  for (const [accion, resultado, ts] of casos) {
    assert.equal(frase(accion, { resultado }), ts({ resultado }), accion);
  }
});

test("n8n: el pago de una deuda de verdad sigue diciendo lo de siempre", () => {
  const frase = frasesDelWorker();
  const r = { acreedor: "Ueno", pagado: 800000, saldo_antes: 5000000, saldo_despues: 4200000 };
  assert.match(frase("REGISTRAR_PAGO_DEUDA", { resultado: r })!, /^Pagaste ₲ 800\.000 a Ueno\./);
});

test("el nodo 08 saca los anuncios que un error contradice", () => {
  const codigo = gateway.nodes.find((n) => n.name === "08 GW Agregar Resultados Worker")!.parameters.jsCode;
  assert.match(codigo, /anunciosContradichos\(resultados\) \? sinAnuncios\(delModelo\)/);
  assert.match(codigo, /if \(!respuesta\.trim\(\)\) respuesta = 'Listo\.';/);
});

test("el prompt de n8n trae las reglas del caso Green, junto con las de la v222", () => {
  const prompt = gateway.nodes.find((n) => n.name === "HTTP Request")!.parameters.jsonBody;
  assert.match(prompt, /ES CONTEXTO, NO UN\n  PEDIDO/);
  assert.match(prompt, /Esto vale cuando pagar ES lo que pide el mensaje/);
  assert.match(prompt, /LO QUE YA CONFIRMASTE NO SE VUELVE A MANDAR/);
  assert.match(prompt, /"repetir": true en datos/);
  assert.doesNotMatch(prompt, /qué quedó sin hacer o falló, y mandá esa\n  acción de nuevo/);
});

test("la transformación es idempotente: aplicada dos veces, queda igual", () => {
  const una = JSON.stringify(worker);
  assert.equal(JSON.stringify(transformarWorker(JSON.parse(una))), una);
  const g = JSON.stringify(gateway);
  assert.equal(JSON.stringify(transformarGateway(JSON.parse(g))), g);
});
