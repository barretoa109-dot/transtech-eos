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
