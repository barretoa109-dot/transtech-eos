import assert from "node:assert/strict";
import test from "node:test";

import { configDelAgente, puedeAutoaprobar, type CasoParaAutoaprobar, type RevisionIa } from "./agente-transferencias.ts";

const COINCIDE: RevisionIa = { veredicto: "coincide", motivos: [], lectura: null, revisado_at: "2026-11-15T12:00:00Z" };
const ENCENDIDO = { autoaprueba: true, esperaMin: 15, montoMax: 500_000 };

const CASO: CasoParaAutoaprobar = {
  estado: "en_revision",
  monto: 150_000,
  revision: COINCIDE,
  minutosDesdeSubida: 20,
  operacionRepetida: false,
  autoaprobadoHaceMenosDe25Dias: false,
};

test("arranca apagado: sin la variable, el agente no activa nada", () => {
  assert.equal(configDelAgente({}).autoaprueba, false);
  assert.equal(puedeAutoaprobar(CASO, configDelAgente({})).ok, false);
});

test("la configuración toma los valores del entorno y cae a los de siempre si son raros", () => {
  assert.deepEqual(configDelAgente({ PAGOS_AGENTE_AUTOAPRUEBA: "1", PAGOS_AGENTE_ESPERA_MIN: "5", PAGOS_AGENTE_MONTO_MAX: "abc" }), {
    autoaprueba: true,
    esperaMin: 5,
    montoMax: 500_000,
  });
});

test("coincide, pasó el turno del dueño y está dentro de los topes: activa", () => {
  assert.equal(puedeAutoaprobar(CASO, ENCENDIDO).ok, true);
});

test("cada tope, por separado, alcanza para que decida el dueño", () => {
  const casos: Partial<CasoParaAutoaprobar>[] = [
    { minutosDesdeSubida: 5 },
    { monto: 600_000 },
    { operacionRepetida: true },
    { autoaprobadoHaceMenosDe25Dias: true },
    { estado: "pagado" },
    { estado: "rechazado" },
    { revision: null },
    { revision: { ...COINCIDE, veredicto: "dudoso" } },
    { revision: { ...COINCIDE, veredicto: "no_coincide" } },
  ];
  for (const cambio of casos) {
    assert.equal(puedeAutoaprobar({ ...CASO, ...cambio }, ENCENDIDO).ok, false, JSON.stringify(cambio));
  }
});
