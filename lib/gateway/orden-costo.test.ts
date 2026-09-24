import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aplicar as aplicarRepetidas } from "../../n8n/parches/cambios-acciones-repetidas.mjs";
import { aplicarPrompt } from "../../n8n/parches/cambios-contexto-conversacion.mjs";
import { aplicar } from "../../n8n/parches/cambios-orden-costo.mjs";
import { verificarFlujo } from "../../n8n/parches/verificar.mjs";
import { armarJobs, costoDespuesDeCrear } from "./jobs.ts";
import { prepararEntrada } from "./entrada.ts";
import { prepararRespuesta, type Accion } from "./respuesta.ts";
import { PROMPT_SISTEMA } from "./sistema.ts";

/**
 * "Registrá esta venta: Campera Marrón Claro, 230.000, costo 207.052"
 * (24/09/2026). El costo tiene que correr DESPUÉS de la venta que crea el
 * producto, en el gateway TypeScript y en el nodo 06 de n8n por igual.
 */

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_C = "33333333-3333-4333-a333-333333333333";

const COSTO: Accion = {
  tipo: "ACTUALIZAR_PRODUCTO",
  datos: { productos: [{ nombre: "Campera Marron Claro", costo: 207052 }] },
};
const VENTA: Accion = {
  tipo: "REGISTRAR_VENTA",
  datos: { items: [{ producto: "Campera Marron Claro", cantidad: 1, precio_unitario: 230000 }] },
};
const MEMORIA: Accion = { tipo: "GUARDAR_MEMORIA", datos: { contenido: "Vende camperas" } };

const tipos = (lista: { tipo: string }[]) => lista.map((a) => a.tipo);

function jobsTs(acciones: Accion[]) {
  const entrada = prepararEntrada({
    request_id: UUID_A,
    usuario_id: UUID_B,
    conversacion_id: UUID_C,
    mensaje: "registrá esta venta",
  });
  const respuesta = prepararRespuesta(entrada, {
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify({ respuesta: "Listo.", acciones }) }],
      },
    ],
  });
  return armarJobs(entrada, respuesta).map((j) => [j.accion.tipo, j.request_id]);
}

function jobsN8n(acciones: Accion[]) {
  const flujo = JSON.parse(
    readFileSync(new URL("../../n8n/workflows/eos-conversational-gateway-rc1.json", import.meta.url), "utf8"),
  );
  const nodo = flujo.nodes.find((n: { name: string }) => n.name === "06 GW Preparar Jobs Worker");
  let codigo: string = nodo.parameters.jsCode;
  if (!codigo.includes("requestIdDeAccion")) codigo = aplicarRepetidas(codigo, "copia de prueba");
  if (!codigo.includes("costoDespuesDeCrear")) codigo = aplicar(codigo, "copia de prueba");
  const i = {
    request_id: UUID_A,
    usuario_id: UUID_B,
    conversacion_id: UUID_C,
    mensaje: "registrá esta venta",
    respuesta: "Listo.",
    acciones,
    metadata: {},
  };
  const $ = () => ({ first: () => ({ json: i }) });
  return (new Function("$", codigo)($) as { json: { request_id: string; accion: { tipo: string } } }[]).map(
    (x) => [x.json.accion.tipo, x.json.request_id],
  );
}

test("el costo que venía antes de la venta pasa a después", () => {
  assert.deepEqual(tipos(costoDespuesDeCrear([COSTO, VENTA])), ["REGISTRAR_VENTA", "ACTUALIZAR_PRODUCTO"]);
  assert.deepEqual(tipos(costoDespuesDeCrear([COSTO, MEMORIA, VENTA, MEMORIA])), [
    "GUARDAR_MEMORIA",
    "REGISTRAR_VENTA",
    "ACTUALIZAR_PRODUCTO",
    "GUARDAR_MEMORIA",
  ]);
});

test("el orden bueno, o sin nada que cree el producto, no se toca", () => {
  const bueno = [VENTA, COSTO];
  assert.equal(costoDespuesDeCrear(bueno), bueno);
  const solo = [COSTO, MEMORIA];
  assert.equal(costoDespuesDeCrear(solo), solo);
});

test("un cambio de precio antes de una venta se respeta (puede ser a propósito)", () => {
  const precio: Accion = {
    tipo: "ACTUALIZAR_PRODUCTO",
    datos: { productos: [{ nombre: "Campera Marron Claro", precio_venta: 250000, costo: 207052 }] },
  };
  const lista = [precio, VENTA];
  assert.equal(costoDespuesDeCrear(lista), lista);
});

test("n8n y TypeScript dan exactamente el mismo orden y los mismos request_id", () => {
  for (const acciones of [[COSTO, VENTA], [COSTO, MEMORIA, VENTA], [VENTA, COSTO], [COSTO, MEMORIA]]) {
    assert.deepEqual(jobsN8n(acciones), jobsTs(acciones), JSON.stringify(tipos(acciones)));
  }
  assert.deepEqual(
    jobsTs([COSTO, VENTA]).map(([t]) => t),
    ["REGISTRAR_VENTA", "ACTUALIZAR_PRODUCTO"],
  );
});

test("el parche del nodo 06 falla fuerte si el nodo cambió", () => {
  assert.throws(() => aplicar("nada que ver", "x"), /aparece 0 veces/);
});

test("la regla de usar el contexto entra en el prompt de los dos caminos y compila", () => {
  const flujo = JSON.parse(
    readFileSync(new URL("../../n8n/workflows/eos-conversational-gateway-rc1.json", import.meta.url), "utf8"),
  );
  const http = flujo.nodes.find((n: { name: string }) => n.name === "HTTP Request");
  const marca = "Lo que ya está en la conversación NO se vuelve a preguntar";

  if (!http.parameters.jsonBody.includes(marca)) {
    http.parameters.jsonBody = aplicarPrompt(http.parameters.jsonBody, "copia de prueba");
    verificarFlujo(flujo, "gateway de prueba");
    assert.ok(aplicarPrompt(PROMPT_SISTEMA, "sistema.ts").includes(marca));
  } else {
    assert.ok(PROMPT_SISTEMA.includes(marca), "falta sincronizar-prompt.mjs");
  }
});
