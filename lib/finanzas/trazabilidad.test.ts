import assert from "node:assert/strict";
import test from "node:test";

import { noCuadran, trazarPanel, type Trazado } from "./trazabilidad.ts";
import { armarPanorama } from "./panorama.ts";

function panelDeEjemplo() {
  const panorama = armarPanorama({
    hoy: "2026-08-31",
    hasta: "2026-11-29",
    saldoInicial: 1_000_000,
    saldoInicialFecha: "2026-08-01",
    reservaMinima: 300_000,
    movimientos: [
      { tipo: "ingreso", monto: 5_000_000, fecha: "2026-08-05", descripcion: "Sueldo" },
      { tipo: "ingreso", monto: 700_000, fecha: "2026-08-20", descripcion: "Changa" },
      { tipo: "gasto", monto: 1_200_000, fecha: "2026-08-07", descripcion: "Alquiler" },
      { tipo: "gasto", monto: 300_000, fecha: "2026-08-12", descripcion: "Súper" },
      { tipo: "compromiso", monto: 450_000, fecha: "2026-09-10", descripcion: "Colegio" },
    ],
    conciliaciones: [],
    fijos: [],
    deudas: [],
  });

  const horizonte = "2026-09-30";
  const egresos = panorama.egresos.filter((e) => e.fecha <= horizonte);
  const anotados = egresos.filter((e) => e.fuente === "anotado");
  const previsibles = egresos.filter((e) => e.fuente === "previsible");
  const cuotas = egresos.filter((e) => e.fuente === "cuota");

  const sumar = (xs: { monto: number }[]) => xs.reduce((t, x) => t + x.monto, 0);
  const totalCompromisos = sumar(anotados);
  const totalPrevisible = sumar(previsibles);
  const totalCuotas = sumar(cuotas);

  const reserva = panorama.reservaMinima;
  const ahorroComprometido = 0;
  const comprometido = totalCompromisos + totalPrevisible + totalCuotas;
  const disponibleReal = panorama.saldoActual - comprometido - reserva - ahorroComprometido;

  return trazarPanel({
    aplicado: panorama.aplicado,
    anotados,
    previsibles,
    cuotas,
    horizonte,
    saldoBase: panorama.conciliacion.base,
    gastoInvisible: panorama.conciliacion.gasto_invisible,
    saldoEstimado: panorama.saldoActual,
    totalCompromisos,
    totalPrevisible,
    totalCuotas,
    reserva,
    ahorroComprometido,
    disponibleReal,
  });
}

function buscar(trazados: Trazado[], cifra: string) {
  const t = trazados.find((x) => x.cifra === cifra);
  assert.ok(t, `falta la traza de ${cifra}`);
  return t;
}

// ============================================================
// Lo único que importa de verdad: que el detalle cuadre
// ============================================================
//
// Un detalle que no suma su total es peor que no tener detalle: el usuario
// descubre que uno de los dos miente y no sabe cuál, así que deja de creerle
// a los dos.

test("ninguna cifra del panel queda sin cuadrar", () => {
  const trazados = panelDeEjemplo();

  assert.deepEqual(
    noCuadran(trazados).map((t) => t.cifra),
    [],
  );
});

test("todas las cifras del panel tienen traza", () => {
  const trazados = panelDeEjemplo();
  const esperadas = [
    "ingresos",
    "gastos",
    "saldo_estimado",
    "compromisos",
    "gastos_previsibles",
    "cuotas",
    "comprometido",
    "disponible_real",
  ];

  for (const cifra of esperadas) buscar(trazados, cifra);
});

test("los ingresos se abren en los movimientos que los formaron", () => {
  const ingresos = buscar(panelDeEjemplo(), "ingresos");

  assert.equal(ingresos.tipo, "suma");
  if (ingresos.tipo !== "suma") return;

  assert.equal(ingresos.total, 5_700_000);
  assert.equal(ingresos.partidas.length, 2);
  assert.deepEqual(
    ingresos.partidas.map((p) => p.descripcion).sort(),
    ["Changa", "Sueldo"],
  );
  assert.equal(
    ingresos.partidas.reduce((t, p) => t + p.monto, 0),
    ingresos.total,
  );
});

test("un movimiento sin descripción no aparece en blanco", () => {
  const trazados = trazarPanel({
    aplicado: {
      ingresos: 100,
      gastos: 0,
      entradas: [{ tipo: "ingreso", monto: 100, fecha: "2026-08-10", descripcion: "   " }],
      salidas: [],
      desde: "2026-08-01",
      hasta: "2026-08-31",
    },
    anotados: [],
    previsibles: [],
    cuotas: [],
    horizonte: "2026-09-30",
    saldoBase: 0,
    gastoInvisible: 0,
    saldoEstimado: 100,
    totalCompromisos: 0,
    totalPrevisible: 0,
    totalCuotas: 0,
    reserva: 0,
    ahorroComprometido: 0,
    disponibleReal: 100,
  });

  const ingresos = buscar(trazados, "ingresos");
  if (ingresos.tipo !== "suma") return assert.fail("tendría que ser una suma");

  assert.equal(ingresos.partidas[0].descripcion, "Sin descripción");
});

// ============================================================
// Los números que NO son una suma
// ============================================================

test("el disponible real se abre en su cuenta, no en una lista inventada", () => {
  const disponible = buscar(panelDeEjemplo(), "disponible_real");

  assert.equal(disponible.tipo, "cuenta");
  if (disponible.tipo !== "cuenta") return;

  assert.deepEqual(
    disponible.terminos.map((t) => `${t.signo}${t.etiqueta}`),
    [
      "+Saldo estimado de hoy",
      "-Todo lo que ya tiene dueño",
      "-Tu reserva mínima",
      "-Lo que apartás para ahorrar",
    ],
  );
});

test("cada término de una cuenta que se puede abrir dice cuál es su cifra", () => {
  const saldo = buscar(panelDeEjemplo(), "saldo_estimado");
  if (saldo.tipo !== "cuenta") return assert.fail("tendría que ser una cuenta");

  const conCifra = saldo.terminos.filter((t) => t.cifra);

  assert.deepEqual(
    conCifra.map((t) => t.cifra),
    ["ingresos", "gastos"],
  );
});

test("el saldo estimado cuadra con el punto de partida más lo que pasó", () => {
  const saldo = buscar(panelDeEjemplo(), "saldo_estimado");

  assert.equal(saldo.cuadra, true);
  // 1.000.000 + 5.700.000 − 1.500.000 = 5.200.000
  assert.equal(saldo.total, 5_200_000);
});

// ============================================================
// La comprobación tiene que servir para algo
// ============================================================

test("si el total no coincide con sus partes, la traza lo delata", () => {
  const trazados = trazarPanel({
    aplicado: {
      // El total dice 999 y la lista suma 100: exactamente el error que esto
      // existe para atrapar.
      ingresos: 999,
      gastos: 0,
      entradas: [{ tipo: "ingreso", monto: 100, fecha: "2026-08-10", descripcion: "Algo" }],
      salidas: [],
      desde: "2026-08-01",
      hasta: "2026-08-31",
    },
    anotados: [],
    previsibles: [],
    cuotas: [],
    horizonte: "2026-09-30",
    saldoBase: 0,
    gastoInvisible: 0,
    saldoEstimado: 100,
    totalCompromisos: 0,
    totalPrevisible: 0,
    totalCuotas: 0,
    reserva: 0,
    ahorroComprometido: 0,
    disponibleReal: 100,
  });

  const rotas = noCuadran(trazados).map((t) => t.cifra);

  assert.ok(rotas.includes("ingresos"));
});

test("una diferencia de redondeo de un guaraní no se marca como error", () => {
  const trazados = trazarPanel({
    aplicado: {
      ingresos: 101,
      gastos: 0,
      entradas: [{ tipo: "ingreso", monto: 100, fecha: "2026-08-10", descripcion: "Algo" }],
      salidas: [],
      desde: "2026-08-01",
      hasta: "2026-08-31",
    },
    anotados: [],
    previsibles: [],
    cuotas: [],
    horizonte: "2026-09-30",
    saldoBase: 0,
    gastoInvisible: 0,
    saldoEstimado: 101,
    totalCompromisos: 0,
    totalPrevisible: 0,
    totalCuotas: 0,
    reserva: 0,
    ahorroComprometido: 0,
    disponibleReal: 101,
  });

  assert.equal(buscar(trazados, "ingresos").cuadra, true);
});
