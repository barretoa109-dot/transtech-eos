import assert from "node:assert/strict";
import test from "node:test";

import { evaluarCuenta, fecha } from "../../scripts/lib/piloto.mjs";

const AHORA = Date.parse("2026-09-24T20:00:00Z");
const hace = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();

test("más de 24 h sin ninguna acción útil: INTERVENIR", () => {
  const r = evaluarCuenta({ registro: hace(50), primera_accion_ok: null, ultimo_mensaje: hace(49) }, AHORA);
  assert.equal(r.estado, "INTERVENIR");
  assert.equal(r.nivel, 3);
  assert.match(r.motivo, /2 días/);
});

test("recién registrada: todavía no se interviene", () => {
  assert.equal(evaluarCuenta({ registro: hace(3), primera_accion_ok: null }, AHORA).estado, "nueva");
});

test("más errores que aciertos en la semana: REVISAR", () => {
  const r = evaluarCuenta(
    { registro: hace(200), primera_accion_ok: hace(190), ultimo_mensaje: hace(2), acciones_ok_7d: 1, acciones_error_7d: 3 },
    AHORA,
  );
  assert.equal(r.estado, "REVISAR");
});

test("usaba y dejó de escribir: SE ENFRIÓ", () => {
  const r = evaluarCuenta(
    { registro: hace(400), primera_accion_ok: hace(390), ultimo_mensaje: hace(24 * 5), acciones_ok_7d: 0 },
    AHORA,
  );
  assert.equal(r.estado, "SE ENFRIÓ");
  assert.match(r.motivo, /5 días/);
});

test("activa y sin problemas: ok", () => {
  const r = evaluarCuenta(
    { registro: hace(400), primera_accion_ok: hace(390), ultimo_mensaje: hace(5), acciones_ok_7d: 12, acciones_error_7d: 1 },
    AHORA,
  );
  assert.equal(r.estado, "ok");
});

test("las fechas sin zona de Postgres se leen como UTC", () => {
  assert.equal(fecha("2026-09-24 20:00:00.123"), Date.parse("2026-09-24T20:00:00.123Z"));
  assert.equal(fecha("2026-09-24T20:00:00+00:00"), AHORA);
  assert.equal(fecha(null), null);
});
