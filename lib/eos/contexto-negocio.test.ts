import assert from "node:assert/strict";
import { test } from "node:test";

import { textoContexto, type ContextoNegocio } from "./contexto-negocio.ts";

test("sin datos no se manda ninguna sección", () => {
  assert.equal(textoContexto(null), "");
  assert.equal(textoContexto(undefined), "");
  assert.equal(textoContexto({}), "");
});

test("un negocio recién abierto no dice que está parado", () => {
  /*
   * Todo en cero es lo que devuelve la base para quien todavía no cargó nada.
   * Si eso llegara al prompt, el modelo lo leería como un hecho —"no vendiste
   * nada este mes"— cuando la verdad es que la persona recién empieza.
   */
  const vacio: ContextoNegocio = {
    mes: "2026-08",
    finanzas: [],
    erp: {
      ventas_mes: { cantidad: 0, total: 0 },
      por_cobrar: 0,
      por_pagar: 0,
      bajo_minimo: [],
      mas_vendidos: [],
    },
    crm: {
      oportunidades_abiertas: { cantidad: 0, monto: 0 },
      ganadas_mes: 0,
      actividades_pendientes: 0,
    },
  };

  assert.equal(textoContexto(vacio), "");
});

test("cada moneda va en su renglón y no se suman entre sí", () => {
  const texto = textoContexto({
    finanzas: [
      { moneda: "PYG", ingresos_mes: 5_000_000, gastos_mes: 3_000_000, neto_mes: 2_000_000 },
      { moneda: "USD", ingresos_mes: 400, gastos_mes: 150, neto_mes: 250 },
    ],
  });

  const renglones = texto.split("\n").filter((l) => l.trim().startsWith("PYG") || l.trim().startsWith("USD"));

  assert.equal(renglones.length, 2);
  assert.ok(texto.includes("PYG"));
  assert.ok(texto.includes("USD"));

  // 5.000.000 + 400 no debe aparecer nunca como un solo número.
  assert.ok(!texto.includes("5000400"));
});

test("las ventas, lo que le deben y lo que debe salen en una línea", () => {
  const texto = textoContexto({
    erp: {
      ventas_mes: { cantidad: 12, total: 3_400_000 },
      por_cobrar: 800_000,
      por_pagar: 250_000,
    },
  });

  assert.ok(texto.includes("12 ventas"));
  assert.ok(texto.includes("le deben"));
  assert.ok(texto.includes("debe "));
});

test("una sola venta se dice en singular", () => {
  const texto = textoContexto({ erp: { ventas_mes: { cantidad: 1, total: 50_000 } } });

  assert.ok(texto.includes("1 venta por"));
  assert.ok(!texto.includes("1 ventas"));
});

test("los ceros no ocupan lugar en el prompt", () => {
  const texto = textoContexto({
    erp: { ventas_mes: { cantidad: 3, total: 90_000 }, por_cobrar: 0, por_pagar: 0 },
  });

  assert.ok(texto.includes("3 ventas"));
  assert.ok(!texto.includes("le deben"));
  assert.ok(!texto.includes("debe "));
});

test("lo que está por faltar se nombra con su saldo", () => {
  const texto = textoContexto({
    erp: { bajo_minimo: [{ nombre: "Harina", stock: 2 }, { nombre: "Levadura", stock: 0 }] },
  });

  assert.ok(texto.includes("Harina (2)"));
  assert.ok(texto.includes("Levadura (0)"));
});

test("el módulo que no está contratado no aparece", () => {
  // La base devuelve la clave ausente, no en cero, cuando no hay módulo.
  const texto = textoContexto({
    finanzas: [{ moneda: "PYG", ingresos_mes: 100_000, gastos_mes: 0, neto_mes: 100_000 }],
  });

  assert.ok(texto.includes("PYG"));
  assert.ok(!texto.toLowerCase().includes("oportunidades"));
  assert.ok(!texto.toLowerCase().includes("negocio este mes"));
});

test("una tarea de seguimiento se dice en singular", () => {
  const texto = textoContexto({ crm: { actividades_pendientes: 1 } });

  assert.ok(texto.includes("1 tarea de seguimiento"));
  assert.ok(!texto.includes("1 tareas"));
});
