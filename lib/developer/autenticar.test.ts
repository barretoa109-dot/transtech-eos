import assert from "node:assert/strict";
import test from "node:test";

import { resolverClaveApi } from "./autenticar.ts";
import { generarClave, hashDeClave } from "./claves.ts";

function adminFalso(filas: { id: string; usuario_id: string; hash: string; revocada_en: string | null }[]) {
  const actualizaciones: { id: string; campos: Record<string, unknown> }[] = [];
  return {
    admin: {
      from: () => ({
        select: () => ({
          eq: (_col: string, hash: string) => ({
            is: () => ({
              maybeSingle: async () => {
                const fila = filas.find((f) => f.hash === hash && f.revocada_en === null);
                return { data: fila ? { id: fila.id, usuario_id: fila.usuario_id } : null, error: null };
              },
            }),
          }),
        }),
        update: (campos: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            actualizaciones.push({ id, campos });
            return { data: null, error: null };
          },
        }),
      }),
    },
    actualizaciones,
  };
}

function peticion(autorizacion?: string): Request {
  return new Request("https://eos.example/api/v1/publico/saldo", {
    headers: autorizacion ? { authorization: autorizacion } : {},
  });
}

test("sin encabezado Authorization, no resuelve nada", async () => {
  const { admin } = adminFalso([]);
  assert.equal(await resolverClaveApi(admin, peticion()), null);
});

test("una clave válida resuelve al usuario_id de la fila, nunca a uno inventado", async () => {
  const { clave, hash } = generarClave();
  const { admin, actualizaciones } = adminFalso([{ id: "k1", usuario_id: "u1", hash, revocada_en: null }]);

  const resuelto = await resolverClaveApi(admin, peticion(`Bearer ${clave}`));

  assert.deepEqual(resuelto, { usuarioId: "u1", claveId: "k1" });
  assert.equal(actualizaciones.length, 1);
  assert.equal(actualizaciones[0].id, "k1");
});

test("una clave que no está en la tabla no resuelve", async () => {
  const { admin } = adminFalso([{ id: "k1", usuario_id: "u1", hash: hashDeClave("otra"), revocada_en: null }]);
  const { clave } = generarClave();
  assert.equal(await resolverClaveApi(admin, peticion(`Bearer ${clave}`)), null);
});

test("una clave revocada no resuelve", async () => {
  const { clave, hash } = generarClave();
  const { admin } = adminFalso([{ id: "k1", usuario_id: "u1", hash, revocada_en: "2026-11-07T00:00:00Z" }]);
  assert.equal(await resolverClaveApi(admin, peticion(`Bearer ${clave}`)), null);
});
