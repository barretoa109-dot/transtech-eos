import assert from "node:assert/strict";
import test from "node:test";

import { MOTIVO_NO_ACREDITADA, redactarCorreoNoVerificado } from "./correo-comprobante.ts";

test("el correo de rechazo dice qué se encontró, qué hacer y el reembolso", () => {
  const c = redactarCorreoNoVerificado({
    nombre: "Marta Benítez",
    referencia: "EOS-123",
    motivos: [MOTIVO_NO_ACREDITADA],
    momento: "rechazado",
  });
  assert.match(c.asunto, /No pudimos aprobar/);
  assert.match(c.texto, /^Hola, Marta:/);
  assert.match(c.texto, /EOS-123/);
  assert.match(c.texto, /No vimos acreditada la transferencia/);
  assert.match(c.texto, /totalidad del monto en un plazo máximo de 24 horas/);
});

test("mientras está en revisión no se presenta como un rechazo", () => {
  const c = redactarCorreoNoVerificado({
    nombre: null,
    referencia: "EOS-9",
    motivos: ["La cuenta de destino no es la de TransTech."],
    momento: "en_revision",
  });
  assert.match(c.texto, /^Hola:/);
  assert.match(c.texto, /lo va a mirar también/);
  assert.match(c.texto, /La cuenta de destino no es la de TransTech/);
});

test("nunca acusa: ni 'falso' ni 'fraude' en el texto que lee la persona", () => {
  for (const momento of ["rechazado", "en_revision"] as const) {
    const c = redactarCorreoNoVerificado({ nombre: "Ana", referencia: "R", motivos: [], momento });
    assert.doesNotMatch(`${c.asunto} ${c.texto}`, /fals[oa]|fraude|truch/i);
    assert.match(c.texto, /No pudimos confirmar los datos/);
  }
});

test("el correo de anulación dice que el plan se dio de baja, por qué, y que los datos siguen", () => {
  const c = redactarCorreoNoVerificado({
    nombre: "Marta",
    referencia: "EOS-77",
    motivos: ["La transferencia no llegó a nuestra cuenta."],
    momento: "anulado",
  });
  assert.match(c.asunto, /Dimos de baja/);
  assert.match(c.texto, /volvió al plan que tenía antes/);
  assert.match(c.texto, /no perdiste ninguno de tus datos/);
  assert.match(c.texto, /La transferencia no llegó a nuestra cuenta/);
  assert.match(c.texto, /24 horas/);
});
