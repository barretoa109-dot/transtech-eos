import assert from "node:assert/strict";
import { test } from "node:test";

import { tarjetaHabilitadaPara } from "./tarjetaHabilitada.ts";

test("con Bancard en producción, la tarjeta es para todos", () => {
  assert.equal(tarjetaHabilitadaPara("cliente@gmail.com", { BANCARD_ENV: "production", BANCARD_PAUSADO: "0" }), true);
  assert.equal(tarjetaHabilitadaPara("cliente@gmail.com", { BANCARD_ENV: " Production ", BANCARD_PAUSADO: "0" }), true);
});

test("en staging, un cliente no puede activar un plan con una tarjeta de prueba", () => {
  assert.equal(tarjetaHabilitadaPara("cliente@gmail.com", { BANCARD_ENV: "staging" }), false);
  assert.equal(tarjetaHabilitadaPara("cliente@gmail.com", {}), false, "sin variable es staging");
  assert.equal(tarjetaHabilitadaPara(null, {}), false);
});

test("en staging, la certificación y los administradores sí la prueban", () => {
  assert.equal(tarjetaHabilitadaPara("demo@transtech.com.py", {}), true);
  assert.equal(tarjetaHabilitadaPara("QA@Transtech.com.py", { EOS_CERT_EMAIL: "qa@transtech.com.py" }), true);
  assert.equal(
    tarjetaHabilitadaPara("augusto@x.com", { ADMIN_EMAILS: "otro@x.com, augusto@x.com", BANCARD_PAUSADO: "0" }),
    true,
  );
});

test("con la pausa puesta (el valor por defecto), ni en producción hay tarjeta para un cliente", () => {
  assert.equal(tarjetaHabilitadaPara("cliente@gmail.com", { BANCARD_ENV: "production" }), false);
  assert.equal(tarjetaHabilitadaPara("cliente@gmail.com", { BANCARD_ENV: "production", BANCARD_PAUSADO: "1" }), false);
  // Tampoco quien administra: entra a ver lo que ve un cliente, y no tiene que ver la tarjeta.
  assert.equal(tarjetaHabilitadaPara("augusto@x.com", { BANCARD_ENV: "production", ADMIN_EMAILS: "augusto@x.com" }), false);
  // La cuenta de certificación sí, que existe para eso.
  assert.equal(tarjetaHabilitadaPara("demo@transtech.com.py", { BANCARD_ENV: "production" }), true);
});
