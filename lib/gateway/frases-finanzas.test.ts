import test from "node:test";
import assert from "node:assert/strict";

import {
  FUNCIONES_PARA_N8N,
  fraseDeCompraTarjeta,
  fraseDePersonal,
  fraseDeTarjeta,
} from "./frases-finanzas.ts";
import { FUNCIONES_SIN_ANUNCIOS_PARA_N8N, anunciosContradichos, esAnuncio, sinAnuncios } from "./sin-anuncios.ts";
import { juntarResultados, type Base } from "./resultados.ts";

/**
 * El caso Green del 29/09/2026, contado por las frases.
 *
 * Los resultados son los que devolvió el ejecutor REAL ese día (tomados de
 * `eos_action_commands`), más los campos que agrega la v221 (`ya_estaba`,
 * `repetidos`, `cambios`, `sin_cambios`), tal como los devolvió la prueba
 * `supabase/pruebas/finanzas_no_repite_e2e.sql` contra la base.
 */

const COMPRA = {
  id: "db9e4d8d-be8a-4e38-bd54-ab5aa79954ea",
  cuotas: 1,
  moneda: "PYG",
  tarjeta: "Green ****7450",
  descripcion: "Punto Farma",
  monto_cuota: 46000,
  monto_total: 46000,
  no_es_gasto: true,
  primera_cuota: "2026-09-29",
  cuota_estimada: false,
  cuotas_pagadas: 0,
  tarjeta_creada: false,
};

test("compra con tarjeta: qué, cuánto, en cuál y dónde verla", () => {
  const frase = fraseDeCompraTarjeta({ resultado: COMPRA })!;
  assert.ok(frase.startsWith("Anoté Punto Farma por ₲ 46.000 en Green ****7450."), frase);
  assert.match(frase, /No es un gasto de este mes/);
  assert.match(frase, /La ves en Personal › Tengo y debo › Tarjetas\./);
});

test("compra con tarjeta que ya estaba: lo dice, con la hora, y no dice 'anoté'", () => {
  const frase = fraseDeCompraTarjeta({ resultado: { ...COMPRA, ya_estaba: true, anotada_a_las: "17:34" } })!;
  assert.ok(frase.startsWith("Ya estaba anotada desde las 17:34: Punto Farma por ₲ 46.000 en Green ****7450."), frase);
  assert.match(frase, /No la anoté otra vez/);
  assert.match(frase, /"es otra"/);
  assert.doesNotMatch(frase, /^Anoté/);
});

test("compra en una tarjeta recién creada: pide el ciclo", () => {
  const frase = fraseDeCompraTarjeta({ resultado: { ...COMPRA, tarjeta: "Visa Itaú", tarjeta_creada: true } })!;
  assert.match(frase, /Visa Itaú no estaba cargada: la agregué\. Decime qué día cierra y qué día vence/);
});

test("movimientos personales: lo nuevo y lo que ya estaba, cada uno con su frase", () => {
  const nuevo = fraseDePersonal({
    resultado: {
      movimientos: [{ id: "x", tipo: "ingreso", monto: 100000, moneda: "PYG", descripcion: "Ingreso", fecha: "2026-09-29" }],
      repetidos: [],
    },
  });
  assert.equal(
    nuevo,
    "Entró ₲ 100.000 — Ingreso. Lo anoté en Personal › Mi mes › Movimientos. No toca las cuentas del negocio.",
  );

  const repetido = fraseDePersonal({
    resultado: {
      movimientos: [],
      repetidos: [
        { tipo: "gasto", monto: 22650, moneda: "PYG", descripcion: "Punto Farma - débito Ueno", fecha: "2026-09-27", como: "Punto Farma - Molas López" },
      ],
    },
  });
  assert.match(repetido, /^Ya estaba anotado: ₲ 22\.650 del 27\/09 \(figura como "Punto Farma - Molas López"\)\. No lo anoté otra vez\./);
  assert.doesNotMatch(repetido, /No quedó nada anotado/);
});

test("tarjeta: sin cambios lo dice; con cambios dice el antes y el después", () => {
  assert.equal(
    fraseDeTarjeta({ resultado: { tarjeta: "Green ****7450", moneda: "PYG", creada: false, sin_cambios: true, cambios: [] } }),
    "Green ****7450 ya estaba cargada así: no cambié nada. La ves en Personal › Tengo y debo › Tarjetas.",
  );

  const cambio = fraseDeTarjeta({
    resultado: {
      tarjeta: "Green ****7450",
      moneda: "PYG",
      creada: false,
      sin_cambios: false,
      cambios: [
        { campo: "emisor", antes: "American Express", despues: "Banco Basa" },
        { campo: "pago_minimo", antes: 188000, despues: 200000 },
      ],
    },
  })!;
  assert.match(cambio, /emisor de American Express a Banco Basa/);
  assert.match(cambio, /pago mínimo de ₲ 188\.000 a ₲ 200\.000/);
});

test("el código que viaja a n8n compila como JavaScript, sin TypeScript", () => {
  const fuente = [...FUNCIONES_PARA_N8N, ...FUNCIONES_SIN_ANUNCIOS_PARA_N8N].map((f) => f.toString()).join("\n\n");
  assert.doesNotMatch(fuente, /`/, "una comilla invertida corta el nodo de n8n");
  const fabrica = new Function(`${fuente}\nreturn { fraseDeCompraTarjeta, sinAnuncios };`);
  const { fraseDeCompraTarjeta: enN8n, sinAnuncios: sinEnN8n } = fabrica();
  assert.equal(enN8n({ resultado: COMPRA }), fraseDeCompraTarjeta({ resultado: COMPRA }));
  assert.equal(sinEnN8n("Anoté la compra. ¿Algo más?"), "¿Algo más?");
});

// ------------------------------------------------------------ sin anuncios

test("anuncios: reconoce las frases del caso real", () => {
  assert.ok(esAnuncio("Registro tres cosas en Personal: compra en Punto Farma por Gs. 46.000 con la Green."));
  assert.ok(esAnuncio("Igual, la vuelvo a mandar ahora como compra con tarjeta para que no quede perdida."));
  assert.ok(esAnuncio("Vuelvo a mandar la carga completa: tarjeta Green ****7450 de Banco Basa."));
  assert.ok(esAnuncio("La acción quedó completada."));
  assert.ok(!esAnuncio("No está ahí."));
  assert.ok(!esAnuncio("Lo correcto acá es la compra nueva de Gs. 46.000 con tu tarjeta de crédito Green."));
  assert.ok(!esAnuncio("¿Cuánto pagaste del mínimo?"));
});

test("anuncios: 'Gs. 46.000' no parte la oración", () => {
  assert.equal(
    sinAnuncios("Registro la compra por Gs. 46.000 con la Green. ¿De qué cuenta pagaste el mínimo?"),
    "¿De qué cuenta pagaste el mínimo?",
  );
});

test("anuncios: solo se sacan si lo que pasó los contradice", () => {
  assert.equal(anunciosContradichos([{ ok: true, resultado: {} }]), false);
  assert.equal(anunciosContradichos([{ ok: true }, { ok: false, error: "x" }]), true);
  assert.equal(anunciosContradichos([{ ok: true, resultado: { ya_estaba: true } }]), true);
  assert.equal(anunciosContradichos([{ ok: true, resultado: { repetidos: [{}] } }]), true);
  assert.equal(anunciosContradichos([{ ok: true, resultado: { sin_cambios: true } }]), true);
});

const BASE: Base = {
  request_id: "763dec1e-9f87-4fe2-b013-1c0c2ef28439",
  conversacion_id: "c",
  respuesta: "",
  documento: null,
  acciones: [],
  accion: "",
  metadata: {},
  tokens_entrada: 0,
  tokens_entrada_cacheados: 0,
  tokens_salida: 0,
};

test("caso Green, primer mensaje: la respuesta sale de los comprobantes, no del anuncio", () => {
  const final = juntarResultados(
    {
      ...BASE,
      respuesta:
        "Registro tres cosas en Personal: compra en Punto Farma por Gs. 46.000 con la Green, pago mínimo de la Green por Gs. 188.000, e ingreso de Gs. 100.000.",
    },
    [
      { ok: true, executed: true, accion: "REGISTRAR_COMPRA_TARJETA", respuesta: fraseDeCompraTarjeta({ resultado: COMPRA }), resultado: COMPRA },
      {
        ok: false,
        accion: "REGISTRAR_PAGO_DEUDA",
        error: "\"Green\" es una de tus tarjetas, no una deuda, así que no anoté ningún pago.",
        respuesta: "\"Green\" es una de tus tarjetas, no una deuda, así que no anoté ningún pago.",
      },
      {
        ok: true,
        executed: true,
        accion: "REGISTRAR_MOVIMIENTO_PERSONAL",
        respuesta: "Entró ₲ 100.000 — Ingreso. Lo anoté en Personal › Mi mes › Movimientos. No toca las cuentas del negocio.",
        resultado: {},
      },
    ],
  );

  assert.doesNotMatch(final.respuesta, /Registro tres cosas/);
  assert.doesNotMatch(final.respuesta, /188\.000/);
  assert.doesNotMatch(final.respuesta, /8 millones/);
  assert.match(final.respuesta, /^Anoté Punto Farma por ₲ 46\.000 en Green \*\*\*\*7450\./);
  assert.match(final.respuesta, /Entró ₲ 100\.000/);
  assert.match(final.respuesta, /no anoté ningún pago/);
});

test("todo salió bien: el texto del modelo queda como está", () => {
  const final = juntarResultados({ ...BASE, respuesta: "Registro la venta de 2 panes a Marcos por ₲ 10.000." }, [
    { ok: true, executed: true, accion: "REGISTRAR_VENTA", respuesta: "La venta quedó registrada. La ves en Negocio > Ventas.", resultado: {} },
  ]);
  assert.match(final.respuesta, /^Registro la venta de 2 panes a Marcos/);
});

test("anuncios: las palabras con tilde al final también cuentan ('anoté', 'actualicé')", () => {
  assert.ok(esAnuncio("Anoté la compra."));
  assert.ok(esAnuncio("Actualicé Green ****7450."));
  assert.ok(esAnuncio("Listo, cargué el ingreso."));
});
