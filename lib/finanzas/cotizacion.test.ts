import assert from "node:assert/strict";
import { test } from "node:test";

import { cotizacionConfigurada, leerNumeroDeCsv, obtenerDeGoogleSheet } from "./cotizacion.ts";

test("lee un número simple, sin comillas", () => {
  assert.equal(leerNumeroDeCsv("7350.5"), 7350.5);
});

test("lee un número entre comillas, como lo publica Sheets", () => {
  assert.equal(leerNumeroDeCsv('"7350.5"\r\n'), 7350.5);
});

test("ignora las comas de miles", () => {
  assert.equal(leerNumeroDeCsv("7,350.5"), 7350.5);
});

test("lee el primer número si hay una etiqueta al lado", () => {
  assert.equal(leerNumeroDeCsv("USDPYG,7350.5"), 7350.5);
});

test("un texto sin ningún número da null", () => {
  assert.equal(leerNumeroDeCsv("#N/A"), null);
  assert.equal(leerNumeroDeCsv(""), null);
  assert.equal(leerNumeroDeCsv("<html>error</html>"), null);
});

test("un cero o un negativo no es una cotización válida", () => {
  assert.equal(leerNumeroDeCsv("0"), null);
  assert.equal(leerNumeroDeCsv("-5"), null);
});

test("sin la variable de entorno, no está configurada", () => {
  const antes = process.env.GOOGLE_SHEET_COTIZACION_URL;
  delete process.env.GOOGLE_SHEET_COTIZACION_URL;
  try {
    assert.equal(cotizacionConfigurada(), false);
  } finally {
    if (antes !== undefined) process.env.GOOGLE_SHEET_COTIZACION_URL = antes;
  }
});

test("con la variable puesta, está configurada", () => {
  const antes = process.env.GOOGLE_SHEET_COTIZACION_URL;
  process.env.GOOGLE_SHEET_COTIZACION_URL = "https://ejemplo.invalid/cotizacion.csv";
  try {
    assert.equal(cotizacionConfigurada(), true);
  } finally {
    if (antes === undefined) delete process.env.GOOGLE_SHEET_COTIZACION_URL;
    else process.env.GOOGLE_SHEET_COTIZACION_URL = antes;
  }
});

test("obtenerDeGoogleSheet da null si la respuesta no es ok", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  try {
    assert.equal(await obtenerDeGoogleSheet("https://ejemplo.invalid/cotizacion.csv"), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("obtenerDeGoogleSheet da null si el fetch tira una excepción, no la deja caer", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("red caída");
  }) as typeof fetch;
  try {
    assert.equal(await obtenerDeGoogleSheet("https://ejemplo.invalid/cotizacion.csv"), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("obtenerDeGoogleSheet lee el número de una respuesta real", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('"7350.5"')) as typeof fetch;
  try {
    assert.equal(await obtenerDeGoogleSheet("https://ejemplo.invalid/cotizacion.csv"), 7350.5);
  } finally {
    globalThis.fetch = original;
  }
});
