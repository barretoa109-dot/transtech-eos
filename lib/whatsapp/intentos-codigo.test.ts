import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_POR_TELEFONO, puedeProbarCodigo } from "./intentos-codigo.ts";

const SECRETO = "s".repeat(32);

/** Un contador en memoria que imita a `eos_consumir_cupo_v99`. */
function contador(opciones: { falla?: boolean } = {}) {
  const usos = new Map<string, number>();
  return {
    usos,
    rpc: async (_n: string, args: Record<string, unknown>) => {
      if (opciones.falla) return { data: null, error: { message: "caída" } };
      const k = String(args.p_clave);
      const n = (usos.get(k) ?? 0) + 1;
      usos.set(k, n);
      return { data: { permitido: n <= Number(args.p_maximo) }, error: null };
    },
  };
}

test("un teléfono prueba a lo sumo cinco códigos por hora", async () => {
  const admin = contador();
  const resultados = [];
  for (let i = 0; i < MAX_POR_TELEFONO + 3; i++) {
    resultados.push(await puedeProbarCodigo(admin, "595981000001", SECRETO));
  }
  assert.deepEqual(resultados, [true, true, true, true, true, false, false, false]);
});

test("el techo de un teléfono no frena a otro", async () => {
  const admin = contador();
  for (let i = 0; i < 10; i++) await puedeProbarCodigo(admin, "595981000001", SECRETO);
  assert.equal(await puedeProbarCodigo(admin, "595981000002", SECRETO), true);
});

test("rotar teléfonos choca con el techo global", async () => {
  const admin = contador();
  let permitidos = 0;
  for (let i = 0; i < 150; i++) {
    if (await puedeProbarCodigo(admin, `5959810${String(i).padStart(5, "0")}`, SECRETO)) permitidos++;
  }
  assert.equal(permitidos, 100);
});

test("falla cerrado: sin contador o sin secreto, no se prueba el código", async () => {
  assert.equal(await puedeProbarCodigo(contador({ falla: true }), "595981000001", SECRETO), false);
  assert.equal(await puedeProbarCodigo(contador(), "595981000001", undefined), false);
  assert.equal(await puedeProbarCodigo(contador(), "595981000001", "corto"), false);
});

test("el teléfono no queda en claro en la clave", async () => {
  const admin = contador();
  await puedeProbarCodigo(admin, "595981000001", SECRETO);
  for (const k of admin.usos.keys()) assert.ok(!k.includes("595981000001"));
});
