import assert from "node:assert/strict";
import test from "node:test";

import type { Job } from "./jobs.ts";
import type { ResultadoWorker } from "./resultados.ts";
import { REEMPLAZO_SIN_ANULAR, VENTANA_REPETIDO_MS, claveDeRepeticion, ejecutarJobs, type Anotada } from "./worker.ts";

/** Sin nada anotado antes: para las pruebas que no son de repetidos. */
const SIN_ANOTADAS = { anotadas: async (): Promise<Anotada[]> => [] };

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
    SIN_ANOTADAS,
  );

  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["ANULAR_VENTA"], "la venta nueva se mandó igual");
  assert.equal(resultados.length, 2, "cada acción pedida tiene su resultado");
  assert.equal(resultados[1].ok, false);
  assert.equal(resultados[1].respuesta, REEMPLAZO_SIN_ANULAR);
});

test("lo mismo con las compras", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs([job("ANULAR_COMPRA", { referencia: "lechones" }), job("REGISTRAR_COMPRA", { items: [] })], null, ejecutar, SIN_ANOTADAS);
  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["ANULAR_COMPRA"]);
});

test("una anulación fallida no frena lo que no la reemplaza", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs(
    [job("ANULAR_VENTA", { referencia: "x" }), job("CREAR_CONTACTO", { nombre: "Sheyla" }), job("REGISTRAR_COMPRA", { items: [] })],
    null,
    ejecutar,
    SIN_ANOTADAS,
  );
  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["ANULAR_VENTA", "CREAR_CONTACTO", "REGISTRAR_COMPRA"]);
});

test("una venta sin anulación previa sigue igual que siempre", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs([job("CREAR_CONTACTO", { nombre: "Sheyla" }), job("REGISTRAR_VENTA", VENTA_SHEYLA)], null, ejecutar, SIN_ANOTADAS);
  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["CREAR_CONTACTO", "REGISTRAR_VENTA"]);
});

// ---------------------------------------------------------------------------
// Lo mismo anotado otra vez (29/09): cinco compras de ₲46.000 con la Green en
// diez minutos, cada vez que la persona dijo "no está".
// ---------------------------------------------------------------------------

const AHORA = Date.parse("2026-09-29T20:37:42Z");
const COMPRA = { total: 46000, tarjeta: "Green", descripcion: "Punto Farma" };

function anotadaHace(minutos: number, datos: Record<string, unknown>, request_id = "33333333-3333-4333-8333-333333333333"): Anotada {
  return { request_id, created_at: new Date(AHORA - minutos * 60_000).toISOString(), datos };
}

test("la misma compra con tarjeta, desde otro mensaje, no se anota dos veces", async () => {
  const { ejecutar, llamadas } = workerFalso();
  const resultados = await ejecutarJobs([job("REGISTRAR_COMPRA_TARJETA", { ...COMPRA, tarjeta: "Green ****7450" })], null, ejecutar, {
    anotadas: async () => [anotadaHace(3, COMPRA)],
    ahora: () => AHORA,
  });
  assert.deepEqual(llamadas, [], "se volvió a mandar una compra ya anotada");
  assert.equal(resultados[0].ok, true, "no es un error: ya está anotada");
  assert.equal(resultados[0].idempotent, true);
  assert.match(String(resultados[0].respuesta), /ya lo anoté hace 3 minutos/);
  assert.match(String(resultados[0].respuesta), /es otra/);
});

test("'es otra igual' (repetir: true) sí se anota", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs([job("REGISTRAR_COMPRA_TARJETA", { ...COMPRA, repetir: true })], null, ejecutar, {
    anotadas: async () => [anotadaHace(3, COMPRA)],
    ahora: () => AHORA,
  });
  assert.equal(llamadas.length, 1);
});

test("otro monto, otra cosa: se anota", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs([job("REGISTRAR_COMPRA_TARJETA", { ...COMPRA, total: 46500 })], null, ejecutar, {
    anotadas: async () => [anotadaHace(3, COMPRA)],
    ahora: () => AHORA,
  });
  assert.equal(llamadas.length, 1);
});

test("el reintento del MISMO mensaje no se frena acá: eso lo resuelve el gate", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs([job("REGISTRAR_COMPRA_TARJETA", COMPRA)], null, ejecutar, {
    anotadas: async () => [anotadaHace(1, COMPRA, REQUEST)],
    ahora: () => AHORA,
  });
  assert.equal(llamadas.length, 1);
});

test("un costo o un contacto no se frenan: repetirlos no duplica nada", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs([job("ACTUALIZAR_PRODUCTO", { productos: [{ nombre: "x", costo: 1 }] })], null, ejecutar, {
    anotadas: async () => [anotadaHace(1, { productos: [{ nombre: "x", costo: 1 }] })],
    ahora: () => AHORA,
  });
  assert.equal(llamadas.length, 1);
});

test("la clave ignora mayúsculas, espacios y el nombre de la tarjeta, pero no el monto", () => {
  const a = claveDeRepeticion("REGISTRAR_COMPRA_TARJETA", { total: 46000, tarjeta: "Green", descripcion: "Punto Farma " });
  const b = claveDeRepeticion("REGISTRAR_COMPRA_TARJETA", { descripcion: "punto farma", tarjeta: "Green ****7450", total: 46000 });
  const c = claveDeRepeticion("REGISTRAR_COMPRA_TARJETA", { total: 46001, tarjeta: "Green", descripcion: "Punto Farma" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(VENTANA_REPETIDO_MS >= 5 * 60_000);
});
