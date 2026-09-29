import test from "node:test";
import assert from "node:assert/strict";

import { entregarAviso } from "./avisarRiesgos.ts";

/*
 * Una base falsa: la reserva del día (rpc), el correo del usuario y la
 * actualización del resultado en la historia. Push no está configurado en las
 * pruebas, así que el aviso sale por correo.
 */
function baseFalsa(reserva: { data: unknown; error: unknown }) {
  const actualizaciones: Record<string, unknown>[] = [];
  const admin = {
    rpc: async () => reserva,
    from: (tabla: string) => {
      if (tabla === "eos_avisos_historial_v217") {
        return {
          update: (valores: Record<string, unknown>) => ({
            eq: () => ({ eq: async () => (actualizaciones.push(valores), { error: null }) }),
          }),
        };
      }
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () =>
          tabla === "usuarios" ? { data: { email: "a@b.c" }, error: null } : { data: null, error: null },
      };
      return q;
    },
  };
  return { admin, actualizaciones };
}

const registro = { familia: "negocio" as const, tipo: "inventario_bajo", clave: "harina" };

test("sin lugar en el día, no manda nada y devuelve false (mañana se reintenta)", async () => {
  const { admin, actualizaciones } = baseFalsa({ data: null, error: null });
  const enviados: string[] = [];
  const ok = await entregarAviso(admin, "u1", "Te queda poca harina", async (c) => void enviados.push(c.texto), registro, "2026-10-01");
  assert.equal(ok, false);
  assert.equal(enviados.length, 0);
  assert.equal(actualizaciones.length, 0);
});

test("con lugar, manda y anota que se entregó", async () => {
  const { admin, actualizaciones } = baseFalsa({ data: "reserva-1", error: null });
  const enviados: string[] = [];
  const ok = await entregarAviso(admin, "u1", "Te queda poca harina", async (c) => void enviados.push(c.texto), registro, "2026-10-01");
  assert.equal(ok, true);
  assert.equal(enviados.length, 1);
  assert.deepEqual(actualizaciones, [{ resultado: "entregado" }]);
});

test("sin canal, anota sin_canal para que no ocupe el lugar", async () => {
  const { admin, actualizaciones } = baseFalsa({ data: "reserva-1", error: null });
  const ok = await entregarAviso(admin, "u1", "Te queda poca harina", undefined, registro, "2026-10-01");
  assert.equal(ok, false);
  assert.deepEqual(actualizaciones, [{ resultado: "sin_canal" }]);
});

test("si la reserva falla por un error, el aviso sale igual", async () => {
  const { admin } = baseFalsa({ data: null, error: { message: "no existe la función" } });
  const enviados: string[] = [];
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    const ok = await entregarAviso(admin, "u1", "Te queda poca harina", async (c) => void enviados.push(c.texto), registro, "2026-10-01");
    assert.equal(ok, true);
    assert.equal(enviados.length, 1);
  } finally {
    console.error = errorOriginal;
  }
});
