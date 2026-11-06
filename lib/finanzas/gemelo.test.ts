import assert from "node:assert/strict";
import { test } from "node:test";

import { compararTrayectorias, ocurrenciasMensuales } from "./gemelo.ts";
import type { MovimientoProyectado } from "./recurrencia.ts";

const BASE = {
  hoy: "2026-11-06",
  hasta: "2026-12-20",
  saldoActual: 1_000_000,
  reservaMinima: 200_000,
  egresos: [] as MovimientoProyectado[],
  ingresos: [] as MovimientoProyectado[],
};

test("compararTrayectorias: sin cambio hipotético, las dos curvas son la misma", () => {
  const gemelo = compararTrayectorias({ ...BASE, egresosHipotetica: BASE.egresos, ingresosHipotetica: BASE.ingresos });
  assert.deepEqual(gemelo.actual, gemelo.hipotetica);
  assert.equal(gemelo.diferencia_al_cierre, 0);
  assert.equal(gemelo.empeora_el_riesgo, false);
  assert.equal(gemelo.mejora_el_riesgo, false);
});

test("compararTrayectorias: una cuota nueva baja el cierre exactamente lo que suma la cuota", () => {
  const cuota = ocurrenciasMensuales({
    tipo: "gasto",
    descripcion: "Cuota notebook",
    monto: 300_000,
    diaDelMes: 10,
    desde: BASE.hoy,
    hasta: BASE.hasta,
  });
  assert.equal(cuota.length, 2); // 10 de noviembre y 10 de diciembre, dentro del horizonte

  const gemelo = compararTrayectorias({
    ...BASE,
    egresosHipotetica: [...BASE.egresos, ...cuota],
    ingresosHipotetica: BASE.ingresos,
  });
  assert.equal(gemelo.diferencia_al_cierre, -600_000);
});

test("compararTrayectorias: una cuota nueva puede hacer que la curva perfore la reserva", () => {
  const cuota = ocurrenciasMensuales({
    tipo: "gasto",
    descripcion: "Cuota grande",
    monto: 900_000,
    diaDelMes: 10,
    desde: BASE.hoy,
    hasta: BASE.hasta,
  });

  const gemelo = compararTrayectorias({
    ...BASE,
    egresosHipotetica: [...BASE.egresos, ...cuota],
    ingresosHipotetica: BASE.ingresos,
  });
  assert.equal(gemelo.actual.cruce, null);
  assert.notEqual(gemelo.hipotetica.cruce, null);
  assert.equal(gemelo.empeora_el_riesgo, true);
  assert.equal(gemelo.mejora_el_riesgo, false);
});

test("compararTrayectorias: sacar un gasto fijo de la lista hipotética puede evitar un cruce", () => {
  const alquiler: MovimientoProyectado = {
    tipo: "gasto",
    descripcion: "Alquiler",
    monto: 950_000,
    fecha: "2026-11-15",
    periodicidad: "mensual",
    confianza: 1,
  };

  const conRiesgo = { ...BASE, egresos: [alquiler], saldoActual: 1_000_000 };
  const gemeloSinCambio = compararTrayectorias({
    ...conRiesgo,
    egresosHipotetica: conRiesgo.egresos,
    ingresosHipotetica: conRiesgo.ingresos,
  });
  assert.notEqual(gemeloSinCambio.actual.cruce, null);

  // La baja se simula sacando la ocurrencia futura de la lista, no agregando
  // un ingreso que la cancele: ver el comentario de cabecera del módulo.
  const gemelo = compararTrayectorias({ ...conRiesgo, egresosHipotetica: [], ingresosHipotetica: conRiesgo.ingresos });

  assert.equal(gemelo.hipotetica.cruce, null);
  assert.equal(gemelo.mejora_el_riesgo, true);
});

test("ocurrenciasMensuales: cae un día del mes que algunos meses no tienen", () => {
  const ocurrencias = ocurrenciasMensuales({
    tipo: "gasto",
    descripcion: "Cuota fin de mes",
    monto: 100_000,
    diaDelMes: 31,
    desde: "2027-01-15",
    hasta: "2027-03-01",
  });

  // Enero no llega al 31 desde el 15... sí llega (31 de enero existe). El
  // caso interesante es febrero, que nunca tiene 31: cae el 28.
  assert.deepEqual(
    ocurrencias.map((o) => o.fecha),
    ["2027-01-31", "2027-02-28"],
  );
});

test("ocurrenciasMensuales: si el mes de 'desde' ya pasó ese día, arranca el que viene", () => {
  const ocurrencias = ocurrenciasMensuales({
    tipo: "ingreso",
    descripcion: "Algo",
    monto: 50_000,
    diaDelMes: 5,
    desde: "2027-01-10",
    hasta: "2027-02-10",
  });

  assert.deepEqual(
    ocurrencias.map((o) => o.fecha),
    ["2027-02-05"],
  );
});

test("ocurrenciasMensuales: monto cero o negativo no genera nada", () => {
  assert.deepEqual(
    ocurrenciasMensuales({ tipo: "gasto", descripcion: "x", monto: 0, diaDelMes: 5, desde: "2027-01-01", hasta: "2027-03-01" }),
    [],
  );
});

test("ocurrenciasMensuales: cada ocurrencia lleva confianza total, es un compromiso declarado", () => {
  const [primera] = ocurrenciasMensuales({
    tipo: "gasto",
    descripcion: "Cuota",
    monto: 100_000,
    diaDelMes: 1,
    desde: "2027-01-01",
    hasta: "2027-01-31",
  });
  assert.equal(primera.confianza, 1);
});
