import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluarChat, resumirEmbudo, type FilaEmbudo, type SolicitudChat } from "./salud.ts";

const AHORA = Date.parse("2026-09-18T12:00:00Z");
const hace = (dias: number) => new Date(AHORA - dias * 86_400_000).toISOString();

const fila = (extra: Partial<FilaEmbudo> = {}): FilaEmbudo => ({
  acciones_ok: 0,
  activado_v1: false,
  primer_pago: null,
  ultimo_mensaje: null,
  ...extra,
});

test("cuenta cada hito por separado, sin mezclarlos", () => {
  const texto = resumirEmbudo(
    [
      fila({ acciones_ok: 5, activado_v1: true, primer_pago: hace(3), ultimo_mensaje: hace(1) }),
      fila({ acciones_ok: 1, ultimo_mensaje: hace(20) }),
      fila(),
    ],
    AHORA,
  );

  assert.equal(
    texto,
    "3 cuentas reales · 1 activas en 7 días · 2 con una acción exitosa · 1 activadas · 1 con un pago",
  );
});

test("una cuenta que nunca escribió no cuenta como activa en 7 días", () => {
  assert.match(resumirEmbudo([fila({ ultimo_mensaje: null })], AHORA), /0 activas en 7 días/);
});

test("el límite de 7 días es inclusivo, y 8 días ya no cuenta", () => {
  assert.match(resumirEmbudo([fila({ ultimo_mensaje: hace(7) })], AHORA), /1 activas en 7 días/);
  assert.match(resumirEmbudo([fila({ ultimo_mensaje: hace(8) })], AHORA), /0 activas en 7 días/);
});

test("sin cuentas dice cero, no revienta", () => {
  assert.equal(
    resumirEmbudo([], AHORA),
    "0 cuentas reales · 0 activas en 7 días · 0 con una acción exitosa · 0 activadas · 0 con un pago",
  );
});

// ---------------------------------------------------------------------------
// Chat de cuentas reales
// ---------------------------------------------------------------------------

const REAL = "real-1";
const PRUEBA = "certificacion-1";
const reales = new Set([REAL]);

const sol = (extra: Partial<SolicitudChat> & { usuario_id?: string }): SolicitudChat => ({
  usuario_id: REAL,
  status: "consumed",
  release_reason: null,
  expires_at: null,
  ...extra,
});

const respondidas = (n: number) => Array.from({ length: n }, () => sol({}));
const liberadas = (n: number, motivo = "n8n_empty_response") =>
  Array.from({ length: n }, () => sol({ status: "released", release_reason: motivo }));

test("las solicitudes de cuentas de prueba no cuentan, por muchas que fallen", () => {
  const ruido = Array.from({ length: 50 }, () =>
    sol({ usuario_id: PRUEBA, status: "released", release_reason: "reservation_expired" }),
  );

  const r = evaluarChat([...respondidas(10), ...ruido], reales, AHORA);

  assert.equal(r.ok, true);
  assert.match(r.detalle, /10 solicitudes de cuentas reales/);
  assert.match(r.detalle, /0 sin respuesta/);
});

test("alarma con tres sin respuesta que son al menos el 15 %", () => {
  const r = evaluarChat([...respondidas(9), ...liberadas(3)], reales, AHORA);

  assert.equal(r.ok, false);
  assert.match(r.detalle, /3 sin respuesta \(n8n_empty_response: 3\)/);
});

test("una falla suelta entre muchas no despierta a nadie", () => {
  assert.equal(evaluarChat([...respondidas(30), ...liberadas(1)], reales, AHORA).ok, true);
});

test("tres fallas entre muchas respuestas tampoco: la proporción no llega", () => {
  // 3 de 40 = 7,5 %: hay fallas, pero no es un chat caído.
  assert.equal(evaluarChat([...respondidas(37), ...liberadas(3)], reales, AHORA).ok, true);
});

test("dos fallas de dos no alcanzan: falta volumen para llamarlo señal", () => {
  assert.equal(evaluarChat(liberadas(2), reales, AHORA).ok, true);
});

test("una reservada con el plazo vencido es un mensaje que nunca se contestó", () => {
  const colgadas = Array.from({ length: 3 }, () =>
    sol({ status: "reserved", expires_at: new Date(AHORA - 60_000).toISOString() }),
  );

  const r = evaluarChat([...respondidas(5), ...colgadas], reales, AHORA);

  assert.equal(r.ok, false);
  assert.match(r.detalle, /nunca terminó: 3/);
});

test("una reservada con el plazo vigente sigue en curso y no cuenta", () => {
  const enCurso = Array.from({ length: 5 }, () =>
    sol({ status: "reserved", expires_at: new Date(AHORA + 60_000).toISOString() }),
  );

  const r = evaluarChat([...respondidas(4), ...enCurso], reales, AHORA);

  assert.equal(r.ok, true);
  assert.match(r.detalle, /4 solicitudes/);
});

test("sin mensajes reales lo dice, no revienta", () => {
  assert.deepEqual(evaluarChat([], reales, AHORA), {
    ok: true,
    detalle: "sin mensajes de cuentas reales en 24 h",
  });
});

test("el incidente real del 16 de septiembre (6 de 30) tiene que alarmar", () => {
  const r = evaluarChat([...respondidas(24), ...liberadas(6)], reales, AHORA);

  assert.equal(r.ok, false);
});
