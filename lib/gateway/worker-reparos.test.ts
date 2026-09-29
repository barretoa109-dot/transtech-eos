import assert from "node:assert/strict";
import test from "node:test";

import type { Job } from "./jobs.ts";
import type { ResultadoWorker } from "./resultados.ts";
import { REEMPLAZO_SIN_ANULAR, ejecutarJobs } from "./worker.ts";

/**
 * La venta duplicada de la tarde de Sofía (29/09/2026), con los payloads que
 * quedaron en `eos_action_commands`: ANULAR_VENTA falló por no encontrar la
 * venta y el REGISTRAR_VENTA que la reemplazaba se ejecutó igual.
 */

const REQUEST = "11111111-1111-4111-8111-111111111111";

function job(tipo: string, datos: Record<string, unknown>): Job {
  return {
    request_id: REQUEST,
    usuario_id: "22222222-2222-4222-8222-222222222222",
    accion: { tipo, datos },
    worker_path: "eos-worker-rc1-internal",
  } as unknown as Job;
}

const VENTA_SHEYLA = {
  items: [{ cantidad: 1, producto: "Paleta Makeup by Mario", costo_unitario: 382662, precio_unitario: 465000 }],
  contacto: "Sheyla",
  condicion: "contado",
};

/** Un worker de mentira donde toda anulación falla y todo lo demás sale bien. */
function workerFalso() {
  const llamadas: Job[] = [];
  const ejecutar = async (j: Job): Promise<ResultadoWorker> => {
    llamadas.push(j);
    if (j.accion.tipo.startsWith("ANULAR_")) {
      return { ok: false, accion: j.accion.tipo, estado: "error", respuesta: "No encontré ninguna venta." };
    }
    return { ok: true, executed: true, accion: j.accion.tipo, estado: "completada", respuesta: "La venta quedó registrada." };
  };
  return { ejecutar, llamadas };
}

test("anular falla y la venta de reemplazo NO se registra: no queda duplicada", async () => {
  const { ejecutar, llamadas } = workerFalso();
  const resultados = await ejecutarJobs(
    [
      job("ANULAR_VENTA", { referencia: "Sheyla Paleta Makeup by Mario", motivo: "envío mal aplicado" }),
      job("REGISTRAR_VENTA", VENTA_SHEYLA),
    ],
    null,
    ejecutar,
  );

  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["ANULAR_VENTA"], "la venta nueva se mandó igual");
  assert.equal(resultados.length, 2, "cada acción pedida tiene su resultado");
  assert.equal(resultados[1].ok, false);
  assert.equal(resultados[1].respuesta, REEMPLAZO_SIN_ANULAR);
});

test("lo mismo con las compras", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs([job("ANULAR_COMPRA", { referencia: "lechones" }), job("REGISTRAR_COMPRA", { items: [] })], null, ejecutar);
  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["ANULAR_COMPRA"]);
});

test("una anulación fallida no frena lo que no la reemplaza", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs(
    [job("ANULAR_VENTA", { referencia: "x" }), job("CREAR_CONTACTO", { nombre: "Sheyla" }), job("REGISTRAR_COMPRA", { items: [] })],
    null,
    ejecutar,
  );
  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["ANULAR_VENTA", "CREAR_CONTACTO", "REGISTRAR_COMPRA"]);
});

test("una venta sin anulación previa sigue igual que siempre", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs([job("CREAR_CONTACTO", { nombre: "Sheyla" }), job("REGISTRAR_VENTA", VENTA_SHEYLA)], null, ejecutar);
  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["CREAR_CONTACTO", "REGISTRAR_VENTA"]);
});
