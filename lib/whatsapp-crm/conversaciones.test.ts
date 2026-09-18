import assert from "node:assert/strict";
import test from "node:test";

import { agruparConversaciones, type FilaMensaje } from "./conversaciones.ts";

const AHORA = "2026-09-18T13:00:00Z";

function msg(p: Partial<FilaMensaje> & { id: string; ocurrio_en: string }): FilaMensaje {
  return {
    contacto_id: "c1",
    direccion: "entrante",
    telefono: "595981123456",
    texto: "hola",
    tipo: "texto",
    estado: "recibido",
    motivo: null,
    origen: "cliente",
    intencion: null,
    ...p,
  };
}

const CARLOS = { id: "c1", nombre: "Carlos", telefono: "0981 123 456" };
const base = { contactos: [CARLOS], consentimientos: [], eventosDeAtencion: [], ahora: AHORA };

test("una conversación por cliente, con los mensajes del más viejo al más nuevo", () => {
  const r = agruparConversaciones({
    ...base,
    mensajes: [
      msg({ id: "3", ocurrio_en: "2026-09-18T12:00:00Z", texto: "tercero" }),
      msg({ id: "1", ocurrio_en: "2026-09-18T10:00:00Z", texto: "primero" }),
      msg({ id: "2", ocurrio_en: "2026-09-18T11:00:00Z", texto: "segundo" }),
    ],
  });

  assert.equal(r.length, 1);
  assert.equal(r[0].nombre, "Carlos");
  assert.deepEqual(r[0].mensajes.map((m) => m.texto), ["primero", "segundo", "tercero"]);
  assert.equal(r[0].ultimo.texto, "tercero");
});

test("un número sin ficha se muestra por su teléfono, sin inventar un nombre", () => {
  const r = agruparConversaciones({
    ...base,
    mensajes: [msg({ id: "1", contacto_id: null, telefono: "595985999888", ocurrio_en: "2026-09-18T10:00:00Z" })],
  });
  assert.equal(r[0].nombre, "+595985999888");
  assert.equal(r[0].contacto_id, null);
  assert.equal(r[0].consentimiento, "sin_registro");
});

test("dos clientes son dos conversaciones, la más reciente primero", () => {
  const r = agruparConversaciones({
    ...base,
    contactos: [CARLOS, { id: "c2", nombre: "Marta", telefono: null }],
    mensajes: [
      msg({ id: "1", ocurrio_en: "2026-09-18T08:00:00Z" }),
      msg({ id: "2", contacto_id: "c2", telefono: "595985999888", ocurrio_en: "2026-09-18T09:00:00Z" }),
    ],
  });
  assert.deepEqual(r.map((c) => c.nombre), ["Marta", "Carlos"]);
});

test("el que espera respuesta va primero, aunque sea el menos reciente", () => {
  const r = agruparConversaciones({
    ...base,
    contactos: [CARLOS, { id: "c2", nombre: "Marta", telefono: null }],
    mensajes: [
      msg({ id: "1", ocurrio_en: "2026-09-18T08:00:00Z" }),
      msg({ id: "2", contacto_id: "c2", telefono: "595985999888", ocurrio_en: "2026-09-18T12:00:00Z" }),
    ],
    eventosDeAtencion: [{ contacto_id: "c1", creado_en: "2026-09-18T08:00:00Z" }],
  });
  assert.deepEqual(r.map((c) => [c.nombre, c.esperando]), [["Carlos", true], ["Marta", false]]);
});

test("si la empresa contestó, ya no espera; si el envío fue BLOQUEADO, sigue esperando", () => {
  const con = (estado: string) =>
    agruparConversaciones({
      ...base,
      mensajes: [
        msg({ id: "1", ocurrio_en: "2026-09-18T08:00:00Z" }),
        msg({ id: "2", direccion: "saliente", estado, origen: "usuario", ocurrio_en: "2026-09-18T09:00:00Z" }),
      ],
      eventosDeAtencion: [{ contacto_id: "c1", creado_en: "2026-09-18T08:00:00Z" }],
    })[0].esperando;

  assert.equal(con("enviado"), false);
  assert.equal(con("bloqueado"), true);
});

test("el consentimiento del cliente viaja con la conversación", () => {
  const r = agruparConversaciones({
    ...base,
    consentimientos: [{ contacto_id: "c1", estado: "revocado" }],
    mensajes: [msg({ id: "1", ocurrio_en: "2026-09-18T08:00:00Z" })],
  });
  assert.equal(r[0].consentimiento, "revocado");
});

test("solo se muestran los últimos 30 mensajes de cada conversación", () => {
  const mensajes = Array.from({ length: 45 }, (_, i) =>
    msg({ id: String(i), ocurrio_en: new Date(Date.UTC(2026, 8, 18, 0, i)).toISOString(), texto: `m${i}` }),
  );
  const r = agruparConversaciones({ ...base, mensajes });
  assert.equal(r[0].mensajes.length, 30);
  assert.equal(r[0].mensajes[0].texto, "m15");
  assert.equal(r[0].ultimo.texto, "m44");
});

test("un mensaje sin texto (audio, imagen) queda como cadena vacía, no null", () => {
  const r = agruparConversaciones({ ...base, mensajes: [msg({ id: "1", texto: null, tipo: "audio", ocurrio_en: "2026-09-18T08:00:00Z" })] });
  assert.equal(r[0].ultimo.texto, "");
  assert.equal(r[0].ultimo.tipo, "audio");
});

test("sin mensajes no hay conversaciones", () => {
  assert.deepEqual(agruparConversaciones({ ...base, mensajes: [] }), []);
});
