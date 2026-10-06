import assert from "node:assert/strict";
import test from "node:test";

import { estadoDelFijo, periodoAnterior, proximoVencimientoSinPagar, vencimientoEn } from "./estado-fijo.ts";

const pago = (periodo: string) => ({ periodo, fecha: periodo.slice(0, 8) + "04", monto: 100, movimiento_id: "m" });

test("el día 31 cae en el último día de un mes corto", () => {
  assert.equal(vencimientoEn("2026-02-01", 31), "2026-02-28");
  assert.equal(vencimientoEn("2028-02-01", 31), "2028-02-29");
  assert.equal(vencimientoEn("2026-10-01", 10), "2026-10-10");
});

test("periodoAnterior cruza el año en las dos direcciones", () => {
  assert.equal(periodoAnterior("2026-01-01"), "2025-12-01");
  assert.equal(periodoAnterior("2026-12-01", -1), "2027-01-01");
  assert.equal(periodoAnterior("2026-10-01", 2), "2026-08-01");
});

test("concepto, vencimiento y pago son tres estados distintos", () => {
  const hoy = "2026-10-05";
  assert.equal(estadoDelFijo({ dia_del_mes: 25, pagos: [], hoy }).estado, "proximo");
  assert.equal(estadoDelFijo({ dia_del_mes: 10, pagos: [], hoy }).estado, "pendiente");
  assert.equal(estadoDelFijo({ dia_del_mes: 3, pagos: [], hoy }).estado, "vencido");
  const pagado = estadoDelFijo({ dia_del_mes: 3, pagos: [pago("2026-10-01")], hoy });
  assert.equal(pagado.estado, "registrado");
  assert.equal(pagado.pago?.periodo, "2026-10-01");
});

test("los meses viejos sin pago atado no se dan por vencidos", () => {
  const e = estadoDelFijo({ dia_del_mes: 3, pagos: [pago("2026-08-01")], hoy: "2026-10-05" });
  assert.deepEqual(
    e.historial.map((h) => h.marca),
    ["pagado", "sin_registro", "vencido"],
  );
});

test("lo pagado por adelantado no vuelve a contarse este mes", () => {
  const hoy = "2026-10-05";
  assert.equal(proximoVencimientoSinPagar({ dia_del_mes: 10, pagado_hasta: null, hoy }), "2026-10-10");
  assert.equal(proximoVencimientoSinPagar({ dia_del_mes: 10, pagado_hasta: "2026-10-01", hoy }), "2026-11-10");
  assert.equal(proximoVencimientoSinPagar({ dia_del_mes: 3, pagado_hasta: null, hoy }), "2026-11-03");
  assert.equal(proximoVencimientoSinPagar({ dia_del_mes: 10, pagado_hasta: "2026-11-01", hoy }), "2026-12-10");
});
