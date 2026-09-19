import assert from "node:assert/strict";
import test from "node:test";

import { NUMERO_WHATSAPP_EOS, enlaceWhatsappEOS, numeroWhatsappEOS } from "./numero-eos.ts";

test("sin variable de entorno se muestra igual el número de EOS", () => {
  for (const v of [undefined, null, "", "   "]) {
    assert.equal(numeroWhatsappEOS(v), NUMERO_WHATSAPP_EOS);
  }
});

test("la variable de entorno puede cambiar el número sin tocar código", () => {
  assert.equal(numeroWhatsappEOS(" +595 981 000111 "), "+595 981 000111");
});

test("el enlace de wa.me lleva solo dígitos", () => {
  assert.equal(enlaceWhatsappEOS("+595 987 506802"), "https://wa.me/595987506802");
  assert.equal(enlaceWhatsappEOS(), "https://wa.me/595987506802");
  assert.equal(enlaceWhatsappEOS("(0987) 506-802"), "https://wa.me/0987506802");
});

test("el número por defecto es el de EOS que se le da a la gente", () => {
  assert.equal(NUMERO_WHATSAPP_EOS, "+595 987 506802");
});
