import assert from "node:assert/strict";
import { test } from "node:test";

import {
  limpiarDetalle,
  registrarAuditoria,
  resumirMovimiento,
} from "./registrar.ts";

test("limpiarDetalle deja pasar lo que sirve para auditar", () => {
  const limpio = limpiarDetalle({
    monto: 50000,
    moneda: "PYG",
    confianza: 0.98,
    automatico: true,
    remitente: "transferencias@bancognb.com.py",
  });

  assert.deepEqual(limpio, {
    monto: 50000,
    moneda: "PYG",
    confianza: 0.98,
    automatico: true,
    remitente: "transferencias@bancognb.com.py",
  });
});

test("limpiarDetalle NO guarda el cuerpo del correo", () => {
  // La página /privacidad promete que el cuerpo no se guarda. Si esta barrera
  // se cae, la promesa se rompe sin que nadie lo note.
  const limpio = limpiarDetalle({
    monto: 50000,
    texto: "Estimado cliente, su saldo es PYG 4.200.000. Cuenta 1234567890.",
    html: "<p>Estimado cliente…</p>",
    cuerpo: "…",
    mensaje: "…",
  });

  assert.deepEqual(limpio, { monto: 50000 });
});

test("limpiarDetalle NO guarda credenciales, ni con nombres compuestos", () => {
  const limpio = limpiarDetalle({
    referencia: "abc",
    access_token: "sk-vivo",
    refresh_token: "rt-vivo",
    RESEND_API_KEY: "re_vivo",
    webhook_secret: "shh",
    Authorization: "Bearer x",
  });

  assert.deepEqual(limpio, { referencia: "abc" });
});

test("limpiarDetalle descarta objetos y arrays enteros", () => {
  // Son el camino por el que se cuela un payload completo sin que se note.
  const limpio = limpiarDetalle({
    monto: 1000,
    payload: { texto: "correo entero" },
    importes: [1, 2, 3],
  });

  assert.deepEqual(limpio, { monto: 1000 });
});

test("limpiarDetalle recorta los textos largos", () => {
  const largo = "a".repeat(500);
  const limpio = limpiarDetalle({ descripcion: largo });

  assert.equal((limpio.descripcion as string).length, 201);
  assert.ok((limpio.descripcion as string).endsWith("…"));
});

test("resumirMovimiento explica de dónde salió el número", () => {
  const resumen = resumirMovimiento({
    tipo: "ingreso",
    monto: 50000,
    moneda: "PYG",
    descripcion: "Transferencias Recibidas SPI",
    fuente: "aviso de bancognb.com.py",
  });

  assert.equal(
    resumen,
    "Ingreso de ₲ 50.000 — Transferencias Recibidas SPI (aviso de bancognb.com.py)",
  );
});

test("registrarAuditoria devuelve false y NO lanza cuando la base falla", async () => {
  // Es la garantía de que un fallo de auditoría no tumba una aprobación que el
  // usuario ya autorizó.
  const admin = {
    from: () => ({
      insert: async () => ({ error: { message: "relation does not exist" } }),
    }),
  };

  const ok = await registrarAuditoria(admin, {
    usuarioId: "00000000-0000-4000-8000-000000000000",
    evento: "accion_autorizada",
    origen: "panel",
    resumen: "prueba",
  });

  assert.equal(ok, false);
});

test("registrarAuditoria tampoco lanza si el cliente explota", async () => {
  const admin = {
    from: () => {
      throw new Error("sin red");
    },
  };

  const ok = await registrarAuditoria(admin as never, {
    usuarioId: "00000000-0000-4000-8000-000000000000",
    evento: "accion_autorizada",
    origen: "panel",
    resumen: "prueba",
  });

  assert.equal(ok, false);
});

test("registrarAuditoria manda solo los campos que le corresponde decidir", async () => {
  // `numero`, `hash`, `hash_previo` y `created_at` los pone la base: si el que
  // escribe pudiera mandarlos, podría antedatar un movimiento.
  let fila: Record<string, unknown> | null = null;

  const admin = {
    from: () => ({
      insert: async (f: unknown) => {
        fila = f as Record<string, unknown>;
        return { error: null };
      },
    }),
  };

  await registrarAuditoria(admin, {
    usuarioId: "00000000-0000-4000-8000-000000000000",
    evento: "movimiento_ingerido",
    origen: "correo",
    resumen: "Ingreso de ₲ 50.000",
    referencia: "email_123",
  });

  assert.deepEqual(Object.keys(fila ?? {}).sort(), [
    "detalle",
    "evento",
    "origen",
    "referencia",
    "resumen",
    "usuario_id",
  ]);
});

// ============================================================
// Antes y después: la excepción del punto 42
// ============================================================
//
// `limpiarDetalle` descarta objetos a propósito. `antes` y `despues` son la
// única excepción, y tiene que seguir siendo tan estrecha como se escribió.

test("el antes y el después se guardan, a diferencia de cualquier otro objeto", () => {
  const limpio = limpiarDetalle({
    antes: { costo: 1000, nombre: "Harina" },
    despues: { costo: 1500, nombre: "Harina" },
    otro_objeto: { algo: "que no pasa" },
  });

  assert.deepEqual(limpio.antes, { costo: 1000, nombre: "Harina" });
  assert.deepEqual(limpio.despues, { costo: 1500, nombre: "Harina" });
  assert.equal(limpio.otro_objeto, undefined);
});

test("un null adentro del antes SÍ se guarda: es el cambio que hay que ver", () => {
  const limpio = limpiarDetalle({ antes: { costo: null }, despues: { costo: 1000 } });

  assert.deepEqual(limpio.antes, { costo: null });
  assert.deepEqual(limpio.despues, { costo: 1000 });
});

test("las claves prohibidas tampoco entran adentro del antes", () => {
  const limpio = limpiarDetalle({
    antes: { costo: 100, api_key: "secreta", cuerpo: "el correo entero" },
  });

  assert.deepEqual(limpio.antes, { costo: 100 });
});

test("un objeto anidado adentro del antes sigue sin entrar", () => {
  const limpio = limpiarDetalle({
    antes: { costo: 100, payload: { todo: "el cuerpo", del: "correo" } },
  });

  assert.deepEqual(limpio.antes, { costo: 100 });
});

test("un antes que es un array o queda vacío no ensucia el detalle", () => {
  assert.equal(limpiarDetalle({ antes: [1, 2, 3] }).antes, undefined);
  assert.equal(limpiarDetalle({ antes: { token: "x" } }).antes, undefined);
  assert.equal(limpiarDetalle({ antes: null }).antes, undefined);
});

test("los textos largos del antes se recortan igual que los de afuera", () => {
  const largo = "x".repeat(500);
  const limpio = limpiarDetalle({ antes: { notas: largo } });

  const notas = (limpio.antes as Record<string, string>).notas;
  assert.ok(notas.length < 250);
  assert.ok(notas.endsWith("…"));
});
