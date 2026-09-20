import assert from "node:assert/strict";
import test from "node:test";

import { responsableValido } from "./responsable.ts";
import { baseFalsa } from "../whatsapp-crm/base-falsa.ts";

test("uno mismo siempre puede ser el responsable, sin consultar nada", async () => {
  const { admin, pedidos } = baseFalsa();
  assert.equal(await responsableValido(admin, null, "u-1", "u-1"), true);
  assert.equal(pedidos.length, 0);
});

test("un miembro de la misma empresa sí; la consulta lleva la empresa Y la persona", async () => {
  const { admin, pedidos } = baseFalsa({ "eos_empresa_miembros.select": { data: { usuario_id: "u-2" }, error: null } });

  assert.equal(await responsableValido(admin, "e-1", "u-2", "u-1"), true);

  const filtros = pedidos[0].filtros;
  assert.ok(filtros.some((f) => f.args[0] === "empresa_id" && f.args[1] === "e-1"));
  assert.ok(filtros.some((f) => f.args[0] === "usuario_id" && f.args[1] === "u-2"));
});

test("alguien que no es de la empresa NO puede ser responsable", async () => {
  const { admin } = baseFalsa({ "eos_empresa_miembros.select": { data: null, error: null } });
  assert.equal(await responsableValido(admin, "e-1", "u-ajeno", "u-1"), false);
});

test("sin empresa resuelta, solo uno mismo", async () => {
  const { admin, pedidos } = baseFalsa();
  assert.equal(await responsableValido(admin, null, "u-2", "u-1"), false);
  assert.equal(pedidos.length, 0);
});

test("si no se puede verificar, NO se asigna", async () => {
  const { admin } = baseFalsa({ "eos_empresa_miembros.select": { data: null, error: { code: "XX000" } } });
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await responsableValido(admin, "e-1", "u-2", "u-1"), false);
  } finally {
    console.error = original;
  }
});
