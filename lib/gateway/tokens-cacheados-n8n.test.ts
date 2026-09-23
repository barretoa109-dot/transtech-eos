import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aplicar05, aplicar08 } from "../../n8n/parches/cambios-tokens-cacheados.mjs";

/**
 * Los tokens cacheados de OpenAI viajan por el gateway de n8n (punto 8).
 *
 * Toma el código del workflow EXPORTADO —el que corre— y ejecuta el tramo del
 * consumo. Si el parche todavía no se aplicó, lo aplica sobre una COPIA en
 * memoria: se valida antes de tocar producción y, después, el mismo test
 * protege lo que quedó corriendo.
 */

const flujo = JSON.parse(
  readFileSync(
    new URL("../../n8n/workflows/eos-conversational-gateway-rc1.json", import.meta.url),
    "utf8",
  ),
);

function codigoDe(nombre: string, aplicar: (t: string, e: string) => string, marca: string): string {
  const n = flujo.nodes.find((x: { name: string }) => x.name === nombre);
  const original: string = n.parameters.jsCode;
  return original.includes(marca) ? original : aplicar(original, "copia de prueba");
}

const c05 = codigoDe("05 GW Preparar Respuesta", aplicar05, "tokens_entrada_cacheados");
const c08 = codigoDe("08 GW Agregar Resultados Worker", aplicar08, "tokens_entrada_cacheados");

/** Evalúa solo la declaración de `consumo` del nodo 05, con el `ai` que se le pase. */
function consumoDe(ai: unknown) {
  const desde = c05.indexOf("const consumo =");
  const hasta = c05.indexOf(";", c05.indexOf(": { tokens_entrada: 0", desde)) + 1;
  return new Function("ai", `${c05.slice(desde, hasta)}\nreturn consumo;`)(ai);
}

test("05 lee cached_tokens de la Responses API", () => {
  const consumo = consumoDe({
    usage: { input_tokens: 9000, input_tokens_details: { cached_tokens: 7900 }, output_tokens: 200 },
  });
  assert.deepEqual(consumo, {
    tokens_entrada: 9000,
    tokens_entrada_cacheados: 7900,
    tokens_salida: 200,
  });
});

test("05 sin detalle de caché deja los cacheados en cero", () => {
  assert.equal(consumoDe({ usage: { input_tokens: 10, output_tokens: 2 } }).tokens_entrada_cacheados, 0);
  assert.equal(consumoDe({}).tokens_entrada_cacheados, 0);
});

test("08 pasa los cacheados a la respuesta final", () => {
  assert.match(c08, /tokens_entrada_cacheados: base\.tokens_entrada_cacheados \|\| 0,/);
});

test("el parche falla fuerte si el texto no está exactamente una vez", () => {
  assert.throws(() => aplicar05("nada que ver", "x"), /aparece 0 veces/);
  assert.throws(() => aplicar08("nada que ver", "x"), /aparece 0 veces/);
});
