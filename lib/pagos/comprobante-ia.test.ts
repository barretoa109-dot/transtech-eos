import assert from "node:assert/strict";
import test from "node:test";

import { evaluarComprobante, interpretarLectura, leerComprobante, type LecturaComprobante } from "./comprobante-ia.ts";

const ESPERADO = { monto: 150000, cuenta: "12-345678-09", titular: "TRANSTECH E.A.S.", ruc: "80000000-1", hoy: "2026-11-15" };

const BUENA: LecturaComprobante = {
  es_comprobante: true,
  banco_destino: "Banco Continental",
  cuenta_destino: "1234567809",
  titular_destino: "Transtech E.A.S.",
  monto: 150000,
  moneda: "PYG",
  fecha: "2026-11-15",
  numero_operacion: "987654",
  estado_operacion: "exitosa",
};

test("cuenta, monto, fecha y operación correctos: coincide", () => {
  assert.equal(evaluarComprobante(BUENA, ESPERADO).resultado, "coincide");
});

test("sin lectura, lo mira una persona", () => {
  assert.equal(evaluarComprobante(null, ESPERADO).resultado, "dudoso");
});

test("una foto cualquiera no es un comprobante", () => {
  assert.equal(evaluarComprobante({ ...BUENA, es_comprobante: false }, ESPERADO).resultado, "no_coincide");
});

test("otra cuenta de destino no coincide, aunque el monto esté bien", () => {
  const v = evaluarComprobante({ ...BUENA, cuenta_destino: "9999999999", titular_destino: "Juan Pérez" }, ESPERADO);
  assert.equal(v.resultado, "no_coincide");
  assert.match(v.motivos.join(" "), /cuenta de destino/);
});

test("menos plata no coincide; más plata lo mira una persona", () => {
  assert.equal(evaluarComprobante({ ...BUENA, monto: 15000 }, ESPERADO).resultado, "no_coincide");
  assert.equal(evaluarComprobante({ ...BUENA, monto: 200000 }, ESPERADO).resultado, "dudoso");
});

test("operación rechazada no coincide; pendiente es dudosa", () => {
  assert.equal(evaluarComprobante({ ...BUENA, estado_operacion: "rechazada" }, ESPERADO).resultado, "no_coincide");
  assert.equal(evaluarComprobante({ ...BUENA, estado_operacion: "pendiente" }, ESPERADO).resultado, "dudoso");
});

test("cuenta a medias, comprobante viejo, sin fecha o sin número de operación: dudoso, nunca coincide", () => {
  for (const cambio of [
    { cuenta_destino: "****7809" },
    { cuenta_destino: null },
    { fecha: "2026-11-01" },
    { fecha: null },
    { numero_operacion: null },
    { monto: null },
    { moneda: "USD" },
  ] as Partial<LecturaComprobante>[]) {
    assert.equal(evaluarComprobante({ ...BUENA, ...cambio }, ESPERADO).resultado, "dudoso", JSON.stringify(cambio));
  }
});

test("un comprobante del viernes subido el domingo sigue valiendo", () => {
  assert.equal(evaluarComprobante({ ...BUENA, fecha: "2026-11-13" }, ESPERADO).resultado, "coincide");
});

test("la respuesta del modelo se limpia: monto con puntos, fecha rara, estado desconocido", () => {
  const l = interpretarLectura('Acá va: {"es_comprobante": true, "monto": "150.000", "fecha": "15/11/2026", "estado_operacion": "ok", "cuenta_destino": " 123 "}');
  assert.equal(l?.monto, 150000);
  assert.equal(l?.fecha, null);
  assert.equal(l?.estado_operacion, "desconocido");
  assert.equal(l?.cuenta_destino, "123");
  assert.equal(interpretarLectura("no hay json"), null);
  assert.equal(interpretarLectura('{"monto": 5}'), null);
});

test("sin clave o con un PDF no se llama al proveedor", async () => {
  let llamadas = 0;
  const fetcher = (async () => { llamadas += 1; return new Response("{}"); }) as typeof fetch;
  assert.equal(await leerComprobante({ mime: "image/png", base64: "AAAA" }, { env: {}, fetcher }), null);
  assert.equal(await leerComprobante({ mime: "application/pdf", base64: "AAAA" }, { env: { OPENAI_API_KEY: "x" }, fetcher }), null);
  assert.equal(llamadas, 0);
});

test("con clave, lee lo que devuelve el proveedor", async () => {
  const fetcher = (async () =>
    new Response(JSON.stringify({ output_text: JSON.stringify(BUENA) }), { status: 200 })) as typeof fetch;
  const l = await leerComprobante({ mime: "image/jpeg", base64: "AAAA" }, { env: { OPENAI_API_KEY: "x" }, fetcher });
  assert.equal(l?.monto, 150000);
});
