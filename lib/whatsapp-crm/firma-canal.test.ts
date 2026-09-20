import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { extraerPhoneNumberIds, secretoParaPayload } from "./firma-canal.ts";
import { firmaWhatsappValida } from "../whatsapp/firma.ts";

const cuerpo = (...ids: string[]) =>
  JSON.stringify({ entry: [{ changes: ids.map((id) => ({ value: { metadata: { phone_number_id: id } } })) }] });

test("se leen los números del paquete, sin repetir", () => {
  assert.deepEqual(extraerPhoneNumberIds(cuerpo("111111", "222222", "111111")), ["111111", "222222"]);
});

test("lo que no son dígitos, o un JSON roto, no se toma", () => {
  assert.deepEqual(extraerPhoneNumberIds(cuerpo("1' or 1=1--", "abc", "12")), []);
  assert.deepEqual(extraerPhoneNumberIds("no es json"), []);
  assert.deepEqual(extraerPhoneNumberIds(JSON.stringify({ entry: "x" })), []);
  assert.deepEqual(extraerPhoneNumberIds(JSON.stringify({ entry: [{ changes: null }, null] })), []);
});

test("sin ningún número con secreto propio, se usa el global", () => {
  const r = secretoParaPayload(["111111"], new Map([["111111", null]]));
  assert.deepEqual(r, { ok: true, secreto: null });
  assert.deepEqual(secretoParaPayload([], new Map()), { ok: true, secreto: null });
});

test("un número con secreto propio se valida con el suyo", () => {
  assert.deepEqual(secretoParaPayload(["111111"], new Map([["111111", "secreto-a"]])), { ok: true, secreto: "secreto-a" });
});

test("varios números con el MISMO secreto (misma app) se valida con ese", () => {
  const m = new Map([["111111", "s"], ["222222", "s"]]);
  assert.deepEqual(secretoParaPayload(["111111", "222222"], m), { ok: true, secreto: "s" });
});

test("SEGURIDAD: un paquete con el número de un atacante y el de otro canal se RECHAZA", () => {
  // El atacante firma con SU secreto y mete adentro un mensaje "del" canal de otra empresa.
  const m = new Map([["111111", "secreto-del-atacante"], ["222222", "secreto-de-la-victima"]]);
  assert.deepEqual(secretoParaPayload(["111111", "222222"], m), { ok: false });
});

test("SEGURIDAD: mezclar un canal con secreto propio y otro sin él también se rechaza", () => {
  const m = new Map<string, string | null>([["111111", "secreto-propio"], ["222222", null]]);
  assert.deepEqual(secretoParaPayload(["111111", "222222"], m), { ok: false });
  assert.deepEqual(secretoParaPayload(["222222", "111111"], m), { ok: false });
});

test("un número desconocido para la base cuenta como 'sin secreto propio'", () => {
  assert.deepEqual(secretoParaPayload(["999999"], new Map()), { ok: true, secreto: null });
});

// ----------------------------------------------------------- la firma en sí

const firmar = (texto: string, secreto: string) => "sha256=" + createHmac("sha256", secreto).update(texto, "utf8").digest("hex");

test("la firma se valida con el secreto del canal cuando se lo pasa, ignorando el global", () => {
  const anterior = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_APP_SECRET = "secreto-global-de-transtech";

  try {
    const texto = cuerpo("111111");
    const conElDelCanal = firmar(texto, "secreto-de-la-empresa");

    assert.equal(firmaWhatsappValida(texto, conElDelCanal, "secreto-de-la-empresa"), true);
    // Con el global NO valida una firma hecha con el de la empresa...
    assert.equal(firmaWhatsappValida(texto, conElDelCanal), false);
    // ...ni con el de la empresa se acepta una firma hecha con el global: un canal con
    // secreto propio no acepta lo que firmó otra app.
    assert.equal(firmaWhatsappValida(texto, firmar(texto, "secreto-global-de-transtech"), "secreto-de-la-empresa"), false);
  } finally {
    if (anterior === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = anterior;
  }
});

test("sin secreto de canal, todo sigue como siempre: vale el global", () => {
  const anterior = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_APP_SECRET = "secreto-global-de-transtech";
  try {
    const texto = cuerpo("111111");
    assert.equal(firmaWhatsappValida(texto, firmar(texto, "secreto-global-de-transtech")), true);
    assert.equal(firmaWhatsappValida(texto, firmar(texto, "otro")), false);
    assert.equal(firmaWhatsappValida(texto, null), false);
    assert.equal(firmaWhatsappValida(texto, firmar(texto, "secreto-global-de-transtech"), null), true);
  } finally {
    if (anterior === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = anterior;
  }
});
