import assert from "node:assert/strict";
import test from "node:test";

import type { Job } from "./jobs.ts";
import type { ResultadoWorker } from "./resultados.ts";
import { REEMPLAZO_SIN_ANULAR, ejecutarJobs, hayParecido } from "./worker.ts";

/**
 * Las dos fallas de ejecución de la tarde de Sofía (29/09/2026), con los
 * payloads que quedaron en `eos_action_commands`.
 */

const REQUEST = "11111111-1111-4111-8111-111111111111";

function job(tipo: string, datos: Record<string, unknown>, request_id = REQUEST): Job {
  return {
    request_id,
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

/** Un worker de mentira: la venta falla hasta que Sheyla está agendada. */
function workerFalso() {
  const agendados = new Set<string>();
  const llamadas: Job[] = [];
  const ejecutar = async (j: Job): Promise<ResultadoWorker> => {
    llamadas.push(j);
    const datos = j.accion.datos as Record<string, unknown>;
    if (j.accion.tipo === "CREAR_CONTACTO") {
      agendados.add(String(datos.nombre));
      return { ok: true, executed: true, accion: "CREAR_CONTACTO", estado: "completada", respuesta: "El contacto quedó guardado." };
    }
    if (j.accion.tipo === "REGISTRAR_VENTA" && !agendados.has(String(datos.contacto))) {
      return {
        ok: false,
        executed: false,
        accion: "REGISTRAR_VENTA",
        estado: "error",
        codigo: "EOS_ACCION_CONTACTO_NO_RESUELTO",
        respuesta: `No encontré a "${datos.contacto}" entre tus contactos.`,
      };
    }
    if (j.accion.tipo === "ANULAR_VENTA") {
      return { ok: false, accion: "ANULAR_VENTA", estado: "error", codigo: "EOS_ACCION_VENTA_NO_ENCONTRADA", respuesta: "No encontré ninguna venta." };
    }
    return { ok: true, executed: true, accion: j.accion.tipo, estado: "completada", respuesta: "La venta quedó registrada." };
  };
  return { ejecutar, llamadas };
}

test("venta a un cliente nuevo: se agenda y la venta se registra en el mismo paso", async () => {
  const { ejecutar, llamadas } = workerFalso();
  const resultados = await ejecutarJobs([job("REGISTRAR_VENTA", VENTA_SHEYLA)], null, {
    ejecutar,
    contactos: async () => ["Gladys Velilla", "Rossana Giménez"],
  });

  assert.deepEqual(
    llamadas.map((j) => j.accion.tipo),
    ["REGISTRAR_VENTA", "CREAR_CONTACTO", "REGISTRAR_VENTA"],
  );
  assert.deepEqual(
    resultados.map((r) => [r.accion, r.ok]),
    [
      ["CREAR_CONTACTO", true],
      ["REGISTRAR_VENTA", true],
    ],
    "la falla original no tiene que quedar en la respuesta: la venta sí se registró",
  );
  assert.equal(resultados[0].respuesta, "Agendé a Sheyla como cliente.");

  // Ids distintos de la orden que falló, y determinísticos: un reintento del
  // mismo mensaje los vuelve a derivar iguales.
  const ids = llamadas.map((j) => j.request_id);
  assert.equal(new Set(ids).size, 3);
  const otra = workerFalso();
  await ejecutarJobs([job("REGISTRAR_VENTA", VENTA_SHEYLA)], null, { ejecutar: otra.ejecutar, contactos: async () => [] });
  assert.deepEqual(otra.llamadas.map((j) => j.request_id), ids);

  // El contacto va como cliente y con el nombre que dijo la persona.
  assert.equal((llamadas[1].accion.datos as Record<string, unknown>).nombre, "Sheyla");
});

test("si ya hay alguien parecido, no se agenda otro: la pregunta de siempre", async () => {
  const { ejecutar, llamadas } = workerFalso();
  const resultados = await ejecutarJobs([job("REGISTRAR_VENTA", { ...VENTA_SHEYLA, contacto: "María" })], null, {
    ejecutar,
    contactos: async () => ["María López", "María Benítez"],
  });
  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["REGISTRAR_VENTA"]);
  assert.equal(resultados[0].ok, false);
});

test("si no se pudieron leer los contactos, tampoco se agenda a ciegas", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs([job("REGISTRAR_VENTA", VENTA_SHEYLA)], null, { ejecutar, contactos: async () => null });
  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["REGISTRAR_VENTA"]);
});

test("anular falla y la venta de reemplazo NO se registra: no queda duplicada", async () => {
  const { ejecutar, llamadas } = workerFalso();
  const resultados = await ejecutarJobs(
    [
      job("ANULAR_VENTA", { referencia: "Sheyla Paleta Makeup by Mario", motivo: "envío mal aplicado" }),
      job("REGISTRAR_VENTA", { ...VENTA_SHEYLA, contacto: "Sheyla" }),
    ],
    null,
    { ejecutar, contactos: async () => [] },
  );

  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["ANULAR_VENTA"], "la venta nueva se mandó igual");
  assert.equal(resultados[1].ok, false);
  assert.equal(resultados[1].respuesta, REEMPLAZO_SIN_ANULAR);
});

test("una venta sin anulación previa sigue igual que siempre", async () => {
  const { ejecutar, llamadas } = workerFalso();
  await ejecutarJobs([job("CREAR_CONTACTO", { nombre: "Sheyla" }), job("REGISTRAR_VENTA", VENTA_SHEYLA)], null, {
    ejecutar,
    contactos: async () => [],
  });
  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["CREAR_CONTACTO", "REGISTRAR_VENTA"]);
});

test("hayParecido: una palabra en común alcanza para no agendar otro", () => {
  assert.equal(hayParecido("Sheyla", ["Gladys Velilla"]), false);
  assert.equal(hayParecido("Sheyla", ["sheyla gomez"]), true);
  assert.equal(hayParecido("Gladys", ["Gladys Velilla"]), true);
  assert.equal(hayParecido("Ña Rosa", ["Rosa Benítez"]), true);
  assert.equal(hayParecido("Joaquín", ["Joaquin Pérez"]), true, "sin tildes");
});
