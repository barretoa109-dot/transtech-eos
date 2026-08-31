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
      ventas_mes: { cantidad: 0, por_moneda: [] },
      por_cobrar_monedas: [],
      por_pagar_monedas: [],
      bajo_minimo: [],
      mas_vendidos: [],
    },
    crm: {
      oportunidades_abiertas: { cantidad: 0, por_moneda: [] },
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
  assert.ok(texto.includes("US$"));

  // 5.000.000 + 400 no debe aparecer nunca como un solo número.
  assert.ok(!texto.includes("5000400"));
});

test("las ventas, lo que le deben y lo que debe salen en una línea", () => {
  const texto = textoContexto({
    erp: {
      ventas_mes: { cantidad: 12, por_moneda: [{ moneda: "PYG", total: 3_400_000 }] },
      por_cobrar_monedas: [{ moneda: "PYG", total: 800_000 }],
      por_pagar_monedas: [{ moneda: "PYG", total: 250_000 }],
    },
  });

  assert.ok(texto.includes("12 ventas"));
  assert.ok(texto.includes("le deben"));
  assert.ok(texto.includes("debe "));
});

test("una sola venta se dice en singular", () => {
  const texto = textoContexto({
    erp: { ventas_mes: { cantidad: 1, por_moneda: [{ moneda: "PYG", total: 50_000 }] } },
  });

  assert.ok(texto.includes("1 venta por"));
  assert.ok(!texto.includes("1 ventas"));
});

test("los ceros no ocupan lugar en el prompt", () => {
  const texto = textoContexto({
    erp: {
      ventas_mes: { cantidad: 3, por_moneda: [{ moneda: "PYG", total: 90_000 }] },
      por_cobrar_monedas: [],
      por_pagar_monedas: [{ moneda: "PYG", total: 0 }],
    },
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

// ============================================================
// Lo que motivó la v94: EOS le decía al usuario un número falso
// ============================================================
//
// La base sumaba `total` de todas las ventas sin mirar la moneda, y esto lo
// imprimía con "PYG" escrito a mano. Un negocio con Gs. 3.000.000 y USD 500
// escuchaba "vendiste Gs. 3.000.500" — dicho por el asistente, con la
// autoridad de una respuesta y sin ninguna etiqueta que lo delatara.

test("las ventas en dos monedas se dicen en dos monedas, nunca sumadas", () => {
  const texto = textoContexto({
    erp: {
      ventas_mes: {
        cantidad: 8,
        por_moneda: [
          { moneda: "PYG", total: 3_000_000 },
          { moneda: "USD", total: 500 },
        ],
      },
    },
  });

  assert.ok(texto.includes("8 ventas"));
  assert.ok(texto.includes("₲"));
  assert.ok(texto.includes("US$"));

  // El número que no puede existir: 3.000.000 + 500.
  assert.ok(!texto.includes("3.000.500"));
  assert.ok(!texto.includes("3000500"));
});

test("lo que le deben y lo que debe también salen por moneda", () => {
  const texto = textoContexto({
    erp: {
      por_cobrar_monedas: [
        { moneda: "PYG", total: 1_000_000 },
        { moneda: "USD", total: 200 },
      ],
      por_pagar_monedas: [{ moneda: "USD", total: 90 }],
    },
  });

  assert.ok(texto.includes("le deben"));
  assert.ok(texto.includes("US$"));
  assert.ok(!texto.includes("1.000.200"));
});

test("el embudo del CRM tampoco mezcla monedas", () => {
  const texto = textoContexto({
    crm: {
      oportunidades_abiertas: {
        cantidad: 2,
        por_moneda: [
          { moneda: "PYG", monto: 5_000_000 },
          { moneda: "USD", monto: 10_000 },
        ],
      },
    },
  });

  assert.ok(texto.includes("2 abiertas"));
  assert.ok(texto.includes("US$"));
  assert.ok(!texto.includes("5.010.000"));
});

test("una cifra sin monedas con plata se dice sin monto, no en cero", () => {
  const texto = textoContexto({
    erp: { ventas_mes: { cantidad: 4, por_moneda: [] } },
  });

  assert.ok(texto.includes("4 ventas"));
  assert.ok(!texto.includes(" por "));
});

test("una forma escalar legada de la RPC no derriba todo el chat", () => {
  const legado = {
    finanzas: 0,
    erp: {
      ventas_mes: { cantidad: 2, por_moneda: 125_000 },
      por_cobrar_monedas: 80_000,
      por_pagar_monedas: { moneda: "PYG", total: 25_000 },
      bajo_minimo: { nombre: "Harina", stock: 1 },
      mas_vendidos: "Harina",
    },
  } as unknown as ContextoNegocio;

  assert.doesNotThrow(() => textoContexto(legado));
  assert.equal(textoContexto(legado), "Negocio este mes: 2 ventas.");
});
