import assert from "node:assert/strict";
import test from "node:test";
import { empresaDe, filtroDeEmpresa } from "./acceso.ts";

const USUARIO = "11111111-1111-4111-8111-111111111111";
const EMPRESA = "22222222-2222-4222-8222-222222222222";

test("el filtro incluye las dos fronteras mientras dure la transición", () => {
  // Solo empresa haría desaparecer —sin ningún error— una fila con la columna
  // en null. Solo usuario dejaría afuera a un segundo miembro. Van las dos.
  const f = filtroDeEmpresa(USUARIO, EMPRESA);
  assert.match(f, /usuario_id\.eq\./);
  assert.match(f, /empresa_id\.eq\./);
});

test("sin empresa resuelta, el filtro cae al usuario y NO se queda vacío", () => {
  // Un filtro vacío devolvería la tabla entera. Falla cerrado.
  const f = filtroDeEmpresa(USUARIO, null);
  assert.equal(f, `usuario_id.eq.${USUARIO}`);
  assert.doesNotMatch(f, /empresa_id/);
  assert.ok(f.length > 0);
});

test("el filtro siempre nombra al usuario: nunca puede devolver datos ajenos por sí solo", () => {
  for (const empresa of [EMPRESA, null]) {
    assert.ok(filtroDeEmpresa(USUARIO, empresa).includes(USUARIO));
  }
});

test("empresaDe devuelve null cuando la base falla, no un valor de relleno", async () => {
  const admin = {
    rpc: async () => ({ data: null, error: { message: "se cayó" } }),
  };
  assert.equal(await empresaDe(admin, USUARIO), null);
});

test("empresaDe devuelve null cuando no hay empresa, y nunca una cadena vacía", async () => {
  for (const data of [null, "", undefined]) {
    const admin = { rpc: async () => ({ data, error: null }) };
    assert.equal(await empresaDe(admin, USUARIO), null);
  }
});

test("empresaDe devuelve el id cuando lo hay", async () => {
  const admin = { rpc: async () => ({ data: EMPRESA, error: null }) };
  assert.equal(await empresaDe(admin, USUARIO), EMPRESA);
});
