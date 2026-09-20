import assert from "node:assert/strict";
import test from "node:test";

import { enviarDesdeElChat, fraseDelEnvio, type EnvioDeChat } from "./envio-por-chat.ts";
import { baseFalsa } from "./base-falsa.ts";
import type { Fetcher } from "./meta.ts";

const AHORA = "2026-09-18T13:00:00Z";
const TOKEN = "EAAG" + "x".repeat(40);
const CONTACTO_ID = "11111111-1111-4111-8111-111111111111";
const CANAL_ID = "22222222-2222-4222-8222-222222222222";
const ORDEN = "33333333-3333-4333-8333-333333333333";

const guion = (contexto: Record<string, unknown> = {}) =>
  ({
    "eos_wa_canales.select": { data: { id: CANAL_ID, estado: "activo", phone_number_id: "123456789" }, error: null },
    "eos_crm_contactos.select": { data: { id: CONTACTO_ID, nombre: "Marcos", telefono: "0981 123 456" }, error: null },
    "rpc:eos_wa_contexto_envio_v177": {
      data: {
        canal: { estado: "activo", limite_diario: 250, enviados_hoy: 0, limite_por_contacto_dia: 2, silencio_desde_hora: 21, silencio_hasta_hora: 7 },
        consentimiento: "otorgado",
        ultimo_entrante_en: "2026-09-18T12:30:00Z",
        enviados_a_este_contacto_hoy: 0,
        ...contexto,
      },
      error: null,
    },
    "rpc:eos_wa_registrar_saliente_v177": { data: { duplicado: false, mensaje_id: "m-1", telefono: "595981123456" }, error: null },
    "rpc:eos_wa_leer_secreto_v185": { data: TOKEN, error: null },
    "rpc:eos_wa_actualizar_estado_v177": { data: 1, error: null },
  }) as never;

const resultadoDelEjecutor = { contacto_id: CONTACTO_ID, canal_id: CANAL_ID, mensaje: "Hola Marcos, ¿pudiste ver la propuesta?" };

function meta() {
  const llamadas: unknown[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    llamadas.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ messages: [{ id: "wamid.OUT" }] }), { status: 200 });
  }) as unknown as Fetcher;
  return { fetcher, llamadas };
}

test("dentro de la ventana de 24 horas, el mensaje sale y se dice que salió", async () => {
  const { admin } = baseFalsa(guion());
  const m = meta();
  const r = await enviarDesdeElChat(admin, { usuarioId: "u-1", commandId: ORDEN, resultado: resultadoDelEjecutor, ahora: AHORA }, m.fetcher);

  assert.equal(r.estado, "enviado");
  assert.equal(m.llamadas.length, 1);
  assert.equal(fraseDelEnvio("Marcos", r), "Listo, le escribí a Marcos por WhatsApp.");
});

test("la clave del envío es la de la orden: el reintento no manda dos veces", async () => {
  const { admin, pedidos } = baseFalsa(guion());
  await enviarDesdeElChat(admin, { usuarioId: "u-1", commandId: ORDEN, resultado: resultadoDelEjecutor, ahora: AHORA }, meta().fetcher);

  const registro = pedidos.find((p) => p.clave === "rpc:eos_wa_registrar_saliente_v177")!;
  assert.equal((registro.args as { p_clave: string }).p_clave, `cmd:${ORDEN}`);
});

test("un envío ya registrado se reporta como ya enviado, sin volver a llamar a Meta", async () => {
  const g = guion() as Record<string, unknown>;
  g["rpc:eos_wa_registrar_saliente_v177"] = { data: { duplicado: true, mensaje_id: "m-1", estado: "enviado", telefono: "595981123456" }, error: null };
  const { admin } = baseFalsa(g as never);
  const m = meta();
  const r = await enviarDesdeElChat(admin, { usuarioId: "u-1", commandId: ORDEN, resultado: resultadoDelEjecutor, ahora: AHORA }, m.fetcher);

  assert.equal(r.estado, "ya_enviado");
  assert.equal(m.llamadas.length, 0);
  assert.match(fraseDelEnvio("Marcos", r), /ya estaba enviado/);
});

test("fuera de la ventana de 24 horas NO sale y el chat lo dice con el motivo", async () => {
  const { admin } = baseFalsa(guion({ ultimo_entrante_en: "2026-09-10T12:00:00Z" }));
  const m = meta();
  const r = await enviarDesdeElChat(admin, { usuarioId: "u-1", commandId: ORDEN, resultado: resultadoDelEjecutor, ahora: AHORA }, m.fetcher);

  assert.notEqual(r.estado, "enviado");
  assert.equal(m.llamadas.length, 0);

  const frase = fraseDelEnvio("Marcos", r);
  assert.match(frase, /^No le escribí a Marcos/);
  assert.ok(!/Listo/.test(frase));
});

test("un cliente que pidió la baja no recibe nada, aunque el chat lo haya pedido", async () => {
  const { admin } = baseFalsa(guion({ consentimiento: "revocado" }));
  const m = meta();
  const r = await enviarDesdeElChat(admin, { usuarioId: "u-1", commandId: ORDEN, resultado: resultadoDelEjecutor, ahora: AHORA }, m.fetcher);

  assert.equal(r.estado, "bloqueado");
  assert.equal(m.llamadas.length, 0);
});

test("sin los datos que dejó el ejecutor no se intenta nada", async () => {
  const { admin, pedidos } = baseFalsa(guion());
  const m = meta();

  for (const resultado of [{}, { ...resultadoDelEjecutor, contacto_id: "no-es-uuid" }, { ...resultadoDelEjecutor, mensaje: "  " }]) {
    const r = await enviarDesdeElChat(admin, { usuarioId: "u-1", commandId: ORDEN, resultado, ahora: AHORA }, m.fetcher);
    assert.equal(r.estado, "invalido");
  }
  assert.equal(m.llamadas.length, 0);
  assert.equal(pedidos.length, 0);
});

test("si algo revienta, no se afirma que salió", async () => {
  const { admin } = baseFalsa(guion());
  const roto = (async () => {
    throw new Error("red caída");
  }) as unknown as Fetcher;
  const original = console.error;
  console.error = () => {};
  try {
    const r = await enviarDesdeElChat(admin, { usuarioId: "u-1", commandId: ORDEN, resultado: resultadoDelEjecutor, ahora: AHORA }, roto);
    assert.notEqual(r.estado, "enviado");
    assert.ok(!/Listo/.test(fraseDelEnvio("Marcos", r)));
  } finally {
    console.error = original;
  }
});

test("las frases: cada estado dice lo que pasó y nada más", () => {
  const casos: [EnvioDeChat | null, RegExp][] = [
    [{ estado: "pendiente_aprobacion", motivo: "Falta la aprobación" }, /esperando tu aprobación.*Falta la aprobación\./],
    [{ estado: "fallido", motivo: "Meta no contestó.", reintentable: true }, /No pude mandarle.*Probá de nuevo/],
    [{ estado: "fallido", motivo: "El token venció." }, /No pude mandarle.*token venció\.$/],
    [{ estado: "invalido", motivo: "No encontré a ese cliente" }, /No pude mandarle.*cliente\.$/],
    [{ estado: "pendiente" }, /No pude confirmar.*antes de reenviarlo/],
    [null, /No pude confirmar/],
  ];
  for (const [envio, esperado] of casos) assert.match(fraseDelEnvio("Marcos", envio), esperado);
});
