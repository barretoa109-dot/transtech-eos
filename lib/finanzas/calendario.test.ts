import assert from "node:assert/strict";
import test from "node:test";

import { correrSaldo, primerApriete, type EventoCalendario } from "./calendario.ts";

function evento(
  fecha: string,
  descripcion: string,
  monto: number,
  direccion: "entra" | "sale" = "sale",
): EventoCalendario {
  return { fecha, descripcion, monto, direccion, fuente: "anotado" };
}

test("el saldo se corre evento por evento", () => {
  const filas = correrSaldo({
    eventos: [
      evento("2026-09-10", "Alquiler", 2_000_000),
      evento("2026-09-30", "Sueldo", 6_000_000, "entra"),
      evento("2026-09-15", "Cuota del auto", 1_100_000),
    ],
    saldoInicial: 3_500_000,
    reservaMinima: 0,
  });

  // Ordenados por fecha, no por el orden en que llegaron.
  assert.deepEqual(
    filas.map((f) => f.descripcion),
    ["Alquiler", "Cuota del auto", "Sueldo"],
  );

  assert.equal(filas[0].saldo, 1_500_000);
  assert.equal(filas[1].saldo, 400_000);
  assert.equal(filas[2].saldo, 6_400_000);
});

test("el corte por horizonte esconde filas pero NO deshace su efecto", () => {
  /*
   * El error que esta prueba existe para impedir.
   *
   * Si el saldo se acumulara solo sobre los eventos visibles, alguien que mira
   * 7 días vería el saldo de una cuenta que empieza hoy en vez del suyo. Y
   * sería creíble: el número tendría la forma correcta y estaría mal.
   *
   * Acá el alquiler del 10 ya salió; mirar solo hasta el 20 no lo devuelve.
   */
  const eventos = [
    evento("2026-09-10", "Alquiler", 2_000_000),
    evento("2026-09-18", "Internet", 180_000),
    evento("2026-09-25", "Tarjeta", 1_300_000),
  ];

  const corto = correrSaldo({ eventos, saldoInicial: 3_000_000, reservaMinima: 0, hasta: "2026-09-20" });
  const largo = correrSaldo({ eventos, saldoInicial: 3_000_000, reservaMinima: 0 });

  assert.equal(corto.length, 2);
  assert.equal(corto[corto.length - 1].descripcion, "Internet");

  // El saldo del último visible es el MISMO en los dos horizontes.
  assert.equal(corto[1].saldo, 820_000);
  assert.equal(largo[1].saldo, 820_000);
});

test("marca el primer día en que no alcanza, con nombre y fecha", () => {
  const filas = correrSaldo({
    eventos: [
      evento("2026-09-10", "Alquiler", 2_000_000),
      evento("2026-09-15", "Cuota del auto", 1_100_000),
      evento("2026-09-30", "Sueldo", 6_000_000, "entra"),
    ],
    saldoInicial: 3_500_000,
    reservaMinima: 1_000_000,
  });

  const apriete = primerApriete(filas);

  assert.ok(apriete);
  // No es el alquiler: después del alquiler quedan 1.500.000, todavía sobre el
  // colchón. Es la cuota, que lo cruza.
  assert.equal(apriete.descripcion, "Cuota del auto");
  assert.equal(apriete.fecha, "2026-09-15");
  assert.equal(apriete.saldo, 400_000);
});

test("cuando el mes cierra bien, no hay apriete que mostrar", () => {
  // El resultado esperado la mayoría de los meses. Un calendario que siempre
  // encuentra algo que avisar enseña a ignorar los avisos.
  const filas = correrSaldo({
    eventos: [evento("2026-09-10", "Alquiler", 500_000)],
    saldoInicial: 3_000_000,
    reservaMinima: 1_000_000,
  });

  assert.equal(primerApriete(filas), null);
});

test("sin eventos no falla ni inventa filas", () => {
  const filas = correrSaldo({ eventos: [], saldoInicial: 1_000_000, reservaMinima: 0 });
  assert.deepEqual(filas, []);
  assert.equal(primerApriete(filas), null);
});
