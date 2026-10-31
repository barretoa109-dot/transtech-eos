import assert from "node:assert/strict";
import test from "node:test";

import { textoComprasRecientes } from "./compras-recientes.ts";

function adminFalso(resultado: { data?: unknown; error?: unknown }) {
  return {
    rpc: (nombre: string, args: Record<string, unknown>) => {
      assert.equal(nombre, "eos_compras_recientes");
      assert.equal(args.p_usuario_id, "u1");
      return Promise.resolve(resultado);
    },
  } as unknown as Parameters<typeof textoComprasRecientes>[0];
}

test("sin compras, no hay nada que agregar al contexto", async () => {
  const texto = await textoComprasRecientes(adminFalso({ data: [] }), "u1");
  assert.equal(texto, "");
});

test("un error de la base no revienta: sigue sin este contexto", async () => {
  const texto = await textoComprasRecientes(adminFalso({ error: { message: "boom" } }), "u1");
  assert.equal(texto, "");
});

test("arma una línea por compra, con sus ítems y precio unitario", async () => {
  const texto = await textoComprasRecientes(
    adminFalso({
      data: [
        {
          fecha: "2026-09-20",
          proveedor: null,
          moneda: "PYG",
          total: 2_800_000,
          items: [
            { descripcion: "Lechón", cantidad: 1, precio_unitario: 300_000 },
            { descripcion: "Lechón", cantidad: 1, precio_unitario: 250_000 },
          ],
        },
        {
          fecha: "2026-10-22",
          proveedor: "Molino",
          moneda: "PYG",
          total: 58_000,
          items: [{ descripcion: "Balanceado 25Kg", cantidad: 1, precio_unitario: 58_000 }],
        },
      ],
    }),
    "u1",
  );

  assert.match(texto, /YA CARGADOS/);
  assert.match(texto, /NO le vuelvas a preguntar/);
  assert.match(texto, /2026-09-20 · sin proveedor · ₲ 2\.800\.000 · Lechón \(₲ 300\.000 c\/u\), Lechón \(₲ 250\.000 c\/u\)/);
  assert.match(texto, /2026-10-22 · Molino · ₲ 58\.000 · Balanceado 25Kg \(₲ 58\.000 c\/u\)/);
});

test("una fila sin ítems detallados lo dice en vez de inventar un detalle", async () => {
  const texto = await textoComprasRecientes(
    adminFalso({ data: [{ fecha: "2026-10-31", proveedor: null, moneda: "PYG", total: 100_000, items: [] }] }),
    "u1",
  );
  assert.match(texto, /\(sin ítems detallados\)/);
});
