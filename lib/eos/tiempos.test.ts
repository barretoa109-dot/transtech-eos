import test from "node:test";
import assert from "node:assert/strict";

import { guardarTiempos, tiemposDelTurno } from "./tiempos.ts";

test("junta las marcas con lo que midió el gateway", () => {
  const t = tiemposDelTurno(
    { contexto: 412.4, cupo: 690, respuesta: 5230, cierre: 5400, fin: 5480 },
    { gateway: "ts", modelo_ms: 3100, worker_ms: 1250 },
  );
  assert.deepEqual(t, {
    contexto: 412,
    cupo: 690,
    respuesta: 5230,
    cierre: 5400,
    fin: 5480,
    modelo: 3100,
    acciones: 1250,
    gateway: "ts",
  });
});

test("sin metadata del gateway, es n8n y no inventa etapas", () => {
  assert.deepEqual(tiemposDelTurno({ contexto: 300 }, null), { contexto: 300, gateway: "n8n" });
});

test("guarda solo_memoria y cómo terminó cada acción, acotado", () => {
  const muchas = Array.from({ length: 30 }, (_, i) => `ACCION_${i}:confirmada`);
  const t = tiemposDelTurno({}, { gateway: "ts" }, { soloMemoria: true, verificacion: muchas });
  assert.equal(t.solo_memoria, true);
  assert.equal(t.verificacion?.length, 20);
  assert.deepEqual(tiemposDelTurno({}, null, { soloMemoria: false, verificacion: [] }), { gateway: "n8n" });
});

test("descarta lo que no es un número razonable", () => {
  const t = tiemposDelTurno({ contexto: Number.NaN, cupo: -5 }, { modelo_ms: "3100", worker_ms: Infinity });
  assert.deepEqual(t, { gateway: "n8n" });
});

test("guardarTiempos filtra por usuario y request, y no lanza si la base falla", async () => {
  const llamadas: unknown[] = [];
  const admin = {
    from: (tabla: string) => ({
      update: (valores: Record<string, unknown>) => ({
        eq: (c1: string, v1: string) => ({
          eq: async (c2: string, v2: string) => {
            llamadas.push({ tabla, valores, filtros: [c1, v1, c2, v2] });
            return { error: { message: "caída" } };
          },
        }),
      }),
    }),
  };
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    await guardarTiempos(admin, "u1", "r1", { contexto: 1, gateway: "ts" });
  } finally {
    console.error = errorOriginal;
  }
  assert.deepEqual(llamadas, [
    {
      tabla: "eos_message_usage_v40",
      valores: { turno: { contexto: 1, gateway: "ts" } },
      filtros: ["usuario_id", "u1", "request_id", "r1"],
    },
  ]);
});

test("guarda los tokens del turno y lo que tardó cada puerta de cada acción", () => {
  const t = tiemposDelTurno(
    {},
    {
      gateway: "ts",
      tokens_razonamiento: 412,
      acciones_ms: [
        { accion: "REGISTRAR_VENTA", autorizar: 380.4, efecto: 2210 },
        { accion: "ANULAR_VENTA", autorizar: -1, efecto: "x" },
      ],
    },
    { tokens: { entrada: 9100, cacheada: 7800, salida: 240 } },
  );
  assert.deepEqual(t.tokens, { entrada: 9100, cacheada: 7800, salida: 240, razonamiento: 412 });
  assert.deepEqual(t.pasos, [
    { accion: "REGISTRAR_VENTA", autorizar: 380, efecto: 2210 },
    { accion: "ANULAR_VENTA" },
  ]);
});

test("sin tokens ni acciones, no inventa esos campos", () => {
  const t = tiemposDelTurno({}, { gateway: "directa" }, { tokens: { entrada: 0, salida: 0 } });
  assert.equal(t.tokens, undefined);
  assert.equal(t.pasos, undefined);
});
