import assert from "node:assert/strict";
import { test } from "node:test";

import { tarjetaHabilitadaPara } from "./tarjetaHabilitada.ts";

test("con Bancard en producción, la tarjeta es para todos", () => {
  assert.equal(tarjetaHabilitadaPara("cliente@gmail.com", { BANCARD_ENV: "production" }), true);
  assert.equal(tarjetaHabilitadaPara("cliente@gmail.com", { BANCARD_ENV: " Production " }), true);
});

test("en staging, un cliente no puede activar un plan con una tarjeta de prueba", () => {
  assert.equal(tarjetaHabilitadaPara("cliente@gmail.com", { BANCARD_ENV: "staging" }), false);
  assert.equal(tarjetaHabilitadaPara("cliente@gmail.com", {}), false, "sin variable es staging");
  assert.equal(tarjetaHabilitadaPara(null, {}), false);
});

test("en staging, la certificación y los administradores sí la prueban", () => {
  assert.equal(tarjetaHabilitadaPara("demo@transtech.com.py", {}), true);
  assert.equal(tarjetaHabilitadaPara("QA@Transtech.com.py", { EOS_CERT_EMAIL: "qa@transtech.com.py" }), true);
  assert.equal(tarjetaHabilitadaPara("augusto@x.com", { ADMIN_EMAILS: "otro@x.com, augusto@x.com" }), true);
});
