import assert from "node:assert/strict";
import test from "node:test";

import { filasDelTurno, guardarTurno, type ClienteMensajes, type FilaMensaje } from "./turno.ts";

/**
 * Del 29/09 al 05/10/2026 ningún turno de WhatsApp quedó guardado: el insert
 * mandaba `metadata` solo en la fila de la persona y `supabase-js` le ponía
 * NULL a la de EOS (columna NOT NULL). Este cliente falso hace lo mismo que
 * PostgREST con un insert de varias filas: columnas = la unión de las claves,
 * y lo que le falta a una fila es NULL, salvo `defaultToNull: false`.
 */
function basePostgrest({ fallaSiempre = false } = {}) {
  const guardadas: Array<Record<string, unknown>> = [];
  const lotes: Array<{ filas: FilaMensaje[]; defaultToNull?: boolean }> = [];

  const cliente: ClienteMensajes = {
    from: () => ({
      insert: (filas, opciones) => ({
        select: async () => {
          lotes.push({ filas, defaultToNull: opciones?.defaultToNull });
          if (fallaSiempre) return { data: null, error: { code: "57014", message: "timeout" } };

          const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))];
          const completas = filas.map((f) => {
            const r: Record<string, unknown> = {};
            for (const c of columnas) {
              if (c in f) r[c] = (f as Record<string, unknown>)[c];
              else r[c] = opciones?.defaultToNull === false ? undefined : null;
            }
            // `metadata` NOT NULL default '{}'
            if (r.metadata === undefined) r.metadata = {};
            return r;
          });
          if (completas.some((r) => r.metadata === null)) {
            return { data: null, error: { code: "23502", message: 'null value in column "metadata"' } };
          }
          const conId = completas.map((r, i) => ({ ...r, id: `id-${guardadas.length + i}` }) as Record<string, unknown>);
          guardadas.push(...conId);
          return { data: conId.map((r) => ({ id: r.id, rol: r.rol })), error: null };
        },
      }),
    }),
  };
  return { cliente, guardadas, lotes };
}

const TURNO = {
  conversacionId: "c1",
  usuarioId: "u1",
  textoUsuario: "En respuesta a este mensaje de EOS:\n> Costo final del zapato marrón mocha: ₲125.245,4.\n\nRegistra la venta de esto",
  textoEos: "Para registrarla me falta a cuánto lo vendiste.",
  waIds: ["wamid.A"],
};

test("el insert de antes (metadata solo en la fila de la persona) falla con 23502: así se perdió el historial", async () => {
  const { cliente } = basePostgrest();
  const r = await cliente
    .from("mensajes")
    .insert([
      { ...filasDelTurno(TURNO)[0] },
      // La fila de EOS como estaba en el webhook: sin `metadata`.
      { conversacion_id: "c1", usuario_id: "u1", rol: "eos", texto: "x", origen: "whatsapp" } as FilaMensaje,
    ])
    .select("id, rol");
  assert.equal(r.error?.code, "23502");
});

test("las dos filas del turno tienen exactamente las mismas columnas", () => {
  const [persona, eos] = filasDelTurno(TURNO);
  assert.deepEqual(Object.keys(persona).sort(), Object.keys(eos).sort());
  assert.deepEqual(persona.metadata, { wa_ids: ["wamid.A"] });
  assert.deepEqual(eos.metadata, {});
  assert.equal(persona.rol, "usuario");
  assert.equal(eos.rol, "eos");
});

test("sin ids de WhatsApp, metadata vacía en las dos (nunca ausente)", () => {
  const [persona, eos] = filasDelTurno({ ...TURNO, waIds: [] });
  assert.deepEqual(persona.metadata, {});
  assert.deepEqual(eos.metadata, {});
});

test("un turno sin texto de la persona (solo una foto) se guarda como [adjunto]", () => {
  assert.equal(filasDelTurno({ ...TURNO, textoUsuario: "" })[0].texto, "[adjunto]");
});

test("se guarda el turno entero, con defaultToNull: false, y devuelve el id de la fila de EOS", async () => {
  const { cliente, guardadas, lotes } = basePostgrest();
  const r = await guardarTurno(cliente, TURNO);
  assert.equal(r.error, null);
  assert.equal(r.guardadas, 2);
  assert.equal(guardadas.length, 2);
  assert.equal(lotes[0].defaultToNull, false);
  assert.equal(r.idEos, guardadas.find((g) => g.rol === "eos")?.id);
  // El mensaje citado queda adentro de lo que dijo la persona: el turno siguiente lo ve.
  assert.match(String(guardadas[0].texto), /zapato marrón mocha/);
});

test("si el insert de las dos falla, se intenta fila por fila y se dice cuántas quedaron", async () => {
  const { cliente, lotes } = basePostgrest({ fallaSiempre: true });
  const r = await guardarTurno(cliente, TURNO);
  assert.equal(r.guardadas, 0);
  assert.equal(r.idEos, null);
  assert.ok(r.error);
  // Uno con las dos, y uno por cada fila.
  assert.deepEqual(lotes.map((l) => l.filas.length), [2, 1, 1]);
});

test("guardarTurno no lanza aunque el cliente lance", async () => {
  const cliente = {
    from: () => ({
      insert: () => ({
        select: () => Promise.reject(new Error("red caída")),
      }),
    }),
  } as unknown as ClienteMensajes;
  const r = await guardarTurno(cliente, TURNO);
  assert.equal(r.guardadas, 0);
});
