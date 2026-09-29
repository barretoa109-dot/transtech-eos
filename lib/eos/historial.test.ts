import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TOPE, aplicar01, aplicar03 } from "../../n8n/parches/cambios-historial-de-la-sesion.mjs";
import { TURNOS_DE_HISTORIAL } from "../gateway/entrada.ts";
import {
  HISTORIAL_BASE,
  HISTORIAL_MAXIMO,
  MAX_TEXTO_HISTORIAL,
  SESION_MS,
  enOrdenDeTurno,
  fechaDeFila,
  historialDeLaSesion,
} from "./historial.ts";

/**
 * La tarde de Sofía (29/09/2026), con las horas reales de la base: la
 * conversión del zapato marrón mocha a las 17:41:43 y el pedido de sumarle el
 * envío a las 17:57:43, siete turnos después.
 */
const TARDE: Array<[string, string, string]> = [
  ["17:41:20.826678", "Pasar a guaranies ⏎ Dolar 6.014,84", "Chaleco de encaje negro M: USD 17,12 × 6.014,84 = ₲102.974"],
  ["17:41:43.780778", "Pasar a guaranies ⏎ Dolar 6.014,85", "Zapatos ADAMUMU marrón mocha: USD 14,92 × 6.014,85 = ₲89.742"],
  ["17:42:19.250808", "Pasar a guaranies dolar5.917,48", "Blusa blanca bordada: USD 10,88 × 5.917,48 = ₲64.382"],
  ["17:46:37.299376", "Agregale el costo de envio de cada blusa 16.496,5gs", "Blusa blanca bordada: ₲80.879"],
  ["17:50:42.766424", "El chaleco de encaje negro seria", "¿A cuánto lo vendés?"],
  ["17:52:15.387313", "Si y agrega el costo del envio a cada uno", "₲119.471 de costo final"],
  ["17:52:41.040117", "A cuanto deberia vender", "Yo lo publicaría a ₲190.000"],
  ["17:54:49.159428", "El M vendo a 155.000gs", "No encontré a Gladys Velilla"],
  ["17:55:21.207248", "Agenda a Gladys velilla", "El contacto quedó guardado."],
];

/** Como las devuelve la base: pregunta y respuesta con la MISMA hora, y en el orden que salga. */
function filasDeLaBase() {
  return TARDE.flatMap(([hora, usuario, eos]) => [
    { rol: "eos", texto: eos, created_at: `2026-09-29 ${hora}` },
    { rol: "usuario", texto: usuario, created_at: `2026-09-29 ${hora}` },
  ]);
}

const AHORA = fechaDeFila("2026-09-29 17:57:43.18125");

test("el caso de Sofía: la conversión de hace siete turnos llega al modelo", () => {
  const historial = historialDeLaSesion(enOrdenDeTurno(filasDeLaBase()), AHORA);

  assert.ok(
    historial.some((h) => h.texto.includes("6.014,85") && h.texto.includes("marrón mocha")),
    "el tipo de cambio del zapato quedó afuera otra vez",
  );
  assert.equal(historial.length, 18);
});

test("con la regla vieja (10 mensajes) la conversión quedaba afuera: por eso preguntó", () => {
  const viejo = enOrdenDeTurno(filasDeLaBase()).slice(-10);
  assert.equal(viejo.some((h) => h.texto.includes("6.014,85")), false);
});

test("a igual hora la pregunta va antes que su respuesta", () => {
  const ordenado = enOrdenDeTurno(filasDeLaBase());
  for (let i = 0; i < ordenado.length; i += 2) {
    assert.equal(ordenado[i].rol, "usuario", `turno ${i / 2}: la respuesta de EOS quedó antes de la pregunta`);
    assert.equal(ordenado[i + 1].rol, "eos");
    assert.equal(ordenado[i].created_at, ordenado[i + 1].created_at);
  }
  assert.equal(ordenado[0].texto, "Pasar a guaranies ⏎ Dolar 6.014,84");
  assert.equal(ordenado.at(-1)?.texto, "El contacto quedó guardado.");
});

test("la fecha sin zona de la base se lee como UTC, no como hora local", () => {
  assert.equal(fechaDeFila("2026-09-29 17:57:43"), Date.UTC(2026, 8, 29, 17, 57, 43));
  assert.equal(fechaDeFila("2026-09-29T17:57:43Z"), Date.UTC(2026, 8, 29, 17, 57, 43));
  assert.ok(Number.isNaN(fechaDeFila(null)));
});

test("una charla de ayer no se arrastra: fuera de la sesión quedan solo los últimos 10", () => {
  const ayer = Array.from({ length: 30 }, (_, i) => ({
    rol: i % 2 ? "eos" : "usuario",
    texto: `m${i}`,
    created_at: "2026-09-28 12:00:00",
  }));
  const historial = historialDeLaSesion(ayer, AHORA);
  assert.equal(historial.length, HISTORIAL_BASE);
  assert.equal(historial.at(-1)?.texto, "m29");
});

test("una sesión muy larga se corta en el tope, quedándose con lo más nuevo", () => {
  const hora = (i: number) => new Date(AHORA - SESION_MS / 2 + i * 1000).toISOString();
  const largo = Array.from({ length: 60 }, (_, i) => ({ rol: "usuario", texto: `m${i}`, created_at: hora(i) }));
  const historial = historialDeLaSesion(largo, AHORA);
  assert.equal(historial.length, HISTORIAL_MAXIMO);
  assert.equal(historial[0].texto, `m${60 - HISTORIAL_MAXIMO}`);
});

test("sin fechas (el historial de la web) entran los últimos del tope", () => {
  const web = Array.from({ length: 30 }, (_, i) => ({ rol: "usuario", texto: `m${i}` }));
  assert.equal(historialDeLaSesion(web).length, HISTORIAL_MAXIMO);
});

test("una respuesta enorme no se come el historial", () => {
  const [fila] = historialDeLaSesion([{ rol: "eos", texto: "x".repeat(10_000) }]);
  assert.ok(fila.texto.length <= MAX_TEXTO_HISTORIAL + 1);
  assert.ok(fila.texto.endsWith("…"));
});

// ---------------------------------------------------------------------------
// Los dos gateways con el mismo tope
// ---------------------------------------------------------------------------

test("el gateway en TypeScript y el parche de n8n usan el mismo tope", () => {
  assert.equal(TURNOS_DE_HISTORIAL, HISTORIAL_MAXIMO);
  assert.equal(TOPE, HISTORIAL_MAXIMO);
});

const flujo = JSON.parse(
  readFileSync(new URL("../../n8n/workflows/eos-conversational-gateway-rc1.json", import.meta.url), "utf8"),
);

function codigo(nombre: string): string {
  return flujo.nodes.find((x: { name: string }) => x.name === nombre).parameters.jsCode;
}

test("el parche de n8n sube los dos recortes a 24 y es idempotente", () => {
  for (const [nombre, aplicar] of [
    ["01 GW Preparar Entrada", aplicar01],
    ["03 GW Construir Prompt Rápido", aplicar03],
  ] as const) {
    const una = aplicar(codigo(nombre), nombre);
    assert.match(una, new RegExp(`historial\\.slice\\(-${TOPE}\\)`), `${nombre}: no quedó el tope nuevo`);
    assert.doesNotMatch(una, /historial\.slice\(-10\)/, `${nombre}: quedó un recorte a 10`);
    assert.equal(aplicar(una, nombre), una, `${nombre}: aplicarlo dos veces cambió algo`);
  }
});
