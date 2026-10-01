import assert from "node:assert/strict";
import { test } from "node:test";

import { baseDeLaApp, resolverAprobacion, type FilaAprobacion } from "./resolver-aprobacion.ts";

const USUARIO = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const COMANDO = "44444444-4444-4444-8444-444444444444";

/** Una tabla en memoria con lo que usa el módulo: select/update con .eq y status. */
function base(filas: FilaAprobacion[]) {
  const tabla = filas.map((f) => ({ ...f }));
  const cliente = {
    from() {
      const filtros: [string, unknown][] = [];
      let cambio: Record<string, unknown> | null = null;
      const q = {
        select() { return q; },
        update(v: Record<string, unknown>) { cambio = v; return q; },
        eq(c: string, v: unknown) { filtros.push([c, v]); return q; },
        async maybeSingle() {
          const f = tabla.find((x) => filtros.every(([c, v]) => (x as Record<string, unknown>)[c] === v));
          return { data: f ?? null, error: null };
        },
        async single() {
          const f = tabla.find((x) => filtros.every(([c, v]) => (x as Record<string, unknown>)[c] === v));
          if (!f) return { data: null, error: { message: "0 filas" } };
          if (cambio) Object.assign(f, cambio, { decided_at: "ahora" });
          return { data: { ...f }, error: null };
        },
      };
      return q;
    },
  };
  return { tabla, cliente };
}

function fila(extra: Partial<FilaAprobacion> = {}): FilaAprobacion {
  return {
    id: ID,
    usuario_id: USUARIO,
    request_id: "55555555-5555-4555-8555-555555555555",
    accion: "REGISTRAR_VENTA",
    status: "pending",
    payload_snapshot: { datos: { items: [{ producto: "Balanceado", cantidad: 3 }] } },
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...extra,
  };
}

function fetchFalso(respuestas: { autorizar?: unknown; efecto?: unknown; okAutorizar?: boolean; okEfecto?: boolean }) {
  const llamadas: string[] = [];
  const f = (async (url: string) => {
    llamadas.push(String(url));
    const esAutorizar = String(url).includes("worker-authorize");
    const cuerpo = esAutorizar
      ? (respuestas.autorizar ?? { ok: true, execute: true, command_id: COMANDO })
      : (respuestas.efecto ?? { ok: true });
    const ok = esAutorizar ? respuestas.okAutorizar !== false : respuestas.okEfecto !== false;
    return new Response(JSON.stringify(cuerpo), { status: ok ? 200 : 409 });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

const ENV = { EOS_WORKER_GATE_SECRET: "s", EOS_APP_BASE_URL: "https://app.test" };

test("aprobar: marca una vez, audita, revalida y ejecuta", async () => {
  const { tabla, cliente } = base([fila()]);
  const auditoria: unknown[] = [];
  const { f, llamadas } = fetchFalso({});
  const r = await resolverAprobacion(
    { usuarioId: USUARIO, id: ID, decision: "approved", origen: "chat", canal: "whatsapp", detalle: { wa_ids: ["w1"] } },
    { cliente, auditar: async (e) => auditoria.push(e), fetch: f, env: ENV },
  );
  assert.equal(r.tipo, "ejecutada");
  assert.equal(tabla[0].status, "approved");
  assert.equal(auditoria.length, 1);
  assert.deepEqual((auditoria[0] as { detalle: Record<string, unknown> }).detalle.canal, "whatsapp");
  assert.deepEqual(llamadas, ["https://app.test/api/internal/worker-authorize/v1", "https://app.test/api/internal/action-effects/v1"]);
});

test("rechazar: no ejecuta nada", async () => {
  const { tabla, cliente } = base([fila()]);
  const { f, llamadas } = fetchFalso({});
  const r = await resolverAprobacion(
    { usuarioId: USUARIO, id: ID, decision: "rejected", origen: "panel" },
    { cliente, auditar: async () => {}, fetch: f, env: ENV },
  );
  assert.equal(r.tipo, "rechazada");
  assert.equal(tabla[0].status, "rejected");
  assert.equal(llamadas.length, 0);
});

test("la aprobación de otra cuenta no se encuentra", async () => {
  const { cliente } = base([fila({ usuario_id: OTRO })]);
  const r = await resolverAprobacion(
    { usuarioId: USUARIO, id: ID, decision: "approved", origen: "chat" },
    { cliente, auditar: async () => {}, fetch: fetchFalso({}).f, env: ENV },
  );
  assert.equal(r.tipo, "no_encontrada");
});

test("vencida no se aprueba ni se rechaza", async () => {
  const { tabla, cliente } = base([fila({ expires_at: new Date(Date.now() - 1000).toISOString() })]);
  for (const decision of ["approved", "rejected"] as const) {
    const r = await resolverAprobacion(
      { usuarioId: USUARIO, id: ID, decision, origen: "chat" },
      { cliente, auditar: async () => {}, fetch: fetchFalso({}).f, env: ENV },
    );
    assert.equal(r.tipo, "vencida");
  }
  assert.equal(tabla[0].status, "pending");
});

test("ya consumida o rechazada: no se vuelve a resolver", async () => {
  for (const status of ["consumed", "rejected", "expired"]) {
    const { cliente } = base([fila({ status })]);
    const { f, llamadas } = fetchFalso({});
    const r = await resolverAprobacion(
      { usuarioId: USUARIO, id: ID, decision: "approved", origen: "chat" },
      { cliente, auditar: async () => {}, fetch: f, env: ENV },
    );
    assert.equal(r.tipo, "ya_resuelta", status);
    assert.equal(llamadas.length, 0);
  }
});

test("dos SÍ seguidos: el segundo no la vuelve a marcar ni a auditar", async () => {
  const { cliente } = base([fila()]);
  const auditoria: unknown[] = [];
  const deps = { cliente, auditar: async (e: unknown) => auditoria.push(e), fetch: fetchFalso({}).f, env: ENV };
  await resolverAprobacion({ usuarioId: USUARIO, id: ID, decision: "approved", origen: "chat" }, deps);
  // Ya aprobada: va directo a revalidar; el Worker Gate es el que no deja ejecutar dos veces.
  const segunda = await resolverAprobacion(
    { usuarioId: USUARIO, id: ID, decision: "approved", origen: "chat" },
    { ...deps, fetch: fetchFalso({ autorizar: { ok: false, execute: false }, okAutorizar: false }).f },
  );
  assert.equal(segunda.tipo, "no_revalidada");
  assert.equal(auditoria.length, 1);
});

test("si el Worker Gate no revalida, no se ejecuta el efecto", async () => {
  const { cliente } = base([fila()]);
  const { f, llamadas } = fetchFalso({ autorizar: { ok: true, execute: false }, okAutorizar: true });
  const r = await resolverAprobacion(
    { usuarioId: USUARIO, id: ID, decision: "approved", origen: "chat" },
    { cliente, auditar: async () => {}, fetch: f, env: ENV },
  );
  assert.equal(r.tipo, "no_revalidada");
  assert.equal(llamadas.length, 1);
});

test("si el efecto falla, se informa como no ejecutada", async () => {
  const { cliente } = base([fila()]);
  const r = await resolverAprobacion(
    { usuarioId: USUARIO, id: ID, decision: "approved", origen: "chat" },
    { cliente, auditar: async () => {}, fetch: fetchFalso({ efecto: { ok: false }, okEfecto: false }).f, env: ENV },
  );
  assert.equal(r.tipo, "no_ejecutada");
});

test("sin secreto: la aprobación queda anotada pero no se ejecuta", async () => {
  const { tabla, cliente } = base([fila()]);
  const r = await resolverAprobacion(
    { usuarioId: USUARIO, id: ID, decision: "approved", origen: "panel" },
    { cliente, auditar: async () => {}, fetch: fetchFalso({}).f, env: {} },
  );
  assert.equal(r.tipo, "sin_ejecutor");
  assert.equal(tabla[0].status, "approved");
});

test("la base es la app, nunca una URL de preview vieja", () => {
  assert.equal(baseDeLaApp({}), "https://www.transtech.com.py");
  assert.equal(baseDeLaApp({ EOS_APP_BASE_URL: "https://x.test/" }), "https://x.test");
});
