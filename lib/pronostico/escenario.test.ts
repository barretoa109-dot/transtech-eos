import test from "node:test";
import assert from "node:assert/strict";

import { escenariosSugeridos, simular, type Entrada } from "./escenario.ts";
import { proyectarCaja } from "./caja.ts";
import type { CompraHecho, FijoHecho, VentaHecho } from "../kpi/tipos.ts";

const HOY = "2026-09-03";

function dia(n: number): string {
  return new Date(Date.parse(`${HOY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function venta(p: Partial<VentaHecho> = {}): VentaHecho {
  return {
    id: p.id ?? "v1",
    fecha: p.fecha ?? HOY,
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "emitida",
    contacto_id: null,
    contacto_nombre: null,
    total: p.total ?? 1_000_000,
    vence_el: "vence_el" in p ? (p.vence_el ?? null) : dia(15),
    cobrado: p.cobrado ?? 0,
    items: [],
  };
}

function compra(p: Partial<CompraHecho> = {}): CompraHecho {
  return {
    id: p.id ?? "c1",
    fecha: p.fecha ?? HOY,
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "registrada",
    proveedor_id: null,
    proveedor_nombre: null,
    total: p.total ?? 400_000,
    vence_el: "vence_el" in p ? (p.vence_el ?? null) : dia(10),
    cobrado: p.cobrado ?? 0,
  };
}

function fijo(p: Partial<FijoHecho> = {}): FijoHecho {
  return { moneda: p.moneda ?? "PYG", monto: p.monto ?? 300_000, tipo: p.tipo ?? "gasto" };
}

function entrada(p: Partial<Entrada> = {}): Entrada {
  return { ventas: [], compras: [], fijos: [], hoy: HOY, ...p };
}

const a90 = (e: ReturnType<typeof proyectarCaja>) => e[0].tramos[2];

// ---------------------------------------------------------------------------
// La regla que no se negocia
// ---------------------------------------------------------------------------

test("simular no toca los hechos que recibió", () => {
  const v = venta({ vence_el: dia(-30) });
  const c = compra({ vence_el: dia(10) });
  const f = fijo();
  const e = entrada({ ventas: [v], compras: [c], fijos: [f] });

  const antes = JSON.stringify(e);
  simular(e, { tipo: "cobrar_vencido", parte: 0.5, en_dias: 30 });
  simular(e, { tipo: "estirar_pagos", dias: 15 });
  simular(e, { tipo: "recortar_fijos", parte: 0.5 });
  simular(e, { tipo: "mover_cobros", dias: 10 });

  assert.equal(JSON.stringify(e), antes, "un escenario modificó los datos de entrada");
});

test("correr el mismo escenario dos veces da lo mismo", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(-10) })] });
  const uno = simular(e, { tipo: "cobrar_vencido", parte: 0.5, en_dias: 20 });
  const dos = simular(e, { tipo: "cobrar_vencido", parte: 0.5, en_dias: 20 });
  assert.deepEqual(uno.diferencia, dos.diferencia);
});

// ---------------------------------------------------------------------------
// Cobrar lo vencido
// ---------------------------------------------------------------------------

test("cobrar la mitad de lo vencido devuelve esa mitad al pronóstico", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(-45), total: 2_000_000 })] });

  assert.equal(a90(proyectarCaja(e)).entradas, 0, "de arranque lo vencido no cuenta");

  const s = simular(e, { tipo: "cobrar_vencido", parte: 0.5, en_dias: 30 });
  assert.equal(a90(s.proyeccion).entradas, 1_000_000);
  assert.equal(s.diferencia[0].neto, 1_000_000);
});

test("cobrar lo vencido no toca lo que no está vencido", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(20), total: 800_000 })] });
  const s = simular(e, { tipo: "cobrar_vencido", parte: 1, en_dias: 5 });
  assert.equal(s.diferencia[0].neto, 0);
});

test("cobrar lo vencido respeta lo ya cobrado del documento", () => {
  const e = entrada({
    ventas: [venta({ vence_el: dia(-30), total: 1_000_000, cobrado: 400_000 })],
  });
  const s = simular(e, { tipo: "cobrar_vencido", parte: 1, en_dias: 10 });
  assert.equal(a90(s.proyeccion).entradas, 600_000, "se recuperó plata que ya estaba cobrada");
});

test("cobrar lo vencido declara que el supuesto no tiene respaldo", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(-30) })] });
  const s = simular(e, { tipo: "cobrar_vencido", parte: 0.5, en_dias: 30 });
  assert.ok(s.supuestos.some((x) => x.includes("no hay nada en los datos que lo respalde")));
});

// ---------------------------------------------------------------------------
// Estirar pagos
// ---------------------------------------------------------------------------

test("estirar los pagos saca la salida del primer tramo", () => {
  const e = entrada({ compras: [compra({ vence_el: dia(25), total: 500_000 })] });
  assert.equal(proyectarCaja(e)[0].tramos[0].salidas, 500_000);

  const s = simular(e, { tipo: "estirar_pagos", dias: 15 });
  assert.equal(s.proyeccion[0].tramos[0].salidas, 0, "se corrió al tramo siguiente");
  assert.equal(s.proyeccion[0].tramos[1].salidas, 500_000);
});

test("estirar no reduce lo que se debe a 90 días, y lo dice", () => {
  const e = entrada({ compras: [compra({ vence_el: dia(10), total: 500_000 })] });
  const s = simular(e, { tipo: "estirar_pagos", dias: 15 });
  assert.equal(s.diferencia[0].neto, 0, "estirar no es ahorrar");
  assert.ok(s.supuestos.some((x) => x.includes("la plata sale igual, más tarde")));
});

test("estirar un pago sin vencimiento no inventa uno", () => {
  const e = entrada({ compras: [compra({ vence_el: null })] });
  const s = simular(e, { tipo: "estirar_pagos", dias: 30 });
  assert.equal(a90(s.proyeccion).salidas, 0);
});

// ---------------------------------------------------------------------------
// Recortar fijos
// ---------------------------------------------------------------------------

test("recortar el 10% de los fijos ahorra ese 10% en los tres meses", () => {
  const e = entrada({ fijos: [fijo({ monto: 1_000_000 })] });
  assert.equal(a90(proyectarCaja(e)).salidas, 3_000_000);

  const s = simular(e, { tipo: "recortar_fijos", parte: 0.1 });
  assert.equal(a90(s.proyeccion).salidas, 2_700_000);
  assert.equal(s.diferencia[0].neto, 300_000);
});

test("recortar gastos no recorta los ingresos fijos", () => {
  const e = entrada({ fijos: [fijo({ monto: 500_000, tipo: "ingreso" })] });
  const s = simular(e, { tipo: "recortar_fijos", parte: 0.5 });
  assert.equal(s.diferencia[0].neto, 0);
});

// ---------------------------------------------------------------------------
// Mover cobros
// ---------------------------------------------------------------------------

test("cobrar antes adelanta la entrada de tramo", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(35), total: 700_000 })] });
  assert.equal(proyectarCaja(e)[0].tramos[0].entradas, 0);

  const s = simular(e, { tipo: "mover_cobros", dias: 10 });
  assert.equal(s.proyeccion[0].tramos[0].entradas, 700_000);
});

test("cobrar más tarde atrasa la entrada un tramo", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(25), total: 900_000 })] });
  assert.equal(proyectarCaja(e)[0].tramos[0].entradas, 900_000);

  const s = simular(e, { tipo: "mover_cobros", dias: -10 });
  assert.equal(s.proyeccion[0].tramos[0].entradas, 0);
  assert.equal(s.proyeccion[0].tramos[1].entradas, 900_000);
});

test("atrasar un cobro más allá de los 90 días lo saca del pronóstico", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(85), total: 900_000 })] });
  assert.equal(a90(proyectarCaja(e)).entradas, 900_000);

  const s = simular(e, { tipo: "mover_cobros", dias: -20 });
  assert.equal(a90(s.proyeccion).entradas, 0);
  assert.equal(s.diferencia[0].neto, -900_000);
  // Y no pasa a "vencido": todavía no le llegó la fecha. Atrasar un cobro
  // nunca lo manda al pasado, por más que se atrase.
  assert.equal(s.proyeccion[0].vencido_sin_cobrar, 0);
});

// ---------------------------------------------------------------------------
// La pregunta viaja con el número
// ---------------------------------------------------------------------------

test("cada escenario se explica en una frase que alguien puede evaluar", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(-10) })], compras: [compra()], fijos: [fijo()] });

  assert.equal(
    simular(e, { tipo: "cobrar_vencido", parte: 0.5, en_dias: 30 }).pregunta,
    "¿Y si cobro el 50% de lo que está vencido, dentro de 30 días?",
  );
  assert.equal(simular(e, { tipo: "estirar_pagos", dias: 15 }).pregunta, "¿Y si le pido 15 días más a los proveedores?");
  assert.equal(simular(e, { tipo: "recortar_fijos", parte: 0.1 }).pregunta, "¿Y si recorto el 10% de los gastos fijos?");
  assert.equal(simular(e, { tipo: "mover_cobros", dias: 7 }).pregunta, "¿Y si me pagan 7 días antes?");
  assert.equal(simular(e, { tipo: "mover_cobros", dias: -7 }).pregunta, "¿Y si me pagan 7 días más tarde?");
});

test("todo escenario declara al menos un supuesto", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(-10) })], compras: [compra()], fijos: [fijo()] });
  for (const s of escenariosSugeridos(e)) {
    assert.ok(s.supuestos.length > 0, `sin supuestos: ${s.pregunta}`);
  }
});

// ---------------------------------------------------------------------------
// Sugeridos
// ---------------------------------------------------------------------------

test("no se sugiere cobrar lo vencido cuando no hay nada vencido", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(20) })], compras: [compra()], fijos: [fijo()] });
  assert.ok(!escenariosSugeridos(e).some((s) => s.pregunta.includes("vencido")));
});

test("no se sugiere recortar fijos cuando no hay fijos", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(-5) })] });
  assert.ok(!escenariosSugeridos(e).some((s) => s.pregunta.includes("fijos")));
});

test("sin nada que mover no se sugiere nada", () => {
  assert.deepEqual(escenariosSugeridos(entrada()), []);
});

test("los sugeridos son moderados a propósito", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(-30) })], compras: [compra()], fijos: [fijo()] });
  const preguntas = escenariosSugeridos(e).map((s) => s.pregunta);
  assert.ok(preguntas.some((p) => p.includes("50%")), "la mitad de lo vencido, no todo");
  assert.ok(preguntas.some((p) => p.includes("10%")), "un recorte chico, no uno drástico");
});

// ---------------------------------------------------------------------------
// Monedas
// ---------------------------------------------------------------------------

test("la diferencia se informa por moneda, sin sumarlas", () => {
  const e = entrada({
    ventas: [
      venta({ id: "a", moneda: "PYG", vence_el: dia(-10), total: 1_000_000 }),
      venta({ id: "b", moneda: "USD", vence_el: dia(-10), total: 200 }),
    ],
  });
  const s = simular(e, { tipo: "cobrar_vencido", parte: 1, en_dias: 10 });
  assert.equal(s.diferencia.length, 2);
  assert.equal(s.diferencia.find((d) => d.moneda === "PYG")?.neto, 1_000_000);
  assert.equal(s.diferencia.find((d) => d.moneda === "USD")?.neto, 200);
});

test("con saldo inicial la diferencia también informa el saldo", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(-10), total: 500_000 })], saldos: { PYG: 100_000 } });
  const s = simular(e, { tipo: "cobrar_vencido", parte: 1, en_dias: 10 });
  assert.equal(s.diferencia[0].saldo, 500_000);
});

test("sin saldo inicial la diferencia de saldo es null, no cero", () => {
  const e = entrada({ ventas: [venta({ vence_el: dia(-10) })] });
  const s = simular(e, { tipo: "cobrar_vencido", parte: 1, en_dias: 10 });
  assert.equal(s.diferencia[0].saldo, null);
});
