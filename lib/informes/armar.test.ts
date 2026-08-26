import assert from "node:assert/strict";
import { test } from "node:test";

import { armarInforme, type MovimientoInforme } from "./armar.ts";
import { resolverPeriodo } from "./periodo.ts";

const HOY = "2026-08-25";
const SEMANA_PASADA = resolverPeriodo("semana_pasada", HOY); // 17 al 23 de agosto

function mov(
  fecha: string,
  tipo: MovimientoInforme["tipo"],
  monto: number,
  descripcion: string | null = "Movimiento",
): MovimientoInforme {
  return { fecha, tipo, monto, descripcion };
}

test("solo entra lo que cae dentro del período pedido", () => {
  const informe = armarInforme({
    periodo: SEMANA_PASADA,
    moneda: "PYG",
    hoy: HOY,
    movimientos: [
      mov("2026-08-16", "gasto", 100_000, "Antes"),
      mov("2026-08-17", "gasto", 200_000, "PAGO ANDE"),
      mov("2026-08-23", "gasto", 300_000, "Supermercado Stock"),
      mov("2026-08-24", "gasto", 999_000, "Después"),
    ],
  });

  assert.equal(informe.resumen.gastos, 500_000);
  assert.equal(informe.resumen.movimientos, 2);
});

test("el neto es ingresos menos gastos y puede dar negativo", () => {
  // Un balance que nunca muestra rojo no sirve para decidir nada.
  const informe = armarInforme({
    periodo: SEMANA_PASADA,
    moneda: "PYG",
    hoy: HOY,
    movimientos: [mov("2026-08-18", "ingreso", 400_000), mov("2026-08-19", "gasto", 950_000)],
  });

  assert.equal(informe.resumen.neto, -550_000);
});

test("los compromisos NO se restan del neto, pero se avisan", () => {
  // Son plata que sigue en la cuenta. Restarlos haría que el informe no cierre
  // contra el extracto del banco, que es contra lo que el usuario lo compara.
  const informe = armarInforme({
    periodo: SEMANA_PASADA,
    moneda: "PYG",
    hoy: HOY,
    movimientos: [mov("2026-08-18", "ingreso", 1_000_000), mov("2026-08-20", "compromiso", 700_000)],
  });

  assert.equal(informe.resumen.neto, 1_000_000);
  assert.equal(informe.resumen.comprometido, 700_000);
  assert.ok(informe.advertencias.some((a) => a.includes("todavía no salieron de la cuenta")));
});

test("clasifica los gastos por destino usando las reglas de finanzas", () => {
  const informe = armarInforme({
    periodo: SEMANA_PASADA,
    moneda: "PYG",
    hoy: HOY,
    movimientos: [
      mov("2026-08-17", "gasto", 200_000, "PAGO ANDE"),
      mov("2026-08-18", "gasto", 600_000, "Alquiler agosto"),
    ],
  });

  assert.equal(informe.destinos[0].clave, "vivienda");
  assert.equal(informe.destinos[1].clave, "servicios");
});

test("SIEMPRE advierte que no ve el efectivo", () => {
  // La advertencia va impresa adentro del documento, no en una nota al pie:
  // un balance que se presenta como completo sin serlo se lleva al contador.
  const informe = armarInforme({ periodo: SEMANA_PASADA, moneda: "PYG", hoy: HOY, movimientos: [] });

  assert.ok(informe.advertencias.some((a) => a.includes("efectivo")));
});

test("si EOS aprendió el gasto invisible, lo dice con cifra", () => {
  const informe = armarInforme({
    periodo: SEMANA_PASADA,
    moneda: "PYG",
    hoy: HOY,
    movimientos: [],
    gastoInvisible: 850_000,
  });

  const aviso = informe.advertencias.find((a) => a.includes("efectivo"));
  assert.ok(aviso?.includes("850.000"));
});

test("avisa cuánto quedó sin clasificar y qué parte del total es", () => {
  const informe = armarInforme({
    periodo: SEMANA_PASADA,
    moneda: "PYG",
    hoy: HOY,
    movimientos: [
      mov("2026-08-17", "gasto", 750_000, "TRANSF 8821"),
      mov("2026-08-18", "gasto", 250_000, "PAGO ANDE"),
    ],
  });

  assert.ok(informe.advertencias.some((a) => a.includes("75%") && a.includes("sin clasificar")));
});

test("un período en curso se marca como incompleto", () => {
  const enCurso = resolverPeriodo("mes", HOY);
  const informe = armarInforme({ periodo: enCurso, moneda: "PYG", hoy: HOY, movimientos: [] });

  assert.ok(informe.advertencias.some((a) => a.includes("todavía no terminó")));
});

test("un período cerrado NO se marca como incompleto", () => {
  const informe = armarInforme({ periodo: SEMANA_PASADA, moneda: "PYG", hoy: HOY, movimientos: [] });
  assert.ok(!informe.advertencias.some((a) => a.includes("todavía no terminó")));
});

test("los movimientos salen del más reciente al más viejo", () => {
  const informe = armarInforme({
    periodo: SEMANA_PASADA,
    moneda: "PYG",
    hoy: HOY,
    movimientos: [mov("2026-08-17", "gasto", 1), mov("2026-08-22", "gasto", 2)],
  });

  assert.equal(informe.movimientos[0].fecha, "2026-08-22");
});

test("las deudas saldadas no van al informe", () => {
  const informe = armarInforme({
    periodo: SEMANA_PASADA,
    moneda: "PYG",
    hoy: HOY,
    movimientos: [],
    deudas: [
      { acreedor: "Banco", tipo: "prestamo", moneda: "PYG", saldo_declarado: 1, saldo_declarado_el: HOY, cuota_monto: null, estado: "al_dia" },
      { acreedor: "Viejo", tipo: "otro", moneda: "PYG", saldo_declarado: 0, saldo_declarado_el: HOY, cuota_monto: null, estado: "saldada" },
    ],
  });

  assert.equal(informe.deudas.length, 1);
  assert.equal(informe.deudas[0].acreedor, "Banco");
});

test("el título nombra el período que se pidió", () => {
  assert.equal(armarInforme({ periodo: SEMANA_PASADA, moneda: "PYG", hoy: HOY, movimientos: [] }).titulo, "Balance de la semana");
  assert.equal(
    armarInforme({ periodo: resolverPeriodo("trimestre", HOY), moneda: "PYG", hoy: HOY, movimientos: [] }).titulo,
    "Balance trimestral",
  );
});

test("un período sin movimientos da un informe vacío, no un error", () => {
  const informe = armarInforme({ periodo: SEMANA_PASADA, moneda: "PYG", hoy: HOY, movimientos: [] });

  assert.equal(informe.resumen.neto, 0);
  assert.equal(informe.resumen.movimientos, 0);
  assert.deepEqual(informe.destinos, []);
});
