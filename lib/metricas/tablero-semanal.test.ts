import test from "node:test";
import assert from "node:assert/strict";

import {
  enviarTableroDeLosViernes,
  esViernes,
  filasDelTablero,
  leerFila,
  porcentaje,
  redactarTablero,
  type Semana,
} from "./tablero-semanal.ts";

const base: Semana = leerFila({
  desde: "2026-09-22T17:00:00Z",
  hasta: "2026-09-29T17:00:00Z",
  reales: 6,
  nuevas: 1,
  cohorte_24h: 2,
  activadas_24h: 1,
  activas: 1,
  acciones_ok: 16,
  acciones_error: 1,
  pagando: 0,
  base_30d: 2,
  retenidas_30d: 1,
  mensajes: 49,
  mensajes_whatsapp: 39,
  latencia_p50_ms: 6095,
  latencia_p90_ms: 13058,
});

test("porcentaje sin base es null, no cero", () => {
  assert.equal(porcentaje(0, 0), null);
  assert.equal(porcentaje(1, 17), 6);
});

test("leerFila tolera nulos y textos numéricos", () => {
  const s = leerFila({ reales: "3", latencia_p50_ms: null });
  assert.equal(s.reales, 3);
  assert.equal(s.latencia_p50_ms, null);
  assert.equal(s.activas, 0);
});

test("marca como alerta lo que está del lado malo de la meta", () => {
  const filas = filasDelTablero(base, base);
  const alerta = Object.fromEntries(filas.map((f) => [f.nombre, f.alerta]));
  assert.equal(alerta["Error del circuito"], true, "6 % es más que 2 %");
  assert.equal(alerta["Siguen a los 30 días"], true, "50 % es menos que 60 %");
  assert.equal(alerta["Respuesta del servidor (mediana)"], false, "6,1 s está bajo 8 s");
  assert.equal(filas.find((f) => f.nombre === "Error del circuito")?.valor, "6 % (1 de 17)");
});

test("sin cuentas para medir no inventa porcentajes", () => {
  const vacia = leerFila({});
  const filas = filasDelTablero(vacia, vacia);
  assert.equal(filas.find((f) => f.nombre === "Activadas en 24 horas")?.valor, "sin cuentas para medir");
  assert.ok(filas.every((f) => !f.alerta));
});

test("el correo no lleva nada que no sea un número, y escapa el HTML", () => {
  const { asunto, html, texto } = redactarTablero(base, base, "2026-10-02");
  assert.match(asunto, /tablero del viernes 2026-10-02 · 2 para mirar/);
  assert.match(texto, /Error del circuito: 6 % \(1 de 17\)/);
  assert.ok(!html.includes("<script"));
});

test("el viernes se decide con la fecha de Paraguay", () => {
  assert.equal(esViernes("2026-10-02"), true);
  assert.equal(esViernes("2026-10-01"), false);
});

test("solo manda los viernes, y compara con la semana anterior", async () => {
  const pedidos: string[] = [];
  const admin = {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      pedidos.push(String(args.p_hasta));
      return { data: base, error: null };
    },
  };
  const enviados: string[] = [];
  const enviar = async (c: { asunto: string }) => {
    enviados.push(c.asunto);
  };

  assert.equal(await enviarTableroDeLosViernes(admin, { hoyPY: "2026-10-01", destinos: ["a@b.c"], enviar }), false);
  assert.equal(enviados.length, 0);

  const ahora = new Date("2026-10-02T11:00:00Z");
  assert.equal(await enviarTableroDeLosViernes(admin, { hoyPY: "2026-10-02", ahora, destinos: ["a@b.c"], enviar }), true);
  assert.equal(enviados.length, 1);
  assert.deepEqual(pedidos, ["2026-10-02T11:00:00.000Z", "2026-09-25T11:00:00.000Z"]);
});
