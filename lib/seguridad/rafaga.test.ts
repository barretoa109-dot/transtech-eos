import assert from "node:assert/strict";
import { test } from "node:test";

import { dentroDeRafaga } from "./rafaga.ts";

const SECRETO = "s".repeat(32);

function contador(opciones: { falla?: boolean } = {}) {
  const usos = new Map<string, number>();
  return {
    rpc: async (_n: string, args: Record<string, unknown>) => {
      if (opciones.falla) return { data: null, error: { message: "caída" } };
      const k = String(args.p_clave);
      const n = (usos.get(k) ?? 0) + 1;
      usos.set(k, n);
      return { data: { permitido: n <= Number(args.p_maximo), faltan_segundos: 42 }, error: null };
    },
  };
}

test("una persona escribiendo normal nunca se frena", async () => {
  const admin = contador();
  for (let i = 0; i < 20; i++) {
    assert.equal((await dentroDeRafaga(admin, "u1", SECRETO)).permitido, true);
  }
});

test("el mensaje 21 del minuto espera, con el tiempo que falta", async () => {
  const admin = contador();
  for (let i = 0; i < 20; i++) await dentroDeRafaga(admin, "u1", SECRETO);
  assert.deepEqual(await dentroDeRafaga(admin, "u1", SECRETO), { permitido: false, faltanSegundos: 42 });
});

test("la ráfaga de uno no frena a otro", async () => {
  const admin = contador();
  for (let i = 0; i < 25; i++) await dentroDeRafaga(admin, "u1", SECRETO);
  assert.equal((await dentroDeRafaga(admin, "u2", SECRETO)).permitido, true);
});

test("falla abierto: sin contador el chat sigue", async () => {
  assert.equal((await dentroDeRafaga(contador({ falla: true }), "u1", SECRETO)).permitido, true);
  assert.equal((await dentroDeRafaga(contador(), "u1", undefined)).permitido, true);
});
