import test from "node:test";
import assert from "node:assert/strict";

import { autorizadoComoWorker } from "./worker-bearer.ts";

/**
 * Esta función decide quién puede ejecutar acciones con efecto durable, y
 * hasta hoy no tenía un solo test: vivía copiada en tres archivos y ninguno la
 * probaba. Unificarla sin cubrirla habría sido mover el riesgo de lugar.
 */

const SECRETO = "un-secreto-de-prueba";

/** Corre con el secreto puesto (o sin ninguno, si se pasa null). */
function con<T>(secreto: string | null, correr: () => T): T {
  const previo = process.env.EOS_WORKER_GATE_SECRET;
  if (secreto === null) delete process.env.EOS_WORKER_GATE_SECRET;
  else process.env.EOS_WORKER_GATE_SECRET = secreto;

  try {
    return correr();
  } finally {
    if (previo === undefined) delete process.env.EOS_WORKER_GATE_SECRET;
    else process.env.EOS_WORKER_GATE_SECRET = previo;
  }
}

function pedido(authorization?: string): Request {
  return new Request("https://eos.internal/x", {
    method: "POST",
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });
}

// ---------------------------------------------------------------------------
// Los tres resultados son tres
// ---------------------------------------------------------------------------

test("sin secreto configurado dice `unavailable`, que no es `no autorizado`", () => {
  // Quien llama responde 503 y no 401: el problema es del servidor. Si dijera
  // "no autorizado" mandaría a revisar el token de quien llama cuando lo que
  // falta es una variable de entorno.
  const r = con(null, () => autorizadoComoWorker(pedido(`Bearer ${SECRETO}`)));
  assert.deepEqual(r, { ok: false, unavailable: true });
});

test("con el secreto correcto, autoriza", () => {
  const r = con(SECRETO, () => autorizadoComoWorker(pedido(`Bearer ${SECRETO}`)));
  assert.deepEqual(r, { ok: true, unavailable: false });
});

test("con un secreto equivocado del mismo largo, no autoriza", () => {
  const otro = "X".repeat(SECRETO.length);
  assert.equal(otro.length, SECRETO.length, "el test tiene que comparar largos iguales");

  const r = con(SECRETO, () => autorizadoComoWorker(pedido(`Bearer ${otro}`)));
  assert.deepEqual(r, { ok: false, unavailable: false });
});

// ---------------------------------------------------------------------------
// Lo que no puede lanzar
// ---------------------------------------------------------------------------

test("un token de otro largo no rompe: `timingSafeEqual` lanza si difieren", () => {
  // Por eso el largo se compara antes y por fuera. Sin ese guard, mandar un
  // token corto tiraría la ruta entera en vez de devolver 401.
  for (const token of ["corto", `${SECRETO}-y-mas-largo`, "a"]) {
    const r = con(SECRETO, () => autorizadoComoWorker(pedido(`Bearer ${token}`)));
    assert.deepEqual(r, { ok: false, unavailable: false }, `falló con "${token}"`);
  }
});

test("sin encabezado no autoriza y no lanza", () => {
  const r = con(SECRETO, () => autorizadoComoWorker(pedido()));
  assert.deepEqual(r, { ok: false, unavailable: false });
});

test("un Bearer vacío no autoriza", () => {
  for (const header of ["Bearer ", "Bearer", ""]) {
    const r = con(SECRETO, () => autorizadoComoWorker(pedido(header)));
    assert.equal(r.ok, false, `autorizó con "${header}"`);
  }
});

// ---------------------------------------------------------------------------
// El esquema
// ---------------------------------------------------------------------------

test("solo se acepta el esquema Bearer, y con esa capitalización", () => {
  for (const header of [`bearer ${SECRETO}`, `BEARER ${SECRETO}`, `Basic ${SECRETO}`, SECRETO]) {
    const r = con(SECRETO, () => autorizadoComoWorker(pedido(header)));
    assert.equal(r.ok, false, `aceptó "${header.slice(0, 12)}…"`);
  }
});

test("el nombre del encabezado no distingue mayúsculas", () => {
  // Lo resuelve `Headers`, no esta función, pero conviene fijarlo: n8n manda
  // `Authorization` y el ejecutor en proceso también.
  const r = con(SECRETO, () => {
    const req = new Request("https://eos.internal/x", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRETO}` },
    });
    return autorizadoComoWorker(req);
  });
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------------------
// El secreto no se filtra por el largo de lo que se manda
// ---------------------------------------------------------------------------

test("un secreto con acentos se compara por bytes, no por caracteres", () => {
  // `Buffer.from` da más bytes que caracteres. Comparar largos en caracteres
  // habría dejado pasar un token de largo distinto al buffer.
  const conEnies = "señá-ñoño-secreto";
  const r = con(conEnies, () => autorizadoComoWorker(pedido(`Bearer ${conEnies}`)));
  assert.equal(r.ok, true);

  const mismoLargoEnCaracteres = "senia-nono-secret";
  assert.equal(mismoLargoEnCaracteres.length, conEnies.length);
  const r2 = con(conEnies, () => autorizadoComoWorker(pedido(`Bearer ${mismoLargoEnCaracteres}`)));
  assert.equal(r2.ok, false);
});
