import assert from "node:assert/strict";
import { test } from "node:test";

import { convieneAvisar, TITULO_AVISO } from "./avisos.ts";
import type { Riesgo } from "./riesgo.ts";

function riesgo(parcial: Partial<Riesgo> = {}): Riesgo {
  return {
    fecha: "2026-08-28",
    dias: 4,
    faltante: 500_000,
    gatillo: { descripcion: "Alquiler", monto: 2_000_000 },
    alivio: null,
    ...parcial,
  };
}

test("la primera vez siempre se avisa", () => {
  assert.equal(convieneAvisar(riesgo(), null), true);
});

test("NO se repite el mismo aviso al día siguiente", () => {
  // El detector encuentra el mismo problema todos los días hasta que llega la
  // fecha. Repetirlo entrena al usuario a ignorar las notificaciones.
  const previo = { fecha_riesgo: "2026-08-28", faltante: 500_000 };

  assert.equal(convieneAvisar(riesgo(), previo), false);
});

test("un empeoramiento chico tampoco amerita otro mensaje", () => {
  // Que falten 200.000 más no es una noticia nueva: es la misma noticia con
  // otro número.
  const previo = { fecha_riesgo: "2026-08-28", faltante: 500_000 };

  assert.equal(convieneAvisar(riesgo({ faltante: 700_000 }), previo), false);
});

test("si falta el doble, sí se vuelve a avisar", () => {
  const previo = { fecha_riesgo: "2026-08-28", faltante: 500_000 };

  assert.equal(convieneAvisar(riesgo({ faltante: 1_000_000 }), previo), true);
});

test("otra fecha es otro problema", () => {
  // El anterior se resolvió o ya pasó; este es nuevo.
  const previo = { fecha_riesgo: "2026-08-28", faltante: 900_000 };

  assert.equal(convieneAvisar(riesgo({ fecha: "2026-09-15", faltante: 300_000 }), previo), true);
});

test("el título del push no lleva cifras", () => {
  // Se ve en la pantalla bloqueada, delante de quien esté al lado. El monto va
  // en el cuerpo, que exige desbloquear.
  assert.ok(!/\d/.test(TITULO_AVISO), `el título no puede traer números: ${TITULO_AVISO}`);
});
