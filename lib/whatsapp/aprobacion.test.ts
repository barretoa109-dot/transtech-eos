import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MARCA_PEDIDO_OK,
  conInstruccionesDeWhatsapp,
  esRespuestaAlPedidoDeOk,
  leerRespuestaDeAprobacion,
  resumenDeAccion,
  textoDeAprobaciones,
  textoDelResultado,
  textoDeVariosResultados,
} from "./aprobacion.ts";

const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";
const AHORA = Date.parse("2026-10-01T12:00:00Z");

test("sí / no sin código, con o sin tilde, signos o 'a todo'", () => {
  for (const t of ["sí", "Si!", "SÍ.", "dale", "ok", "listo", "sí a todo", "si todo", "de una"]) {
    assert.deepEqual(leerRespuestaDeAprobacion(t), { decision: "approved", numero: null }, t);
  }
  for (const t of ["no", "No.", "cancelá", "descartá", "no gracias", "mejor no"]) {
    assert.deepEqual(leerRespuestaDeAprobacion(t), { decision: "rejected", numero: null }, t);
  }
});

test("sí 2 / no 1: una sola de la lista", () => {
  assert.deepEqual(leerRespuestaDeAprobacion("sí 2"), { decision: "approved", numero: 2 });
  assert.deepEqual(leerRespuestaDeAprobacion("no 1"), { decision: "rejected", numero: 1 });
});

test("los avisos viejos con código siguen funcionando como sí / no", () => {
  assert.deepEqual(leerRespuestaDeAprobacion("SÍ 482913"), { decision: "approved", numero: null });
  assert.deepEqual(leerRespuestaDeAprobacion("NO 482913"), { decision: "rejected", numero: null });
});

test("dentro de una frase más larga no es una aprobación", () => {
  for (const t of ["si y además vendí 3 bolsas", "vendí 2", "no sé", "sí pero cambiale el precio", "2", ""]) {
    assert.equal(leerRespuestaDeAprobacion(t), null, t);
  }
});

test("un sí suelto aprueba SOLO si lo último que mandó EOS fue el pedido de OK", () => {
  assert.equal(esRespuestaAlPedidoDeOk(`Esto quedó ${MARCA_PEDIDO_OK} antes de hacerlo: …`), true);
  assert.equal(esRespuestaAlPedidoDeOk("¿Querés que lo anote?"), false);
  assert.equal(esRespuestaAlPedidoDeOk(null), false);
});

test("una sola acción: resumen y 'sí' o 'no', sin código", () => {
  const t = textoDeAprobaciones(
    [{ id: A, accion: "REGISTRAR_VENTA", payload_snapshot: { datos: { items: [{ producto: "Harina", cantidad: 2 }] } }, expires_at: "2026-10-01T12:45:00Z" }],
    AHORA,
  );
  assert.match(t, new RegExp(MARCA_PEDIDO_OK));
  assert.match(t, /• Registrar una venta: 2 Harina/);
  assert.match(t, /Respondé \*sí\* para hacerlo o \*no\* para descartarlo \(vence en 45 min\)/);
  assert.doesNotMatch(t, /\d{6}/);
});

test("varias: numeradas, 'sí' para todo y 'sí 2' para una; las vencidas no aparecen", () => {
  const t = textoDeAprobaciones(
    [
      { id: A, accion: "REGISTRAR_VENTA", payload_snapshot: {}, expires_at: "2026-10-01T12:30:00Z" },
      { id: B, accion: "CREAR_TAREA", payload_snapshot: { datos: { titulo: "Llamar al proveedor" } }, expires_at: "2026-10-01T12:50:00Z" },
      { id: "x", accion: "REGISTRAR_COMPRA", payload_snapshot: {}, expires_at: "2026-10-01T11:00:00Z" },
    ],
    AHORA,
  );
  assert.match(t, /Estas 2 cosas quedaron esperando tu OK/);
  assert.match(t, /1\. Registrar una venta\n2\. Crear una tarea: Llamar al proveedor/);
  assert.match(t, /\*sí\* para hacer todo, \*sí 2\* para hacer solo una, o \*no\* para descartar todo \(vence en 30 min\)/);
  assert.doesNotMatch(t, /compra/i);
  assert.equal(textoDeAprobaciones([], AHORA), "");
});

test("el resumen dice qué se aprueba con los datos de la acción", () => {
  assert.equal(
    resumenDeAccion("REGISTRAR_VENTA", { datos: { items: [{ producto: "Balanceado", cantidad: 3 }], contacto: "Juan Pérez" } }),
    "Registrar una venta: 3 Balanceado · con Juan Pérez",
  );
});

test("por WhatsApp el enlace a la web se cambia por las instrucciones", () => {
  const respuesta = "Entendí la venta.\n\nPara completar el registro, revisá y aprobá la operación pendiente en https://www.transtech.com.py/eos/autonomy";
  assert.equal(conInstruccionesDeWhatsapp(respuesta, "Esto quedó esperando tu OK…"), "Entendí la venta.\n\nEsto quedó esperando tu OK…");
});

test("el resultado dice lo que pasó de verdad, una o varias", () => {
  assert.match(textoDelResultado("ejecutada", "REGISTRAR_VENTA"), /aprobado y registrado/);
  assert.match(textoDelResultado("no_ejecutada", "REGISTRAR_VENTA"), /No está registrado/);
  const varios = textoDeVariosResultados([
    { tipo: "ejecutada", resumen: "Registrar una venta" },
    { tipo: "no_ejecutada", resumen: "Crear una tarea" },
  ]);
  assert.equal(varios, "• Registrar una venta: hecho\n• Crear una tarea: no se pudo completar, no está registrado");
});
