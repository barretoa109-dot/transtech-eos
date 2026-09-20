import assert from "node:assert/strict";
import test from "node:test";

import { armarHistorial, leerCamposFicha, MAX_HISTORIAL, resumenDeFicha, type MensajeFila } from "./ficha.ts";

const UUID = "11111111-1111-4111-8111-111111111111";

// -------------------------------------------------------------- los campos

test("solo devuelve lo que vino: lo ausente no se toca", () => {
  assert.deepEqual(leerCamposFicha({}), { cambios: {}, error: null });
  assert.deepEqual(leerCamposFicha({ empresa: "Molino Sur" }), { cambios: { empresa: "Molino Sur" }, error: null });
});

test("vaciar un campo lo borra; el estado nunca queda vacío", () => {
  const r = leerCamposFicha({ empresa: "  ", proxima_interaccion_en: "", responsable_id: null });
  assert.deepEqual(r.cambios, { empresa: null, proxima_interaccion_en: null, responsable_id: null });

  assert.match(leerCamposFicha({ estado_relacion: "" }).error ?? "", /prospecto, activo o inactivo/);
});

test("un estado inventado se rechaza", () => {
  assert.match(leerCamposFicha({ estado_relacion: "vip" }).error ?? "", /prospecto, activo o inactivo/);
  for (const e of ["prospecto", "activo", "inactivo"]) assert.equal(leerCamposFicha({ estado_relacion: e }).cambios.estado_relacion, e);
});

test("una fecha que no existe se rechaza (no se la corrige en silencio)", () => {
  assert.equal(leerCamposFicha({ proxima_interaccion_en: "2026-09-25" }).cambios.proxima_interaccion_en, "2026-09-25");
  for (const mala of ["2026-02-31", "25/09/2026", "mañana", "2026-13-01"]) {
    assert.match(leerCamposFicha({ proxima_interaccion_en: mala }).error ?? "", /no es válida/, mala);
  }
});

test("el responsable tiene que ser un id", () => {
  assert.equal(leerCamposFicha({ responsable_id: UUID }).cambios.responsable_id, UUID);
  assert.match(leerCamposFicha({ responsable_id: "yo" }).error ?? "", /no es válido/);
});

test("un texto largo se recorta a lo que acepta la base", () => {
  assert.equal(String(leerCamposFicha({ empresa: "x".repeat(500) }).cambios.empresa).length, 160);
});

// ------------------------------------------------------------ el historial

const msg = (extra: Partial<MensajeFila> = {}): MensajeFila => ({
  direccion: "saliente", tipo: "texto", texto: "Hola", estado: "enviado", motivo: null, origen: "usuario", ocurrio_en: "2026-09-15T13:00:00Z", ...extra,
});

const vacio = { mensajes: [], actividades: [], oportunidades: [], ventas: [] };

test("mezcla las cuatro fuentes, lo más nuevo primero", () => {
  const h = armarHistorial({
    mensajes: [msg({ ocurrio_en: "2026-09-10T13:00:00Z" })],
    actividades: [{ id: "a1", tipo: "llamada", detalle: "Pidió precio", fecha: "2026-09-12", hecha: true }],
    oportunidades: [{ id: "o1", titulo: "Sistema", etapa: "nueva", monto: 5_000_000, moneda: "PYG", creado_en: "2026-09-01T10:00:00Z", cerrada_en: null, motivo_perdida: null }],
    ventas: [{ id: "v1", fecha: "2026-09-14", total: 300_000, moneda: "PYG", estado: "cobrada", numero_comprobante: "001-001-0000012" }],
  });

  assert.deepEqual(h.map((e) => e.tipo), ["venta", "actividad", "mensaje_enviado", "oportunidad_creada"]);
  assert.match(h[0].detalle ?? "", /₲ 300\.000 · cobrada/);
});

test("un mensaje que NO salió aparece como tal, con su motivo", () => {
  const [e] = armarHistorial({ ...vacio, mensajes: [msg({ estado: "bloqueado", motivo: "Pasaron más de 24 horas.", texto: "Hola" })] });

  assert.equal(e.tipo, "mensaje_no_salio");
  assert.equal(e.titulo, "Un mensaje NO salió");
  assert.equal(e.detalle, "Pasaron más de 24 horas.");
});

test("lo que escribió EOS se distingue de lo que escribió la persona", () => {
  const h = armarHistorial({ ...vacio, mensajes: [msg({ origen: "eos_autonomo", ocurrio_en: "2026-09-16T10:00:00Z" }), msg()] });

  assert.equal(h[0].titulo, "EOS le escribió por WhatsApp");
  assert.equal(h[1].titulo, "Le escribiste por WhatsApp");
});

test("una oportunidad cerrada suma su cierre; la perdida dice el motivo", () => {
  const h = armarHistorial({
    ...vacio,
    oportunidades: [{ id: "o1", titulo: "Flota", etapa: "perdida", monto: 0, moneda: "PYG", creado_en: "2026-08-01T10:00:00Z", cerrada_en: "2026-09-02T10:00:00Z", motivo_perdida: "precio" }],
  });

  assert.deepEqual(h.map((e) => e.tipo), ["oportunidad_perdida", "oportunidad_creada"]);
  assert.equal(h[0].detalle, "Motivo: precio");
});

test("una venta anulada no es historia comercial; una tarea pendiente se marca", () => {
  const h = armarHistorial({
    ...vacio,
    ventas: [{ id: "v", fecha: "2026-09-14", total: 1, moneda: "PYG", estado: "anulada", numero_comprobante: null }],
    actividades: [{ id: "a", tipo: "tarea", detalle: "Llamarlo", fecha: "2026-09-20", hecha: false }],
  });

  assert.equal(h.length, 1);
  assert.equal(h[0].tipo, "pendiente");
  assert.match(h[0].titulo, /^Pendiente · Tarea/);
});

test("un mensaje largo se recorta y el historial tiene tope", () => {
  const largo = armarHistorial({ ...vacio, mensajes: [msg({ texto: "a".repeat(600) })] })[0];
  assert.ok((largo.detalle ?? "").length <= 200);

  const muchos = Array.from({ length: 100 }, (_, i) => msg({ ocurrio_en: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z` }));
  assert.equal(armarHistorial({ ...vacio, mensajes: muchos }).length, MAX_HISTORIAL);
});

// -------------------------------------------------------------- el resumen

const AHORA = new Date("2026-09-19T12:00:00Z");

test("el último contacto es el más nuevo entre lo que salió, lo que llegó y lo hecho", () => {
  const r = resumenDeFicha(
    {
      ...vacio,
      mensajes: [msg({ ocurrio_en: "2026-09-10T10:00:00Z" }), msg({ direccion: "entrante", estado: "recibido", ocurrio_en: "2026-09-12T10:00:00Z" })],
      actividades: [{ id: "a", tipo: "llamada", detalle: "x", fecha: "2026-09-14", hecha: true }],
    },
    AHORA,
  );

  assert.equal(r.ultimo_contacto, "2026-09-14T12:00:00.000Z");
});

test("lo que NO salió no cuenta como contacto, y una tarea pendiente tampoco", () => {
  const r = resumenDeFicha(
    { ...vacio, mensajes: [msg({ estado: "bloqueado" })], actividades: [{ id: "a", tipo: "tarea", detalle: "x", fecha: "2026-09-25", hecha: false }] },
    AHORA,
  );
  assert.equal(r.ultimo_contacto, null);
  assert.equal(r.sin_respuesta_dias, null);
});

test("sin respuesta: cuenta los días desde nuestro último mensaje, solo si nadie contestó después", () => {
  const sin = resumenDeFicha({ ...vacio, mensajes: [msg({ ocurrio_en: "2026-09-15T12:00:00Z" })] }, AHORA);
  assert.equal(sin.sin_respuesta_dias, 4);

  const contesto = resumenDeFicha(
    { ...vacio, mensajes: [msg({ ocurrio_en: "2026-09-15T12:00:00Z" }), msg({ direccion: "entrante", estado: "recibido", ocurrio_en: "2026-09-16T12:00:00Z" })] },
    AHORA,
  );
  assert.equal(contesto.sin_respuesta_dias, null);
});

test("las ventas y la plata abierta se suman POR MONEDA, sin mezclarlas", () => {
  const r = resumenDeFicha(
    {
      ...vacio,
      ventas: [
        { id: "1", fecha: "2026-09-01", total: 100, moneda: "PYG", estado: "emitida", numero_comprobante: null },
        { id: "2", fecha: "2026-09-02", total: 50, moneda: "PYG", estado: "cobrada", numero_comprobante: null },
        { id: "3", fecha: "2026-09-03", total: 20, moneda: "USD", estado: "emitida", numero_comprobante: null },
        { id: "4", fecha: "2026-09-04", total: 999, moneda: "PYG", estado: "anulada", numero_comprobante: null },
      ],
      oportunidades: [
        { id: "a", titulo: "A", etapa: "propuesta", monto: 1000, moneda: "PYG", creado_en: "2026-09-01T00:00:00Z", cerrada_en: null, motivo_perdida: null },
        { id: "b", titulo: "B", etapa: "ganada", monto: 5000, moneda: "PYG", creado_en: "2026-09-01T00:00:00Z", cerrada_en: "2026-09-05T00:00:00Z", motivo_perdida: null },
      ],
    },
    AHORA,
  );

  assert.deepEqual(r.ventas, { cantidad: 3, por_moneda: { PYG: 150, USD: 20 } });
  assert.deepEqual(r.oportunidades_abiertas, { cantidad: 1, por_moneda: { PYG: 1000 } });
});
