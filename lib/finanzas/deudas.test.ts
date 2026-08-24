import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cuotasPendientes,
  cuotasRestantes,
  estaViva,
  porPrioridad,
  proximaCuota,
  sinDuplicar,
  totalAdeudado,
  validarDeuda,
  type Deuda,
} from "./deudas.ts";

function deuda(parcial: Partial<Deuda> = {}): Deuda {
  return {
    acreedor: "Banco Itaú",
    tipo: "prestamo",
    moneda: "PYG",
    saldo_declarado: 6_000_000,
    saldo_declarado_el: "2026-08-01",
    cuota_monto: 500_000,
    cuota_dia: 5,
    cuotas_totales: 12,
    cuotas_pagadas: 0,
    vence_el: null,
    estado: "al_dia",
    preocupa: false,
    ...parcial,
  };
}

test("un préstamo casi terminado proyecta solo las cuotas que quedan", () => {
  // 12 cuotas, 10 pagadas: quedan DOS. Proyectar para siempre le mostraría al
  // usuario menos plata de la que tiene, todos los meses.
  const cuotas = cuotasPendientes([deuda({ cuotas_pagadas: 10 })], {
    desde: "2026-08-24",
    hasta: "2027-08-24",
  });

  assert.equal(cuotas.length, 2);
  assert.deepEqual(
    cuotas.map((c) => c.fecha),
    ["2026-09-05", "2026-10-05"],
  );
});

test("una deuda saldada no descuenta nada", () => {
  const cuotas = cuotasPendientes([deuda({ estado: "saldada" })], {
    desde: "2026-08-24",
    hasta: "2026-12-31",
  });

  assert.deepEqual(cuotas, []);
});

test("una deuda sin cuota pactada no se proyecta", () => {
  // Deber plata no significa saber cuándo sale. Sin cuota no se inventa una.
  const sinCuota = deuda({ cuota_monto: null, cuota_dia: null });

  assert.equal(estaViva(sinCuota), false);
  assert.deepEqual(cuotasPendientes([sinCuota], { desde: "2026-08-24", hasta: "2026-12-31" }), []);
});

test("las cuotas se cortan en la fecha de vencimiento", () => {
  const cuotas = cuotasPendientes(
    [deuda({ cuotas_totales: null, cuotas_pagadas: 0, vence_el: "2026-10-31" })],
    { desde: "2026-08-24", hasta: "2027-06-30" },
  );

  assert.deepEqual(
    cuotas.map((c) => c.fecha),
    ["2026-09-05", "2026-10-05"],
  );
});

test("una deuda sin plazo conocido proyecta hasta el horizonte, no para siempre", () => {
  const cuotas = cuotasPendientes([deuda({ cuotas_totales: null })], {
    desde: "2026-08-24",
    hasta: "2026-11-30",
  });

  assert.deepEqual(
    cuotas.map((c) => c.fecha),
    ["2026-09-05", "2026-10-05", "2026-11-05"],
  );
});

test("el día 31 se ancla al último día de los meses cortos", () => {
  const cuotas = cuotasPendientes(
    [deuda({ cuota_dia: 31, cuotas_totales: 3, cuotas_pagadas: 0 })],
    { desde: "2027-01-01", hasta: "2027-04-30" },
  );

  assert.deepEqual(
    cuotas.map((c) => c.fecha),
    ["2027-01-31", "2027-02-28", "2027-03-31"],
  );
});

test("la descripción dice en qué cuota va", () => {
  const [cuota] = cuotasPendientes([deuda({ cuotas_pagadas: 4 })], {
    desde: "2026-08-24",
    hasta: "2026-09-30",
  });

  assert.equal(cuota.descripcion, "Cuota 5 de 12 — Banco Itaú");
});

test("NO descuenta dos veces la cuota que además llega por correo", () => {
  // El error más caro del módulo: el detector de series reconoce el débito
  // automático Y la deuda proyecta la misma cuota.
  const cuotas = cuotasPendientes([deuda()], { desde: "2026-08-24", hasta: "2026-09-30" });

  const yaProyectado = [
    {
      tipo: "gasto" as const,
      descripcion: "DEB.AUT.PRESTAMO",
      monto: 495_000, // el banco debitó un poco distinto: sigue siendo la misma cuota
      fecha: "2026-09-04",
      periodicidad: "mensual" as const,
      confianza: 0.85,
    },
  ];

  assert.equal(cuotas.length, 1);
  assert.deepEqual(sinDuplicar(cuotas, yaProyectado), []);
});

test("sí descuenta una cuota que NO se parece a lo ya proyectado", () => {
  const cuotas = cuotasPendientes([deuda()], { desde: "2026-08-24", hasta: "2026-09-30" });

  const otroGasto = [
    {
      tipo: "gasto" as const,
      descripcion: "Alquiler",
      monto: 2_000_000,
      fecha: "2026-09-05",
      periodicidad: "mensual" as const,
      confianza: 0.85,
    },
  ];

  assert.equal(sinDuplicar(cuotas, otroGasto).length, 1);
});

test("un ingreso del mismo monto y fecha no cancela una cuota", () => {
  // Solo los gastos pueden duplicar un gasto.
  const cuotas = cuotasPendientes([deuda()], { desde: "2026-08-24", hasta: "2026-09-30" });

  const ingreso = [
    {
      tipo: "ingreso" as const,
      descripcion: "Cobro",
      monto: 500_000,
      fecha: "2026-09-05",
      periodicidad: "mensual" as const,
      confianza: 0.85,
    },
  ];

  assert.equal(sinDuplicar(cuotas, ingreso).length, 1);
});

test("primero se habla de lo que preocupa, aunque sea lo más chico", () => {
  const orden = porPrioridad([
    deuda({ acreedor: "Banco grande", saldo_declarado: 50_000_000 }),
    deuda({ acreedor: "Tío Ramón", saldo_declarado: 800_000, preocupa: true }),
    deuda({ acreedor: "Proveedor atrasado", saldo_declarado: 3_000_000, estado: "atrasada" }),
  ]);

  assert.deepEqual(
    orden.map((d) => d.acreedor),
    ["Tío Ramón", "Proveedor atrasado", "Banco grande"],
  );
});

test("el total adeudado ignora lo saldado y separa monedas", () => {
  const deudas = [
    deuda({ saldo_declarado: 1_000_000 }),
    deuda({ saldo_declarado: 2_000_000 }),
    deuda({ saldo_declarado: 9_000_000, estado: "saldada" }),
    deuda({ saldo_declarado: 500, moneda: "USD" }),
  ];

  assert.equal(totalAdeudado(deudas), 3_000_000);
  assert.equal(totalAdeudado(deudas, "USD"), 500);
});

test("cuotasRestantes distingue 'ninguna' de 'no se sabe'", () => {
  assert.equal(cuotasRestantes(deuda({ cuotas_totales: 12, cuotas_pagadas: 12 })), 0);
  assert.equal(cuotasRestantes(deuda({ cuotas_totales: null })), null);
});

test("proximaCuota devuelve la primera que cae", () => {
  const cuota = proximaCuota(
    [
      deuda({ acreedor: "Banco", cuota_dia: 20 }),
      deuda({ acreedor: "Financiera", cuota_dia: 3 }),
    ],
    "2026-08-24",
  );

  assert.equal(cuota?.fecha, "2026-09-03");
  assert.match(cuota?.descripcion ?? "", /Financiera/);
});

test("validarDeuda rechaza una deuda sin acreedor", () => {
  const r = validarDeuda({ tipo: "prestamo", saldo_declarado: 1000 }, "2026-08-24");
  assert.ok("error" in r);
});

test("validarDeuda rechaza un monto de cuota sin día del mes", () => {
  // Es la combinación que rompe la proyección: hay plata, no hay cuándo.
  const r = validarDeuda(
    { acreedor: "Banco", tipo: "prestamo", saldo_declarado: 1000, cuota_monto: 100 },
    "2026-08-24",
  );

  assert.ok("error" in r);
  assert.match(r.error, /monto y el día/);
});

test("validarDeuda rechaza más cuotas pagadas que totales", () => {
  const r = validarDeuda(
    {
      acreedor: "Banco",
      tipo: "prestamo",
      saldo_declarado: 1000,
      cuotas_totales: 12,
      cuotas_pagadas: 13,
    },
    "2026-08-24",
  );

  assert.ok("error" in r);
});

test("validarDeuda rechaza un tipo que no existe", () => {
  const r = validarDeuda(
    { acreedor: "Banco", tipo: "hipoteca_lunar", saldo_declarado: 1000 },
    "2026-08-24",
  );

  assert.ok("error" in r);
});

test("validarDeuda fecha el saldo con hoy cuando no se lo dan", () => {
  // Un saldo sin fecha no se puede interpretar tres meses después.
  const r = validarDeuda(
    { acreedor: "Tío Ramón", tipo: "familiar", saldo_declarado: 800000 },
    "2026-08-24",
  );

  assert.ok("valor" in r);
  assert.equal(r.valor.saldo_declarado_el, "2026-08-24");
  assert.equal(r.valor.estado, "al_dia");
  assert.equal(r.valor.moneda, "PYG");
  assert.equal(r.valor.cuota_monto, null);
});

test("validarDeuda no deja que el cliente invente un estado", () => {
  const r = validarDeuda(
    { acreedor: "Banco", tipo: "prestamo", saldo_declarado: 1000, estado: "perdonada" },
    "2026-08-24",
  );

  assert.ok("valor" in r);
  assert.equal(r.valor.estado, "al_dia");
});
