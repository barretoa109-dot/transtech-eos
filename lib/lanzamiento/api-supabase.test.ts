import assert from "node:assert/strict";
import test from "node:test";

import { ESPERAS_MS, consultar } from "../../scripts/lib/api-supabase.mjs";

/**
 * `npm run respaldo` se cortó a la mitad (24/09/2026) con "ThrottlerException:
 * Too Many Requests": la Management API limita las consultas por minuto.
 */

type Respuesta = { status: number; cuerpo: unknown; retryAfter?: string };

function falsa(respuestas: Respuesta[]) {
  const llamadas: string[] = [];
  const traer = async (url: string) => {
    llamadas.push(url);
    const r = respuestas.shift()!;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      headers: new Headers(r.retryAfter ? { "retry-after": r.retryAfter } : {}),
      text: async () => JSON.stringify(r.cuerpo),
    };
  };
  return { traer: traer as unknown as typeof fetch, llamadas };
}

test("un 429 se espera y se reintenta, sin perder la consulta", async () => {
  const esperas: number[] = [];
  const { traer, llamadas } = falsa([
    { status: 429, cuerpo: { message: "ThrottlerException: Too Many Requests" } },
    { status: 429, cuerpo: { message: "ThrottlerException: Too Many Requests" }, retryAfter: "5" },
    { status: 201, cuerpo: [{ n: 3 }] },
  ]);
  const filas = await consultar("ref", "tok", "select 1", { fetch: traer, esperar: async (ms: number) => void esperas.push(ms) });
  assert.deepEqual(filas, [{ n: 3 }]);
  assert.equal(llamadas.length, 3);
  assert.deepEqual(esperas, [ESPERAS_MS[0], 5_000]);
});

test("un error de verdad (SQL mal escrito) no se reintenta", async () => {
  const { traer, llamadas } = falsa([{ status: 400, cuerpo: { message: "syntax error" } }]);
  await assert.rejects(consultar("ref", "tok", "selec", { fetch: traer, esperar: async () => {} }), /syntax error/);
  assert.equal(llamadas.length, 1);
});

test("si la API sigue saturada, termina fallando con su mensaje", async () => {
  const muchas = Array.from({ length: ESPERAS_MS.length + 1 }, () => ({
    status: 429,
    cuerpo: { message: "ThrottlerException: Too Many Requests" },
  }));
  const { traer, llamadas } = falsa(muchas);
  await assert.rejects(consultar("ref", "tok", "select 1", { fetch: traer, esperar: async () => {} }), /Too Many Requests/);
  assert.equal(llamadas.length, ESPERAS_MS.length + 1);
});
