import assert from "node:assert/strict";
import test from "node:test";

import {
  atenderCanalEmpresa,
  buscarCanalEmpresa,
  prepararEntrantes,
  type ValorWebhook,
} from "./entrante.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

const AHORA = "2026-09-18T13:00:00.000Z";

const valor = (parcial: Partial<ValorWebhook>): ValorWebhook => ({ metadata: { phone_number_id: "111" }, ...parcial });

test("un mensaje de texto se lee con su remitente, nombre de perfil e intención", () => {
  const r = prepararEntrantes(
    valor({
      contacts: [{ wa_id: "595981123456", profile: { name: " Carlos " } }],
      messages: [
        {
          id: "wamid.1",
          from: "595981123456",
          timestamp: "1789736400",
          type: "text",
          text: { body: "Estoy interesado en el plan empresarial, ¿cuánto cuesta?" },
        },
      ],
    }),
    AHORA,
  );

  assert.equal(r.length, 1);
  const m = r[0];
  assert.equal(m.clase, "mensaje");
  if (m.clase !== "mensaje") return;
  assert.equal(m.telefono, "595981123456");
  assert.equal(m.nombre_perfil, "Carlos");
  assert.equal(m.tipo, "texto");
  assert.equal(m.intencion, "consulta_precio");
  assert.equal(m.ocurrio_en, new Date(1789736400 * 1000).toISOString());
});

test("sin timestamp válido se usa el momento de recepción", () => {
  const r = prepararEntrantes(
    valor({ messages: [{ id: "a", from: "595981123456", type: "text", text: { body: "hola" }, timestamp: "abc" }] }),
    AHORA,
  );
  assert.equal(r[0].clase === "mensaje" && r[0].ocurrio_en, AHORA);
});

test("un mensaje sin id o sin remitente se descarta: no se puede deduplicar ni asociar", () => {
  const r = prepararEntrantes(
    valor({
      messages: [
        { from: "595981123456", type: "text", text: { body: "sin id" } },
        { id: "x", type: "text", text: { body: "sin remitente" } },
      ],
    }),
    AHORA,
  );
  assert.deepEqual(r, []);
});

test("un botón o un pie de foto también cuentan como texto", () => {
  const r = prepararEntrantes(
    valor({
      messages: [
        { id: "1", from: "595981123456", type: "button", button: { text: "Quiero comprar" } },
        { id: "2", from: "595981123456", type: "image", image: { caption: "STOP" } },
        { id: "3", from: "595981123456", type: "interactive", interactive: { button_reply: { title: "Me interesa" } } },
      ],
    }),
    AHORA,
  );
  assert.deepEqual(
    r.map((x) => x.clase === "mensaje" && x.intencion),
    ["confirma_compra", "baja", "interes"],
  );
});

test("un audio sin texto se registra igual, como otro tipo, sin intención", () => {
  const r = prepararEntrantes(valor({ messages: [{ id: "1", from: "595981123456", type: "audio", audio: {} }] }), AHORA);
  const m = r[0];
  assert.equal(m.clase === "mensaje" && m.tipo, "audio");
  assert.equal(m.clase === "mensaje" && m.intencion, "otro");
});

test("las confirmaciones de Meta se traducen a los estados del mensaje", () => {
  const r = prepararEntrantes(
    valor({
      statuses: [
        { id: "w1", status: "sent" },
        { id: "w2", status: "delivered" },
        { id: "w3", status: "read" },
        { id: "w4", status: "failed", errors: [{ title: "Número no válido" }] },
        { id: "w5", status: "deleted" },
        { status: "sent" },
      ],
    }),
    AHORA,
  );

  assert.deepEqual(
    r.map((x) => x.clase === "estado" && [x.wa_message_id, x.estado, x.motivo]),
    [
      ["w1", "enviado", ""],
      ["w2", "entregado", ""],
      ["w3", "leido", ""],
      ["w4", "fallido", "Número no válido"],
    ],
  );
});

// ------------------------------------------------------------ contra la base

type Llamada = { fn: string; args: Record<string, unknown> };

function baseFalsa(respuestas: Record<string, unknown> = {}, falla: string | null = null) {
  const llamadas: Llamada[] = [];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args });
      if (falla === fn) return { data: null, error: new Error("boom") };
      return { data: respuestas[fn] ?? {}, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: respuestas["canal"] ?? null, error: null }),
        }),
      }),
    }),
  } as unknown as ClienteSinTipos;

  return { admin, llamadas };
}

const CANAL = { id: "c1", usuario_id: "u1", estado: "activo" };

test("un mensaje del cliente llega a la base con la intención ya leída", async () => {
  const { admin, llamadas } = baseFalsa({ eos_wa_recibir_v177: { duplicado: false, contacto_nuevo: true } });

  const r = await atenderCanalEmpresa(
    admin,
    CANAL,
    valor({ messages: [{ id: "w1", from: "595981123456", type: "text", text: { body: "Lo voy a pensar" } }] }),
    AHORA,
  );

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].fn, "eos_wa_recibir_v177");
  assert.equal(llamadas[0].args.p_canal_id, "c1");
  assert.equal(llamadas[0].args.p_intencion, "lo_pensara");
  assert.deepEqual(r, { mensajes: 1, duplicados: 0, clientes_nuevos: 1, bajas: 0, estados: 0, errores: 0 });
});

test("un reintento de Meta se cuenta como duplicado y no como mensaje nuevo", async () => {
  const { admin } = baseFalsa({ eos_wa_recibir_v177: { duplicado: true } });
  const r = await atenderCanalEmpresa(
    admin,
    CANAL,
    valor({ messages: [{ id: "w1", from: "595981123456", type: "text", text: { body: "hola" } }] }),
    AHORA,
  );
  assert.equal(r.duplicados, 1);
  assert.equal(r.mensajes, 0);
});

test("una baja se cuenta y se le informa al que llama", async () => {
  const { admin } = baseFalsa({ eos_wa_recibir_v177: { duplicado: false, opt_out: true } });
  const r = await atenderCanalEmpresa(
    admin,
    CANAL,
    valor({ messages: [{ id: "w1", from: "595981123456", type: "text", text: { body: "STOP" } }] }),
    AHORA,
  );
  assert.equal(r.bajas, 1);
});

test("un canal desconectado no registra nada", async () => {
  const { admin, llamadas } = baseFalsa();
  const r = await atenderCanalEmpresa(
    admin,
    { ...CANAL, estado: "desconectado" },
    valor({ messages: [{ id: "w1", from: "595981123456", type: "text", text: { body: "hola" } }] }),
    AHORA,
  );
  assert.equal(llamadas.length, 0);
  assert.equal(r.mensajes, 0);
});

test("pausado o pendiente SÍ registra: el historial no se pierde porque el envío esté detenido", async () => {
  for (const estado of ["pausado", "pendiente"]) {
    const { admin, llamadas } = baseFalsa();
    await atenderCanalEmpresa(
      admin,
      { ...CANAL, estado },
      valor({ messages: [{ id: "w1", from: "595981123456", type: "text", text: { body: "hola" } }] }),
      AHORA,
    );
    assert.equal(llamadas.length, 1, estado);
  }
});

test("si la base falla en uno, se cuenta el error y los demás se registran igual", async () => {
  const { admin, llamadas } = baseFalsa({}, "eos_wa_actualizar_estado_v177");
  const r = await atenderCanalEmpresa(
    admin,
    CANAL,
    valor({
      messages: [{ id: "w1", from: "595981123456", type: "text", text: { body: "hola" } }],
      statuses: [{ id: "w9", status: "read" }],
    }),
    AHORA,
  );

  assert.equal(llamadas.length, 2);
  assert.equal(r.errores, 1);
  assert.equal(r.mensajes, 1);
});

test("los estados de Meta se aplican por el id de Meta, sin id interno", async () => {
  const { admin, llamadas } = baseFalsa({ eos_wa_actualizar_estado_v177: 1 });
  await atenderCanalEmpresa(admin, CANAL, valor({ statuses: [{ id: "w9", status: "delivered" }] }), AHORA);

  assert.equal(llamadas[0].fn, "eos_wa_actualizar_estado_v177");
  assert.equal(llamadas[0].args.p_mensaje_id, null);
  assert.equal(llamadas[0].args.p_wa_message_id, "w9");
  assert.equal(llamadas[0].args.p_estado, "entregado");
});

test("buscarCanalEmpresa: sin id no consulta y devuelve null", async () => {
  const { admin } = baseFalsa({ canal: CANAL });
  assert.equal(await buscarCanalEmpresa(admin, undefined), null);
  assert.equal(await buscarCanalEmpresa(admin, "  "), null);
  assert.deepEqual(await buscarCanalEmpresa(admin, "111"), CANAL);
});

test("buscarCanalEmpresa: un error de lectura se propaga, no se disfraza de 'no es de una empresa'", async () => {
  const admin = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "caída" } }) }) }),
    }),
  } as unknown as ClienteSinTipos;

  await assert.rejects(() => buscarCanalEmpresa(admin, "111"), /caída/);
});

test("buscarCanalEmpresa: si la tabla todavía no existe (deploy antes que la migración), no tumba el webhook", async () => {
  for (const code of ["42P01", "PGRST205"]) {
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { code, message: "no existe" } }) }),
        }),
      }),
    } as unknown as ClienteSinTipos;

    assert.equal(await buscarCanalEmpresa(admin, "111"), null, code);
  }
});
