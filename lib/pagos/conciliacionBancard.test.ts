import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chargeSinRespuestaEsIncierto,
  conciliarPendientesBancard,
  interpretarConfirmacion,
  tieneCobroIncierto,
  type ConsultaBancard,
} from "./conciliacionBancard.ts";

const aprobada: ConsultaBancard = {
  ok: true,
  data: { status: "success", confirmation: { response: "S", response_code: "00", authorization_number: "123" } },
};
const rechazada: ConsultaBancard = {
  ok: true,
  data: { status: "success", confirmation: { response: "N", response_code: "05" } },
};

test("aprobado solo con S y código 00", () => {
  assert.equal(interpretarConfirmacion(aprobada), "aprobado");
  assert.equal(
    interpretarConfirmacion({ ok: true, data: { confirmation: { response: "S", response_code: "12" } } }),
    "rechazado",
  );
  assert.equal(interpretarConfirmacion(rechazada), "rechazado");
});

test("sin respuesta definitiva no se adivina", () => {
  assert.equal(interpretarConfirmacion({ ok: false, data: null }), "desconocido");
  assert.equal(
    interpretarConfirmacion({ ok: false, data: { status: "error", messages: [{ key: "PaymentNotFoundError" }] } }),
    "desconocido",
  );
  assert.equal(interpretarConfirmacion({ ok: true, data: {} }), "desconocido");
  assert.equal(interpretarConfirmacion({ ok: true, data: { confirmation: { response: "P" } } }), "desconocido");
});

test("un charge cortado es incierto; un rechazo de la API con mensajes no lo es", () => {
  assert.equal(chargeSinRespuestaEsIncierto(0, null), true, "timeout / red");
  assert.equal(chargeSinRespuestaEsIncierto(504, { status: "error", raw: "<html>" }), true);
  assert.equal(chargeSinRespuestaEsIncierto(200, { status: "error", raw: "no es json" }), true);
  assert.equal(
    chargeSinRespuestaEsIncierto(400, { status: "error", messages: [{ key: "InvalidJsonError" }] }),
    false,
  );
});

/** Un cliente admin de mentira: guarda los filtros y devuelve filas fijas. */
function adminFalso(filas: Array<Record<string, unknown>>, opciones: { errorSelect?: boolean; errorUpdate?: boolean } = {}) {
  const rpcs: Array<{ nombre: string; args: Record<string, unknown> }> = [];
  const filtros: Array<[string, string, unknown]> = [];
  const updates: Array<{ id: unknown; valores: Record<string, unknown> }> = [];

  const consulta: Record<string, unknown> = {};
  const encadenar = (op: string) => (col: string, val: unknown) => {
    filtros.push([op, col, val]);
    return consulta;
  };
  for (const op of ["eq", "lte", "gte", "order"]) consulta[op] = encadenar(op);
  consulta.select = () => consulta;
  consulta.not = (col: string, _op: string, val: unknown) => {
    filtros.push(["not", col, val]);
    return consulta;
  };
  consulta.limit = async () =>
    opciones.errorSelect ? { data: null, error: { message: "caída" } } : { data: filas, error: null };

  /*
   * `.update(valores).eq(...).eq(...)` se arma de nuevo en cada llamada (como
   * el builder real de supabase-js): cada `.update()` cierra sobre SUS
   * propios `valores` y SUS propios filtros, y el objeto es "thenable" —
   * `await` lo resuelve solo, sin un `.limit()` final.
   */
  consulta.update = (valores: Record<string, unknown>) => {
    const filtrosUpdate: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {
      eq(col: string, val: unknown) {
        filtrosUpdate.push([col, val]);
        return builder;
      },
      then(resolve: (v: unknown) => void) {
        const id = filtrosUpdate.find(([c]) => c === "id")?.[1];
        updates.push({ id, valores });
        resolve(opciones.errorUpdate ? { error: { message: "no se pudo" } } : { error: null });
      },
    };
    return builder;
  };

  return {
    rpcs,
    filtros,
    updates,
    from: () => consulta,
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      rpcs.push({ nombre, args });
      return { data: { idempotent: false, plan_codigo: "pro" }, error: null };
    },
  };
}

test("concilia: aprueba lo que Bancard cobró, rechaza lo rechazado, deja lo dudoso", async () => {
  const admin = adminFalso([
    { id: "s1", usuario_id: "u1", plan_codigo: "pro", referencia_externa: "101", created_at: "2026-10-09T00:00:00Z" },
    { id: "s2", usuario_id: "u2", plan_codigo: "pro", referencia_externa: "102", created_at: "2026-10-09T00:00:00Z" },
    { id: "s3", usuario_id: "u3", plan_codigo: "pro", referencia_externa: "103", created_at: "2026-10-09T00:00:00Z" },
  ]);
  const respuestas: Record<string, ConsultaBancard> = {
    "101": aprobada,
    "102": rechazada,
    "103": { ok: false, data: null },
  };
  const avisados: string[] = [];

  const resumen = await conciliarPendientesBancard(admin, {
    consultar: async (ref) => respuestas[ref],
    ahora: new Date("2026-10-10T00:00:00Z"),
    alAprobar: async (fila) => {
      avisados.push(fila.usuario_id);
    },
  });

  assert.deepEqual(resumen, { revisadas: 3, aprobadas: 1, rechazadas: 1, sin_respuesta: 1, vencidas: 0, errores: 0 });
  assert.deepEqual(
    admin.rpcs.map((r) => [r.args.p_shop_process_id, r.args.p_aprobado]),
    [
      ["101", true],
      ["102", false],
    ],
    "la solicitud dudosa no se toca",
  );
  assert.equal(admin.rpcs[0].nombre, "eos_bancard_confirmar_cobro_v51");
  assert.deepEqual(avisados, ["u1"]);
});

test("no toca lo recién creado: el webhook todavía puede llegar", async () => {
  const admin = adminFalso([]);
  const ahora = new Date("2026-09-24T12:00:00Z");
  await conciliarPendientesBancard(admin, { consultar: async () => aprobada, ahora });
  const lte = admin.filtros.find(([op, col]) => op === "lte" && col === "created_at");
  assert.equal(lte?.[2], "2026-09-24T11:50:00.000Z");
});

test("no hay tope de edad hacia atrás: algo de hace 40 días igual se trae", async () => {
  const admin = adminFalso([]);
  await conciliarPendientesBancard(admin, { consultar: async () => aprobada });
  assert.equal(
    admin.filtros.some(([op, col]) => op === "gte" && col === "created_at"),
    false,
    "ya no se descarta por edad en la consulta: el vencimiento se decide adentro",
  );
});

test("sin respuesta y dentro de la ventana, se deja pendiente para reintentar después", async () => {
  const admin = adminFalso([
    { id: "s1", usuario_id: "u1", plan_codigo: "pro", referencia_externa: "101", created_at: "2026-10-01T00:00:00Z" },
  ]);
  const ahora = new Date("2026-10-10T00:00:00Z");
  const resumen = await conciliarPendientesBancard(admin, { consultar: async () => ({ ok: false, data: null }), ahora });

  assert.equal(resumen.sin_respuesta, 1);
  assert.equal(resumen.vencidas, 0);
  assert.deepEqual(admin.updates, []);
});

test("sin respuesta y pasados los 30 días, se cierra como vencido y se avisa", async () => {
  const admin = adminFalso([
    { id: "s1", usuario_id: "u1", plan_codigo: "pro", referencia_externa: "101", created_at: "2026-09-01T00:00:00Z" },
  ]);
  const ahora = new Date("2026-10-10T00:00:00Z"); // 39 días después
  const avisados: string[] = [];

  const resumen = await conciliarPendientesBancard(admin, {
    consultar: async () => ({ ok: false, data: null }),
    ahora,
    alVencer: async (fila) => {
      avisados.push(fila.id);
    },
  });

  assert.equal(resumen.sin_respuesta, 1);
  assert.equal(resumen.vencidas, 1);
  assert.deepEqual(admin.updates, [{ id: "s1", valores: { estado: "vencido" } }]);
  assert.deepEqual(avisados, ["s1"]);
});

test("si vencer falla en la base, no se avisa y no se cuenta como vencida", async () => {
  const admin = adminFalso(
    [{ id: "s1", usuario_id: "u1", plan_codigo: "pro", referencia_externa: "101", created_at: "2026-09-01T00:00:00Z" }],
    { errorUpdate: true },
  );
  const ahora = new Date("2026-10-10T00:00:00Z");
  const avisados: string[] = [];

  const resumen = await conciliarPendientesBancard(admin, {
    consultar: async () => ({ ok: false, data: null }),
    ahora,
    alVencer: async (fila) => {
      avisados.push(fila.id);
    },
  });

  assert.equal(resumen.vencidas, 0);
  assert.deepEqual(avisados, []);
});

test("un diasMaximo distinto se respeta", async () => {
  const admin = adminFalso([
    { id: "s1", usuario_id: "u1", plan_codigo: "pro", referencia_externa: "101", created_at: "2026-10-01T00:00:00Z" },
  ]);
  const ahora = new Date("2026-10-10T00:00:00Z"); // 9 días después
  const resumen = await conciliarPendientesBancard(admin, {
    consultar: async () => ({ ok: false, data: null }),
    ahora,
    diasMaximo: 5,
  });
  assert.equal(resumen.vencidas, 1, "con el tope bajado a 5 días, 9 días ya cuenta como vencido");
});

test("una consulta que lanza no corta la pasada", async () => {
  const admin = adminFalso([
    { id: "s1", usuario_id: "u1", plan_codigo: "pro", referencia_externa: "101" },
    { id: "s2", usuario_id: "u2", plan_codigo: "pro", referencia_externa: "102" },
  ]);
  const resumen = await conciliarPendientesBancard(admin, {
    consultar: async (ref) => {
      if (ref === "101") throw new Error("red");
      return aprobada;
    },
  });
  assert.equal(resumen.errores, 1);
  assert.equal(resumen.aprobadas, 1);
});

test("si no se puede saber si hay un cobro incierto, se asume que sí", async () => {
  assert.equal(await tieneCobroIncierto(adminFalso([], { errorSelect: true }), "u1"), true);
  assert.equal(await tieneCobroIncierto(adminFalso([]), "u1"), false);
  assert.equal(await tieneCobroIncierto(adminFalso([{ id: "s1" }]), "u1"), true);
});
