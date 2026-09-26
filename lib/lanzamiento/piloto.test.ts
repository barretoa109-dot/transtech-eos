import assert from "node:assert/strict";
import test from "node:test";

import {
  PYG_POR_USD_POR_DEFECTO,
  UMBRAL_COSTO_PYG,
  evaluarCuenta,
  fecha,
  lineaDeConsumo,
} from "../../scripts/lib/piloto.mjs";
import * as umbral from "../monitoreo/umbral-costo.ts";

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

test("el umbral de consumo del informe es el mismo que el del aviso", () => {
  assert.equal(UMBRAL_COSTO_PYG, umbral.UMBRAL_COSTO_PYG);
  assert.equal(PYG_POR_USD_POR_DEFECTO, umbral.PYG_POR_USD_POR_DEFECTO);
});

test("el consumo del mes se lee en guaraníes y avisa al pasar los Gs. 70.000", () => {
  assert.equal(lineaDeConsumo(5, 150), "consumo del mes: Gs. 40.000 (USD 5, 150 mensajes)");
  assert.equal(
    lineaDeConsumo(9.1, 180),
    "consumo del mes: Gs. 72.800 (USD 9.1, 180 mensajes) — pasó los Gs. 70.000: revisar",
  );
  assert.equal(lineaDeConsumo(0, 200), "consumo del mes: sin costo registrado (200 mensajes)");
  assert.equal(lineaDeConsumo(null, null), "consumo del mes: sin costo registrado (0 mensajes)");
});
