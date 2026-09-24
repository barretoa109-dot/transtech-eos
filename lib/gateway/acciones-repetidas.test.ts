import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aplicar } from "../../n8n/parches/cambios-acciones-repetidas.mjs";
import { aplicarPrompt } from "../../n8n/parches/cambios-memoria-silenciosa.mjs";
import { verificarFlujo } from "../../n8n/parches/verificar.mjs";
import { armarJobs, requestIdDeAccion } from "./jobs.ts";
import { prepararEntrada } from "./entrada.ts";
import { prepararRespuesta } from "./respuesta.ts";
import { PROMPT_SISTEMA } from "./sistema.ts";

/**
 * Dos acciones del mismo tipo en un mensaje (caso real del 24/09/2026: el chat
 * mostró dos `409 EOS_COMMAND_PAYLOAD_MISMATCH` crudos).
 *
 * Se prueba el gateway en TypeScript y el nodo 06 de n8n —el EXPORTADO, con el
 * parche aplicado en memoria si todavía no se aplicó— con las mismas acciones,
 * y se exige que den exactamente los mismos request_id.
 */

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_C = "33333333-3333-4333-a333-333333333333";
// El mismo patrón que valida el Worker (01 INT Preparar) y el gate.
const UUID_WORKER = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACCIONES = [
  { tipo: "GUARDAR_MEMORIA", datos: { contenido: "Salario Gs. 1.700.000" } },
  { tipo: "REGISTRAR_TARJETA", datos: { nombre: "Green", ultimos4: "7450", dia_cierre: 15, dia_vencimiento: 6 } },
  { tipo: "GUARDAR_MEMORIA", datos: { contenido: "Tigo y facultad: Gs. 3.945.000 al mes" } },
  { tipo: "GUARDAR_MEMORIA", datos: { contenido: "Salario Gs. 1.700.000" } },
];

function jobsTs(acciones = ACCIONES) {
  const entrada = prepararEntrada({
    request_id: UUID_A,
    usuario_id: UUID_B,
    conversacion_id: UUID_C,
    mensaje: "anotá todo",
  });
  const respuesta = prepararRespuesta(entrada, {
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify({ respuesta: "Listo.", acciones }) }],
      },
    ],
  });
  return armarJobs(entrada, respuesta);
}

function jobsN8n(acciones = ACCIONES) {
  const flujo = JSON.parse(
    readFileSync(new URL("../../n8n/workflows/eos-conversational-gateway-rc1.json", import.meta.url), "utf8"),
  );
  const nodo = flujo.nodes.find((n: { name: string }) => n.name === "06 GW Preparar Jobs Worker");
  const original: string = nodo.parameters.jsCode;
  const codigo = original.includes("requestIdDeAccion") ? original : aplicar(original, "copia de prueba");
  const i = {
    request_id: UUID_A,
    usuario_id: UUID_B,
    conversacion_id: UUID_C,
    mensaje: "anotá todo",
    respuesta: "Listo.",
    acciones,
    metadata: {},
  };
  const $ = () => ({ first: () => ({ json: i }) });
  return (new Function("$", codigo)($) as { json: { request_id: string; accion: { tipo: string } } }[]).map(
    (x) => x.json,
  );
}

test("la memoria repetida idéntica se deja una sola vez", () => {
  const jobs = jobsTs();
  assert.equal(jobs.length, 3);
  assert.deepEqual(
    jobs.map((j) => j.accion.tipo),
    ["GUARDAR_MEMORIA", "REGISTRAR_TARJETA", "GUARDAR_MEMORIA"],
  );
});

test("la primera de cada tipo conserva el request_id; la segunda usa uno derivado", () => {
  const [memoria1, tarjeta, memoria2] = jobsTs();
  assert.equal(memoria1.request_id, UUID_A);
  assert.equal(tarjeta.request_id, UUID_A);
  assert.notEqual(memoria2.request_id, UUID_A);
  assert.match(memoria2.request_id, UUID_WORKER, "el Worker rechaza un request_id que no es UUID");
});

test("el id derivado es determinístico y distinto por ordinal", () => {
  assert.equal(requestIdDeAccion(UUID_A, 0), UUID_A);
  assert.equal(requestIdDeAccion(UUID_A, 1), requestIdDeAccion(UUID_A, 1));
  const ids = new Set([0, 1, 2, 3, 4, 5].map((k) => requestIdDeAccion(UUID_A, k)));
  assert.equal(ids.size, 6);
  for (const id of ids) assert.match(id, UUID_WORKER);
  // Borde: el último segmento al máximo no se sale de 12 dígitos.
  const alto = "ffffffff-ffff-4fff-bfff-ffffffffffff";
  assert.match(requestIdDeAccion(alto, 3), UUID_WORKER);
});

test("n8n y TypeScript dan exactamente los mismos request_id", () => {
  const ts = jobsTs().map((j) => [j.accion.tipo, j.request_id]);
  const n8n = jobsN8n().map((j) => [j.accion.tipo, j.request_id]);
  assert.deepEqual(n8n, ts);
});

test("un mensaje con acciones de tipos distintos no cambia nada", () => {
  const acciones = [ACCIONES[0], ACCIONES[1]];
  assert.ok(jobsTs(acciones).every((j) => j.request_id === UUID_A));
  assert.ok(jobsN8n(acciones).every((j) => j.request_id === UUID_A));
});

test("el parche falla fuerte si el nodo cambió", () => {
  assert.throws(() => aplicar("nada que ver", "x"), /aparece 0 veces/);
});

// ---------------------------------------------------------------------------
// La memoria en silencio (el mismo parche, del lado del prompt)
// ---------------------------------------------------------------------------


test("la regla de memoria silenciosa entra en el prompt de los dos caminos", () => {
  const flujo = JSON.parse(
    readFileSync(new URL("../../n8n/workflows/eos-conversational-gateway-rc1.json", import.meta.url), "utf8"),
  );
  const http = flujo.nodes.find((n: { name: string }) => n.name === "HTTP Request");
  const yaAplicado = http.parameters.jsonBody.includes("GUARDAR_MEMORIA es trabajo de fondo");

  if (!yaAplicado) {
    http.parameters.jsonBody = aplicarPrompt(http.parameters.jsonBody, "copia de prueba");
    // El prompt vive dentro de un literal de plantilla: tiene que seguir compilando.
    verificarFlujo(flujo, "gateway de prueba");
    const enTs = aplicarPrompt(PROMPT_SISTEMA, "sistema.ts");
    assert.ok(enTs.includes("se hace en silencio"));
  } else {
    assert.ok(PROMPT_SISTEMA.includes("GUARDAR_MEMORIA es trabajo de fondo"), "falta sincronizar-prompt.mjs");
  }
});
