import assert from "node:assert/strict";
import { test } from "node:test";

import {
  codigoDeAprobacion,
  conInstruccionesDeWhatsapp,
  leerRespuestaDeAprobacion,
  resumenDeAccion,
  textoDeAprobaciones,
  textoDelResultado,
} from "./aprobacion.ts";

const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";

test("el código es de 6 dígitos, estable y distinto por aprobación y por secreto", () => {
  const c = codigoDeAprobacion(A, "s1");
  assert.match(c, /^\d{6}$/);
  assert.equal(codigoDeAprobacion(A, "s1"), c);
  assert.notEqual(codigoDeAprobacion(B, "s1"), c);
  assert.notEqual(codigoDeAprobacion(A, "s2"), c);
});

test("lee SÍ/NO con el código, con o sin tilde, coma o punto", () => {
  assert.deepEqual(leerRespuestaDeAprobacion("SÍ 482913"), { decision: "approved", codigo: "482913" });
  assert.deepEqual(leerRespuestaDeAprobacion("si, 482913."), { decision: "approved", codigo: "482913" });
  assert.deepEqual(leerRespuestaDeAprobacion("  No 482913 "), { decision: "rejected", codigo: "482913" });
  assert.deepEqual(leerRespuestaDeAprobacion("aprobar 482913"), { decision: "approved", codigo: "482913" });
});

test("un sí suelto, sin código o dentro de otra frase, no aprueba nada", () => {
  for (const t of ["sí", "si dale", "SÍ 4829", "si 482913 y además vendí 3 bolsas", "vendí 482913", "482913", "no sé 482913"]) {
    assert.equal(leerRespuestaDeAprobacion(t), null, t);
  }
});

test("el resumen dice qué se aprueba con los datos de la acción", () => {
  const venta = resumenDeAccion("REGISTRAR_VENTA", {
    datos: { items: [{ producto: "Balanceado", cantidad: 3 }], contacto: "Juan Pérez" },
  });
  assert.equal(venta, "Registrar una venta: 3 Balanceado · con Juan Pérez");
  assert.equal(resumenDeAccion("REGISTRAR_PAGO_DEUDA", { acreedor: "Ueno", monto: 450000 }), "Anotar un pago de deuda: Ueno · ₲ 450.000");
  assert.equal(resumenDeAccion("ALGO_NUEVO", null), "algo nuevo");
});

test("las instrucciones llevan el resumen, el código y el vencimiento; las vencidas no", () => {
  const ahora = Date.parse("2026-10-01T12:00:00Z");
  const texto = textoDeAprobaciones(
    [
      { id: A, accion: "REGISTRAR_VENTA", payload_snapshot: { datos: { items: [{ producto: "Harina", cantidad: 2 }] } }, expires_at: "2026-10-01T12:45:00Z" },
      { id: B, accion: "REGISTRAR_COMPRA", payload_snapshot: {}, expires_at: "2026-10-01T11:00:00Z" },
    ],
    "s",
    ahora,
  );
  assert.match(texto, /Registrar una venta: 2 Harina/);
  assert.match(texto, new RegExp(`SÍ ${codigoDeAprobacion(A, "s")}`));
  assert.match(texto, new RegExp(`NO ${codigoDeAprobacion(A, "s")}`));
  assert.match(texto, /vence en 45 min/);
  assert.doesNotMatch(texto, /compra/);
  assert.equal(textoDeAprobaciones([], "s"), "");
});

test("por WhatsApp el enlace a la web se cambia por las instrucciones", () => {
  const respuesta = "Entendí la venta.\n\nPara completar el registro, revisá y aprobá la operación pendiente en https://www.transtech.com.py/eos/autonomy";
  const r = conInstruccionesDeWhatsapp(respuesta, "Esto quedó esperando tu OK…");
  assert.equal(r, "Entendí la venta.\n\nEsto quedó esperando tu OK…");
  assert.equal(conInstruccionesDeWhatsapp(respuesta, ""), respuesta);
});

test("el resultado dice lo que pasó de verdad", () => {
  assert.match(textoDelResultado("ejecutada", "REGISTRAR_VENTA"), /aprobado y registrado/);
  assert.match(textoDelResultado("rechazada", "REGISTRAR_VENTA"), /No se registró nada/);
  assert.match(textoDelResultado("no_ejecutada", "REGISTRAR_VENTA"), /No está registrado/);
  assert.match(textoDelResultado("vencida", "REGISTRAR_VENTA"), /no se hizo nada/);
  assert.doesNotMatch(textoDelResultado("no_revalidada", "X"), /registrado\./);
});
