import assert from "node:assert/strict";
import test from "node:test";
import { empresaDe, filtroDeEmpresa } from "./acceso.ts";

const USUARIO = "11111111-1111-4111-8111-111111111111";
const EMPRESA = "22222222-2222-4222-8222-222222222222";

test("desde la etapa 4 el filtro es SOLO por empresa", () => {
  // Estas rutas usan `adminSinTipos()`, que no pasa por RLS: este filtro es su
  // única frontera. Si dijera algo más permisivo que las policies, las mismas
  // filas se verían o no según qué ruta las pidiera.
  const f = filtroDeEmpresa(USUARIO, EMPRESA);
  assert.equal(f, `empresa_id.eq.${EMPRESA}`);
  assert.doesNotMatch(f, /usuario_id/, "quedó una frontera que las policies ya no aceptan");
});

test("sin empresa no devuelve nada, y NO cae al usuario", () => {
  // Caer al usuario sería más permisivo que la RLS, que no le mostraría nada.
  // Si la empresa no se resuelve hay un problema que arreglar; taparlo con un
  // acceso más ancho es la peor forma de no enterarse.
  const f = filtroDeEmpresa(USUARIO, null);
  assert.doesNotMatch(f, /usuario_id/);
  assert.match(f, /^empresa_id\.eq\.0{8}-0{4}-0{4}-0{4}-0{12}$/);
});

test("el filtro nunca queda vacío: uno vacío devolvería la tabla entera", () => {
  for (const empresa of [EMPRESA, null]) {
    const f = filtroDeEmpresa(USUARIO, empresa);
    assert.ok(f.length > 0);
    assert.match(f, /^empresa_id\.eq\./);
  }
});

test("el usuario ya no viaja en el filtro, ni siquiera de casualidad", () => {
  // Es lo que hace que un invitado vea el negocio y no lo de quien lo cargó.
  for (const empresa of [EMPRESA, null]) {
    assert.ok(!filtroDeEmpresa(USUARIO, empresa).includes(USUARIO));
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
