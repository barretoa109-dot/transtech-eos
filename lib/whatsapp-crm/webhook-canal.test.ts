import assert from "node:assert/strict";
import test from "node:test";

import { aplicarEstadoDePlantilla, secretosDeApp, tokenDeVerificacionValido } from "./webhook-canal.ts";
import { baseFalsa } from "./base-falsa.ts";

test("los secretos de app se traen por número; el que no tiene queda en null", async () => {
  const { admin, pedidos } = baseFalsa({
    "rpc:eos_wa_secreto_app_de_numero_v185": (p) =>
      ({ data: (p.args as { p_phone_number_id: string }).p_phone_number_id === "111111" ? "secreto-a" : null, error: null }),
  });

  const m = await secretosDeApp(admin, ["111111", "222222"]);
  assert.deepEqual([...m], [["111111", "secreto-a"], ["222222", null]]);
  assert.equal(pedidos.length, 2);
});

test("sin la función (v185 sin aplicar) rige el global: no rompe", async () => {
  const { admin } = baseFalsa({ "rpc:eos_wa_secreto_app_de_numero_v185": { data: null, error: { code: "42883", message: "no existe" } } });
  const m = await secretosDeApp(admin, ["111111"]);
  assert.equal(m.get("111111"), null);
});

test("SEGURIDAD: si la consulta FALLA por otra cosa, NO se asume 'sin secreto propio'", async () => {
  const { admin } = baseFalsa({ "rpc:eos_wa_secreto_app_de_numero_v185": { data: null, error: { code: "57014", message: "timeout" } } });
  // Asumir null validaría con el secreto global lo que firmó otra app.
  await assert.rejects(() => secretosDeApp(admin, ["111111"]), /No se pudo consultar el secreto/);
});

test("un token de verificación de un canal conectado es válido", async () => {
  const { admin, pedidos } = baseFalsa({ "eos_wa_canales.select": { data: { id: "c" }, error: null } });
  assert.equal(await tokenDeVerificacionValido(admin, "a".repeat(48)), true);

  const filtros = pedidos[0].filtros;
  assert.ok(filtros.some((f) => f.metodo === "eq" && f.args[0] === "verify_token"));
  // Un canal desconectado ya no atiende.
  assert.ok(filtros.some((f) => f.metodo === "neq" && f.args[0] === "estado" && f.args[1] === "desconectado"));
});

test("un token que no es de ningún canal, corto o vacío no es válido", async () => {
  const { admin } = baseFalsa({ "eos_wa_canales.select": { data: null, error: null } });
  assert.equal(await tokenDeVerificacionValido(admin, "b".repeat(48)), false);
  assert.equal(await tokenDeVerificacionValido(admin, "corto"), false);
  assert.equal(await tokenDeVerificacionValido(admin, ""), false);
});

test("con la tabla ausente, el token no es válido y no rompe el apretón de manos del canal principal", async () => {
  const { admin } = baseFalsa({ "eos_wa_canales.select": { data: null, error: { code: "42P01", message: "no existe" } } });
  assert.equal(await tokenDeVerificacionValido(admin, "c".repeat(48)), false);
});

test("Meta avisa que una plantilla fue aprobada: se actualiza la del canal de esa cuenta", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_wa_canales.select": { data: [{ id: "canal-1" }], error: null },
    "eos_wa_plantillas.update": { data: [{ id: "p-1" }], error: null },
  });

  const r = await aplicarEstadoDePlantilla(admin, "987654321", { event: "APPROVED", message_template_name: "seguimiento" });

  assert.deepEqual(r, { actualizadas: 1 });
  const cambio = pedidos.find((p) => p.clave === "eos_wa_plantillas.update")!;
  assert.equal((cambio.payload as { estado: string }).estado, "aprobada");
  // Acotado a los canales de ESA cuenta y a ESE nombre.
  assert.ok(cambio.filtros.some((f) => f.metodo === "in" && f.args[0] === "canal_id" && JSON.stringify(f.args[1]) === '["canal-1"]'));
  assert.ok(cambio.filtros.some((f) => f.metodo === "eq" && f.args[0] === "nombre" && f.args[1] === "seguimiento"));
});

test("un rechazo guarda el motivo que dio Meta", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_wa_canales.select": { data: [{ id: "canal-1" }], error: null },
    "eos_wa_plantillas.update": { data: [{ id: "p-1" }], error: null },
  });
  await aplicarEstadoDePlantilla(admin, "987654321", { event: "REJECTED", message_template_name: "seguimiento", reason: "INCORRECT_CATEGORY" });

  const c = pedidos.find((p) => p.clave === "eos_wa_plantillas.update")!.payload as { estado: string; motivo_rechazo: string };
  assert.equal(c.estado, "rechazada");
  assert.equal(c.motivo_rechazo, "INCORRECT_CATEGORY");
});

test("un aviso de una cuenta que no es de ningún canal no toca nada", async () => {
  const { admin, pedidos } = baseFalsa({ "eos_wa_canales.select": { data: [], error: null } });
  const r = await aplicarEstadoDePlantilla(admin, "987654321", { event: "APPROVED", message_template_name: "seguimiento" });

  assert.deepEqual(r, { actualizadas: 0 });
  assert.ok(!pedidos.some((p) => p.clave === "eos_wa_plantillas.update"));
});

test("un aviso mal formado se ignora", async () => {
  const { admin, pedidos } = baseFalsa();
  for (const [waba, aviso] of [["abc", { event: "APPROVED", message_template_name: "x" }], ["987654321", { event: "APPROVED" }], ["987654321", { message_template_name: "x" }]] as const) {
    assert.deepEqual(await aplicarEstadoDePlantilla(admin, waba, aviso), { actualizadas: 0 });
  }
  assert.equal(pedidos.length, 0);
});
