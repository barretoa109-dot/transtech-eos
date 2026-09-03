import test from "node:test";
import assert from "node:assert/strict";

import {
  FALTA_LA_CAJA,
  NO_HAY_PATRIMONIO,
  leerCapitalDeTrabajo,
  posicion,
  type CuotaDeuda,
} from "./posicion.ts";
import type { DocumentoCartera } from "../erp/cartera.ts";

function doc(p: Partial<DocumentoCartera> = {}): DocumentoCartera {
  return {
    id: p.id ?? "d1",
    fecha: p.fecha ?? "2026-09-01",
    vence_el: "vence_el" in p ? (p.vence_el ?? null) : "2026-10-01",
    moneda: p.moneda ?? "PYG",
    total: p.total ?? 1_000_000,
    cobrado: p.cobrado ?? 0,
    contacto_id: null,
    contacto_nombre: null,
  };
}

function deuda(p: Partial<CuotaDeuda> = {}): CuotaDeuda {
  return { moneda: p.moneda ?? "PYG", cuota: p.cuota ?? 100_000, restantes: "restantes" in p ? (p.restantes ?? null) : 6 };
}

function una(datos: Parameters<typeof posicion>[0]) {
  const r = posicion(datos);
  assert.equal(r.length, 1, "se esperaba una sola moneda");
  return r[0];
}

const VACIO = { ventasPendientes: [], comprasPendientes: [], inventario: [], deudas: [] };

// ---------------------------------------------------------------------------
// Lo que sí se puede
// ---------------------------------------------------------------------------

test("el activo conocido suma lo por cobrar y el inventario", () => {
  const p = una({
    ...VACIO,
    ventasPendientes: [doc({ total: 3_000_000 })],
    inventario: [{ moneda: "PYG", valor: 2_000_000 }],
  });
  assert.equal(p.por_cobrar, 3_000_000);
  assert.equal(p.inventario, 2_000_000);
  assert.equal(p.activo_conocido, 5_000_000);
});

test("solo se cuenta el saldo pendiente, no el total del documento", () => {
  const p = una({ ...VACIO, ventasPendientes: [doc({ total: 1_000_000, cobrado: 700_000 })] });
  assert.equal(p.por_cobrar, 300_000);
  assert.notEqual(p.por_cobrar, 1_000_000, "se contó plata ya cobrada como activo");
});

test("un documento saldado no es activo", () => {
  const p = posicion({ ...VACIO, ventasPendientes: [doc({ total: 500_000, cobrado: 500_000 })] });
  assert.equal(p[0].por_cobrar, 0);
});

test("el pasivo suma lo por pagar y las cuotas del año", () => {
  const p = una({
    ...VACIO,
    comprasPendientes: [doc({ total: 800_000 })],
    deudas: [deuda({ cuota: 100_000, restantes: 6 })],
  });
  assert.equal(p.por_pagar, 800_000);
  assert.equal(p.deuda_12_meses, 600_000);
  assert.equal(p.pasivo_conocido, 1_400_000);
});

test("una deuda a más de un año se corta en doce cuotas", () => {
  const p = una({ ...VACIO, deudas: [deuda({ cuota: 100_000, restantes: 36 })] });
  assert.equal(p.deuda_12_meses, 1_200_000);
  assert.notEqual(p.deuda_12_meses, 3_600_000, "el pasivo corriente es a doce meses");
});

test("una deuda sin fin se cuenta como doce cuotas, que es lo prudente", () => {
  const p = una({ ...VACIO, deudas: [deuda({ cuota: 50_000, restantes: null })] });
  assert.equal(p.deuda_12_meses, 600_000);
  assert.notEqual(p.deuda_12_meses, 50_000, "contar una sola cuota inflaría el capital de trabajo");
  assert.ok(p.advertencias.some((a) => a.includes("sin fecha de fin")));
});

test("el capital de trabajo es la diferencia", () => {
  const p = una({
    ...VACIO,
    ventasPendientes: [doc({ total: 3_000_000 })],
    inventario: [{ moneda: "PYG", valor: 1_000_000 }],
    comprasPendientes: [doc({ id: "c1", total: 2_500_000 })],
  });
  assert.equal(p.capital_de_trabajo, 1_500_000);
});

test("el capital de trabajo puede dar negativo y se informa como tal", () => {
  const p = una({ ...VACIO, comprasPendientes: [doc({ total: 5_000_000 })] });
  assert.equal(p.capital_de_trabajo, -5_000_000);
  assert.ok(leerCapitalDeTrabajo(p).includes("Debés más"));
});

// ---------------------------------------------------------------------------
// La liquidez es un piso, y se dice
// ---------------------------------------------------------------------------

test("la liquidez sale del activo conocido sobre el pasivo conocido", () => {
  const p = una({
    ...VACIO,
    ventasPendientes: [doc({ total: 2_000_000 })],
    comprasPendientes: [doc({ id: "c1", total: 1_000_000 })],
  });
  assert.equal(p.liquidez_piso, 2);
});

test("sin deudas no hay ratio: no es infinito, es que no aplica", () => {
  const p = una({ ...VACIO, ventasPendientes: [doc({ total: 2_000_000 })] });
  assert.equal(p.liquidez_piso, null);
  assert.ok(p.advertencias.some((a) => a.includes("no hay ratio")));
});

test("siempre dice que falta la caja y que el número es un piso", () => {
  const p = una({ ...VACIO, ventasPendientes: [doc()] });
  assert.ok(p.faltantes.includes(FALTA_LA_CAJA));
  assert.ok(FALTA_LA_CAJA.includes("piso"));
});

// ---------------------------------------------------------------------------
// Lo que NO se calcula, y no por olvido
// ---------------------------------------------------------------------------

test("siempre declara que no hay ROE ni ROA", () => {
  const p = una({ ...VACIO, ventasPendientes: [doc()] });
  assert.ok(p.faltantes.includes(NO_HAY_PATRIMONIO));
});

test("la posición no expone ningún campo de patrimonio, ROE, ROA ni prueba ácida", () => {
  const p = una({ ...VACIO, ventasPendientes: [doc()] });
  const campos = Object.keys(p).join(" ").toLowerCase();
  for (const prohibido of ["patrimonio", "roe", "roa", "acida", "activo_total"]) {
    assert.ok(!campos.includes(prohibido), `apareció "${prohibido}", que no se puede calcular`);
  }
});

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

test("avisa cuando el inventario vale cero por falta de costos", () => {
  const p = una({ ...VACIO, inventario: [{ moneda: "PYG", valor: 0 }] });
  assert.ok(p.advertencias.some((a) => a.includes("no tengan costo cargado")));
});

test("no avisa de inventario cuando simplemente no hay productos", () => {
  const p = una({ ...VACIO, ventasPendientes: [doc()] });
  assert.ok(!p.advertencias.some((a) => a.includes("costo cargado")));
});

// ---------------------------------------------------------------------------
// Monedas
// ---------------------------------------------------------------------------

test("cada moneda tiene su posición y nunca se cruzan", () => {
  const r = posicion({
    ...VACIO,
    ventasPendientes: [doc({ id: "a", moneda: "PYG", total: 1_000_000 })],
    comprasPendientes: [doc({ id: "b", moneda: "USD", total: 500 })],
  });

  assert.equal(r.length, 2);
  const pyg = r.find((x) => x.moneda === "PYG");
  const usd = r.find((x) => x.moneda === "USD");
  assert.equal(pyg?.pasivo_conocido, 0, "una deuda en dólares no es pasivo en guaraníes");
  assert.equal(pyg?.capital_de_trabajo, 1_000_000);
  assert.equal(usd?.activo_conocido, 0);
  assert.equal(usd?.capital_de_trabajo, -500);
});

// ---------------------------------------------------------------------------
// La lectura no juzga
// ---------------------------------------------------------------------------

test("la lectura describe la situación, no dictamina si está sano", () => {
  const bien = una({
    ...VACIO,
    ventasPendientes: [doc({ total: 5_000_000 })],
    comprasPendientes: [doc({ id: "c", total: 1_000_000 })],
  });
  const frase = leerCapitalDeTrabajo(bien).toLowerCase();
  for (const juicio of ["sano", "saludable", "excelente", "peligro", "grave", "mal"]) {
    assert.ok(!frase.includes(juicio), `la frase dictamina "${juicio}" sin saber de qué rubro es el negocio`);
  }
});

test("sin deudas la lectura lo dice sin alarmar", () => {
  const p = una({ ...VACIO, ventasPendientes: [doc()] });
  assert.ok(leerCapitalDeTrabajo(p).includes("No tenés deudas registradas"));
});
