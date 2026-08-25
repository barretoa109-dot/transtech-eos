import assert from "node:assert/strict";
import { test } from "node:test";

import { detectarRiesgo, redactarAviso } from "./riesgo.ts";
import type { MovimientoProyectado } from "./recurrencia.ts";

function gasto(fecha: string, monto: number, descripcion = "Alquiler"): MovimientoProyectado {
  return { tipo: "gasto", descripcion, monto, fecha, periodicidad: "mensual", confianza: 0.9 };
}

function ingreso(fecha: string, monto: number, descripcion = "Sueldo"): MovimientoProyectado {
  return { tipo: "ingreso", descripcion, monto, fecha, periodicidad: "mensual", confianza: 0.9 };
}

const HOY = "2026-08-24";

test("avisa el día exacto en que la plata no alcanza", () => {
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 3_000_000,
    reservaMinima: 0,
    egresos: [gasto("2026-08-28", 3_500_000)],
    ingresos: [],
  });

  assert.equal(riesgo?.fecha, "2026-08-28");
  assert.equal(riesgo?.faltante, 500_000);
  assert.equal(riesgo?.dias, 4);
  assert.equal(riesgo?.gatillo.descripcion, "Alquiler");
});

test("no avisa cuando el ingreso llega antes del gasto", () => {
  // Sin contar los ingresos, esto sería una alerta falsa — y una alerta falsa
  // enseña a ignorar las alertas.
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 3_000_000,
    reservaMinima: 0,
    egresos: [gasto("2026-08-28", 3_500_000)],
    ingresos: [ingreso("2026-08-25", 5_000_000)],
  });

  assert.equal(riesgo, null);
});

test("un ingreso el MISMO día no salva el gasto de ese día", () => {
  // No se puede dar por sentado que la acreditación llegue antes que el
  // débito. Avisar de un aprieto que se resuelve solo es más barato que
  // callarse uno real.
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 3_000_000,
    reservaMinima: 0,
    egresos: [gasto("2026-08-28", 3_500_000)],
    ingresos: [ingreso("2026-08-28", 5_000_000)],
  });

  assert.equal(riesgo?.fecha, "2026-08-28");
  assert.equal(riesgo?.alivio, null);
});

test("la reserva mínima es la línea, no el cero", () => {
  // El usuario declaró que quiere mantener 1.000.000 intocables. Bajar a
  // 800.000 ya es cruzar su propia regla, aunque no sea quedarse sin plata.
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 3_000_000,
    reservaMinima: 1_000_000,
    egresos: [gasto("2026-08-28", 2_200_000)],
    ingresos: [],
  });

  assert.equal(riesgo?.faltante, 200_000);
});

test("no alarma por algo que pasa dentro de tres meses", () => {
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 1_000_000,
    reservaMinima: 0,
    egresos: [gasto("2026-11-28", 5_000_000)],
    ingresos: [],
  });

  assert.equal(riesgo, null);
});

test("avisa del PRIMER problema, no de los cuatro que vienen", () => {
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 1_000_000,
    reservaMinima: 0,
    egresos: [
      gasto("2026-09-10", 900_000, "Colegio"),
      gasto("2026-08-28", 1_200_000, "Alquiler"),
      gasto("2026-09-05", 500_000, "Cuota"),
    ],
    ingresos: [],
  });

  assert.equal(riesgo?.fecha, "2026-08-28");
  assert.equal(riesgo?.gatillo.descripcion, "Alquiler");
});

test("dice cuántos días tarde llega el próximo ingreso", () => {
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 1_000_000,
    reservaMinima: 0,
    egresos: [gasto("2026-08-28", 1_200_000)],
    ingresos: [ingreso("2026-08-30", 5_000_000)],
  });

  assert.equal(riesgo?.alivio?.dias_tarde, 2);
  assert.equal(riesgo?.alivio?.fecha, "2026-08-30");
});

test("sin problemas a la vista devuelve null y nadie recibe nada", () => {
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 10_000_000,
    reservaMinima: 1_000_000,
    egresos: [gasto("2026-08-28", 1_200_000)],
    ingresos: [ingreso("2026-09-05", 5_000_000)],
  });

  assert.equal(riesgo, null);
});

/* ============================ TONO ============================ */

test("el aviso dice cuánto falta, para qué y cuándo entra plata", () => {
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 1_000_000,
    reservaMinima: 0,
    egresos: [gasto("2026-08-28", 1_500_000, "Alquiler")],
    ingresos: [ingreso("2026-08-30", 5_000_000)],
  })!;

  assert.equal(
    redactarAviso(riesgo),
    "El 28 te va a faltar ₲ 500.000 para alquiler. Tu próximo ingreso previsto entra 2 días después, el 30.",
  );
});

test("sin ingreso previsto NO inventa un consuelo", () => {
  // Decir "ya se va a acomodar" cuando no hay nada previsto es mentirle al
  // usuario, y la confianza es lo único que este producto vende.
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 1_000_000,
    reservaMinima: 0,
    egresos: [gasto("2026-08-28", 1_500_000, "Alquiler")],
    ingresos: [],
  })!;

  assert.match(redactarAviso(riesgo), /No tengo ningún ingreso previsto antes de esa fecha\./);
});

test("el aviso NUNCA culpa al usuario", () => {
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 100_000,
    reservaMinima: 0,
    egresos: [gasto("2026-08-25", 900_000, "Cuota 3 de 12 — Banco Itaú")],
    ingresos: [],
  })!;

  const aviso = redactarAviso(riesgo);
  for (const palabra of ["gastaste", "deberías", "controlá", "demasiado", "mal"]) {
    assert.ok(!aviso.toLowerCase().includes(palabra), `el aviso no puede decir "${palabra}": ${aviso}`);
  }
});

test("mañana se dice mañana, no 'el 25'", () => {
  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: 100_000,
    reservaMinima: 0,
    egresos: [gasto("2026-08-25", 900_000, "Alquiler")],
    ingresos: [],
  })!;

  assert.match(redactarAviso(riesgo), /^Mañana te va a faltar/);
});
