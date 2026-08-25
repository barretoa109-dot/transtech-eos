import assert from "node:assert/strict";
import { test } from "node:test";

import { ADVERTENCIA, elegirEstrategia, redactarNegociacion } from "./negociacion.ts";
import type { Deuda } from "./deudas.ts";

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
    tasa_anual: null,
    vence_el: null,
    estado: "al_dia",
    preocupa: false,
    ...parcial,
  } as Deuda;
}

/* ==================== LA ESTRATEGIA ==================== */

test("si la plata llega en unos días, se pide prórroga y no se toca el crédito", () => {
  const estrategia = elegirEstrategia({
    cuota: 500_000,
    disponible: 100_000,
    proximoIngreso: { fecha: "2026-09-02", dias: 5 },
    capacidadMensual: 800_000,
  });

  assert.equal(estrategia, "prorroga");
});

test("si la cuota no entra en el mes, se refinancia en vez de patear 30 días", () => {
  // Pedir prórroga cuando el problema es estructural repite el mismo aprieto
  // el mes que viene, con un atraso más encima.
  const estrategia = elegirEstrategia({
    cuota: 900_000,
    disponible: 400_000,
    proximoIngreso: null,
    capacidadMensual: 500_000,
  });

  assert.equal(estrategia, "refinanciacion");
});

test("con una parte cubierta se propone pago parcial", () => {
  const estrategia = elegirEstrategia({
    cuota: 500_000,
    disponible: 300_000,
    proximoIngreso: null,
    capacidadMensual: 600_000,
  });

  assert.equal(estrategia, "pago_parcial");
});

test("una miseria disponible no se ofrece como pago parcial", () => {
  // Ofrecer el 5% de la cuota no compra buena voluntad: parece un gesto vacío.
  const estrategia = elegirEstrategia({
    cuota: 500_000,
    disponible: 25_000,
    proximoIngreso: null,
    capacidadMensual: 600_000,
  });

  assert.equal(estrategia, "refinanciacion");
});

/* ==================== EL TEXTO ==================== */

test("la prórroga propone una fecha concreta y se compromete a pagar todo", () => {
  const n = redactarNegociacion({
    deuda: deuda(),
    disponible: 100_000,
    capacidadMensual: 800_000,
    proximoIngreso: { fecha: "2026-09-02", dias: 5 },
  });

  assert.equal(n.estrategia, "prorroga");
  assert.match(n.mensaje, /2 de septiembre/);
  assert.match(n.mensaje, /Gs\. 500\.000/);
});

test("el pago parcial dice cuánto ahora y cuánto después", () => {
  const n = redactarNegociacion({
    deuda: deuda({ cuota_monto: 500_000 }),
    disponible: 300_000,
    capacidadMensual: 600_000,
    proximoIngreso: null,
  });

  assert.match(n.mensaje, /Gs\. 300\.000/);
  assert.match(n.mensaje, /Gs\. 200\.000/);
});

test("la refinanciación propone una cuota que SÍ entra en la capacidad", () => {
  // Prometer una cuota que no se puede pagar es conseguir el mismo problema
  // dentro de dos meses, con la credibilidad gastada.
  const n = redactarNegociacion({
    deuda: deuda({ cuota_monto: 900_000 }),
    disponible: 200_000,
    capacidadMensual: 350_000,
    proximoIngreso: null,
  });

  assert.equal(n.estrategia, "refinanciacion");
  assert.match(n.mensaje, /Gs\. 350\.000/);
});

test("sin capacidad NO promete ningún monto: pide una reunión", () => {
  const n = redactarNegociacion({
    deuda: deuda(),
    disponible: 0,
    capacidadMensual: 0,
    proximoIngreso: null,
  });

  assert.match(n.mensaje, /reestructurar/);
  assert.ok(!/cuota mensual de hasta/.test(n.mensaje), n.mensaje);
});

test("el mensaje NO cuenta la vida privada del usuario", () => {
  // El usuario no le debe a su acreedor una confesión, y dar motivos invita a
  // que se los evalúe.
  const casos = [
    redactarNegociacion({ deuda: deuda(), disponible: 100_000, capacidadMensual: 800_000, proximoIngreso: { fecha: "2026-09-02", dias: 5 } }),
    redactarNegociacion({ deuda: deuda(), disponible: 300_000, capacidadMensual: 600_000, proximoIngreso: null }),
    redactarNegociacion({ deuda: deuda({ cuota_monto: 900_000 }), disponible: 0, capacidadMensual: 300_000, proximoIngreso: null }),
  ];

  for (const n of casos) {
    for (const frase of ["momento difícil", "situación personal", "problema familiar", "lamento", "disculpas"]) {
      assert.ok(
        !n.mensaje.toLowerCase().includes(frase),
        `el mensaje no puede decir "${frase}":\n${n.mensaje}`,
      );
    }
  }
});

test("cada borrador viene con la explicación de por qué esa estrategia", () => {
  const n = redactarNegociacion({
    deuda: deuda({ cuota_monto: 900_000 }),
    disponible: 0,
    capacidadMensual: 300_000,
    proximoIngreso: null,
  });

  assert.ok(n.porque.length > 30, n.porque);
  assert.match(n.porque, /no entra/);
});

test("la firma solo aparece si hay nombre", () => {
  const sinNombre = redactarNegociacion({
    deuda: deuda(),
    disponible: 300_000,
    capacidadMensual: 600_000,
    proximoIngreso: null,
  });
  const conNombre = redactarNegociacion({
    deuda: deuda(),
    disponible: 300_000,
    capacidadMensual: 600_000,
    proximoIngreso: null,
    nombreUsuario: "Augusto Galeano",
  });

  assert.ok(!sinNombre.mensaje.includes("Saludos cordiales"));
  assert.match(conNombre.mensaje, /Saludos cordiales,\nAugusto Galeano$/);
});

test("la advertencia deja claro que EOS no lo manda", () => {
  assert.match(ADVERTENCIA, /no se envía solo/);
});
