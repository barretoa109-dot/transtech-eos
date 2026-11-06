import assert from "node:assert/strict";
import { test } from "node:test";

import { trazarBanda, trazarTrayectoria } from "./trayectoria.ts";
import { detectarRiesgo } from "./riesgo.ts";
import type { MovimientoProyectado } from "./recurrencia.ts";

function mov(fecha: string, monto: number, descripcion = "Movimiento", confianza = 0.9): MovimientoProyectado {
  // El `tipo` no lo mira ni la trayectoria ni el detector: el signo lo decide
  // en qué lista viene el movimiento, egresos o ingresos.
  return { tipo: "gasto", fecha, monto, descripcion, periodicidad: "mensual", confianza };
}

const BASE = {
  hoy: "2026-08-25",
  hasta: "2026-09-08",
  saldoActual: 3_000_000,
  reservaMinima: 1_000_000,
};

test("hay un punto por día, incluidos los días en que no pasa nada", () => {
  // Sin los días vacíos, la curva comprime el tiempo y un gasto del día 30 se
  // dibuja pegado a hoy.
  const t = trazarTrayectoria({ ...BASE, egresos: [], ingresos: [] });

  assert.equal(t.puntos.length, 15);
  assert.equal(t.puntos[0].fecha, "2026-08-25");
  assert.equal(t.puntos.at(-1)?.fecha, "2026-09-08");
});

test("sin movimientos, la línea queda plana en el saldo actual", () => {
  const t = trazarTrayectoria({ ...BASE, egresos: [], ingresos: [] });

  assert.ok(t.puntos.every((p) => p.saldo === 3_000_000));
  assert.equal(t.cruce, null);
});

test("aplica egresos e ingresos en la fecha que les toca", () => {
  const t = trazarTrayectoria({
    ...BASE,
    egresos: [mov("2026-08-28", 2_500_000, "Alquiler")],
    ingresos: [mov("2026-09-01", 4_000_000, "Sueldo")],
  });

  const buscar = (f: string) => t.puntos.find((p) => p.fecha === f);

  assert.equal(buscar("2026-08-27")?.saldo, 3_000_000);
  assert.equal(buscar("2026-08-28")?.saldo, 500_000);
  assert.equal(buscar("2026-08-31")?.saldo, 500_000);
  assert.equal(buscar("2026-09-01")?.saldo, 4_500_000);
});

test("el día del cruce coincide EXACTAMENTE con el que avisa detectarRiesgo", () => {
  // Este test es el que ata las dos funciones. Si el gráfico y la alerta se
  // separan, el producto se contradice a sí mismo en la misma pantalla.
  const egresos = [mov("2026-08-28", 2_500_000, "Alquiler"), mov("2026-09-03", 900_000, "Cuota")];
  const ingresos = [mov("2026-09-01", 4_000_000, "Sueldo")];

  const t = trazarTrayectoria({ ...BASE, egresos, ingresos });
  const riesgo = detectarRiesgo({ ...BASE, egresos, ingresos });

  assert.equal(t.cruce, riesgo?.fecha);
});

test("cuando no hay riesgo, tampoco hay cruce", () => {
  const egresos = [mov("2026-08-28", 500_000, "Servicios")];
  const ingresos: MovimientoProyectado[] = [];

  const t = trazarTrayectoria({ ...BASE, egresos, ingresos });
  const riesgo = detectarRiesgo({ ...BASE, egresos, ingresos });

  assert.equal(riesgo, null);
  assert.equal(t.cruce, null);
});

test("dentro del mismo día, el egreso se aplica antes que el ingreso", () => {
  // Si el sueldo entra el mismo día que se debita la cuota, no se puede dar
  // por sentado que la acreditación llegue primero. El piso lo registra.
  const t = trazarTrayectoria({
    ...BASE,
    saldoActual: 1_200_000,
    egresos: [mov("2026-08-28", 1_000_000, "Cuota")],
    ingresos: [mov("2026-08-28", 5_000_000, "Sueldo")],
  });

  const dia = t.puntos.find((p) => p.fecha === "2026-08-28");

  assert.equal(dia?.piso, 200_000);
  assert.equal(dia?.saldo, 5_200_000);
  assert.equal(t.cruce, "2026-08-28");
});

test("el valle mide el peor momento, no el peor cierre", () => {
  const t = trazarTrayectoria({
    ...BASE,
    saldoActual: 1_200_000,
    egresos: [mov("2026-08-28", 1_000_000, "Cuota")],
    ingresos: [mov("2026-08-28", 5_000_000, "Sueldo")],
  });

  assert.equal(t.valle.fecha, "2026-08-28");
  assert.equal(t.valle.saldo, 200_000);
});

test("cada punto dice qué pasó ese día", () => {
  const t = trazarTrayectoria({
    ...BASE,
    egresos: [mov("2026-08-28", 2_500_000, "Alquiler")],
    ingresos: [mov("2026-08-28", 100_000, "Reintegro")],
  });

  const dia = t.puntos.find((p) => p.fecha === "2026-08-28");

  assert.equal(dia?.eventos.length, 2);
  assert.deepEqual(
    dia?.eventos.map((e) => e.tipo),
    ["egreso", "ingreso"],
  );
  assert.equal(dia?.eventos[0].descripcion, "Alquiler");
});

test("ignora lo que cae fuera de la ventana", () => {
  // Un gasto de dentro de tres meses no puede achatar la escala del gráfico.
  const t = trazarTrayectoria({
    ...BASE,
    egresos: [mov("2026-08-20", 900_000, "Ya pasó"), mov("2026-12-01", 9_000_000, "Muy lejos")],
    ingresos: [],
  });

  assert.ok(t.puntos.every((p) => p.saldo === 3_000_000));
});

test("un saldo que ya arranca bajo la reserva se marca desde el día uno", () => {
  const t = trazarTrayectoria({
    ...BASE,
    saldoActual: 400_000,
    egresos: [],
    ingresos: [],
  });

  assert.equal(t.cruce, "2026-08-25");
  assert.equal(t.valle.saldo, 400_000);
});

test("banda: con todo certero, las tres líneas coinciden", () => {
  const egresos = [mov("2026-08-28", 500_000, "Alquiler", 1)];
  const ingresos = [mov("2026-09-01", 4_000_000, "Sueldo", 1)];

  const b = trazarBanda({ ...BASE, egresos, ingresos });

  assert.deepEqual(b.esperado.puntos, b.piso.puntos);
  assert.deepEqual(b.esperado.puntos, b.techo.puntos);
});

test("banda: el piso descarta el ingreso incierto, no el gasto", () => {
  const egresos = [mov("2026-08-28", 500_000, "Servicios", 1)];
  const ingresos = [mov("2026-08-30", 2_000_000, "Changa que suele caer", 0.6)];

  const b = trazarBanda({ ...BASE, egresos, ingresos });

  const esperado = b.esperado.puntos.find((p) => p.fecha === "2026-08-30");
  const piso = b.piso.puntos.find((p) => p.fecha === "2026-08-30");
  const techo = b.techo.puntos.find((p) => p.fecha === "2026-08-30");

  // Esperado y techo SÍ cuentan la changa; el piso, no.
  assert.equal(esperado?.saldo, 4_500_000);
  assert.equal(techo?.saldo, 4_500_000);
  assert.equal(piso?.saldo, 2_500_000);
});

test("banda: el techo descarta el gasto incierto, no el ingreso", () => {
  const egresos = [mov("2026-08-28", 700_000, "Changa de gasto que no siempre pasa", 0.6)];
  const ingresos = [mov("2026-08-30", 1_000_000, "Sueldo declarado", 1)];

  const b = trazarBanda({ ...BASE, egresos, ingresos });

  const esperado = b.esperado.puntos.find((p) => p.fecha === "2026-08-30");
  const piso = b.piso.puntos.find((p) => p.fecha === "2026-08-30");
  const techo = b.techo.puntos.find((p) => p.fecha === "2026-08-30");

  // Esperado y piso SÍ cuentan el gasto incierto; el techo lo descarta.
  assert.equal(esperado?.saldo, 3_300_000);
  assert.equal(piso?.saldo, 3_300_000);
  assert.equal(techo?.saldo, 4_000_000);
});

test("banda: piso ≤ esperado ≤ techo en cada día, siempre", () => {
  const egresos = [
    mov("2026-08-27", 400_000, "Fijo", 1),
    mov("2026-08-29", 600_000, "Patrón detectado", 0.7),
  ];
  const ingresos = [
    mov("2026-08-28", 900_000, "Declarado", 1),
    mov("2026-09-02", 1_500_000, "Changa detectada", 0.6),
  ];

  const b = trazarBanda({ ...BASE, egresos, ingresos });

  for (let i = 0; i < b.esperado.puntos.length; i += 1) {
    assert.ok(b.piso.puntos[i].saldo <= b.esperado.puntos[i].saldo, `día ${b.esperado.puntos[i].fecha}: piso > esperado`);
    assert.ok(b.esperado.puntos[i].saldo <= b.techo.puntos[i].saldo, `día ${b.esperado.puntos[i].fecha}: esperado > techo`);
  }
});
