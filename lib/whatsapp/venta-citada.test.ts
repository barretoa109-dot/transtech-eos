import assert from "node:assert/strict";
import test from "node:test";

import { HISTORIAL_MAXIMO, enOrdenDeTurno, historialDeLaSesion, marcaDeAntiguedad } from "../eos/historial.ts";
import { prepararEntrada } from "../gateway/entrada.ts";
import { armarJobs, requestIdDeAccion } from "../gateway/jobs.ts";
import { armarPrompt } from "../gateway/prompt.ts";
import { PROMPT_SISTEMA } from "../gateway/sistema.ts";
import { mensajeConCitaDeWhatsapp } from "./cita.ts";
import { idDeterministico } from "./id-determinista.ts";
import { entradaDeMensaje, type MensajeWhatsapp } from "./rafaga.ts";
import { filasDelTurno } from "./turno.ts";

/**
 * Las dos conversaciones de Sofía del 01/10/2026 (WhatsApp), por el mismo
 * camino que recorre un mensaje: lo que manda Meta, lo que se guarda, lo que
 * se lee de vuelta y lo que le llega al modelo. Sin red ni modelo: lo que el
 * modelo hace con esto se mide en `evals/qa` (casos `venta-citada-*`).
 */

const UUID = "11111111-1111-4111-8111-111111111111";
const AHORA = Date.parse("2026-10-02T00:22:00Z");
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString().replace("T", " ").replace("Z", "");

/** Lo que el webhook hace con las filas que lee de `mensajes`. */
function historialComoLoArmaElWebhook(filas: Array<{ rol: string; texto: string; created_at: string }>) {
  return historialDeLaSesion(enOrdenDeTurno(filas).slice(-HISTORIAL_MAXIMO), AHORA).map((f) => {
    const marca = marcaDeAntiguedad(f.created_at, AHORA);
    return { rol: f.rol, texto: marca ? `${marca} ${f.texto}` : f.texto };
  });
}

function promptCon(mensaje: string, historial: Array<{ rol: string; texto: string }>) {
  return armarPrompt(
    prepararEntrada({ mensaje, request_id: UUID, usuario_id: UUID, conversacion_id: UUID, historial, origen: "whatsapp" }),
  ).prompt_eos;
}

const ZAPATO = "Costo final del zapato marrón mocha: ₲125.245,4. Sale de ₲89.742 de costo base + ₲35.503,4 de envío.";

test("Meta manda la cita como context.id, y ese id queda anotado en la ráfaga", () => {
  // La forma real del payload de WhatsApp Cloud API para "Responder".
  const m: MensajeWhatsapp = {
    id: "wamid.REGISTRA",
    from: "595981000000",
    type: "text",
    text: { body: "Registra la venta de esto" },
    context: { id: "wamid.ZAPATO", from: "595900000000" },
  };
  const entrada = entradaDeMensaje(m);
  assert.equal(entrada?.contexto_wa_id, "wamid.ZAPATO");
  assert.equal(entrada?.texto, "Registra la venta de esto");
});

test("caso 1, primer turno: el mensaje citado llega al modelo y 'esto' es el zapato", () => {
  const mensaje = mensajeConCitaDeWhatsapp("Registra la venta de esto", { rol: "eos", texto: ZAPATO });
  const prompt = promptCon(mensaje, []);

  assert.match(prompt, /En respuesta a este mensaje de EOS:\n> Costo final del zapato marrón mocha/);
  assert.match(prompt, /Mensaje actual:\nEn respuesta a este mensaje de EOS:[\s\S]*Registra la venta de esto/);
  assert.doesNotMatch(prompt, /no encontré guardado/);
});

test("caso 1, segundo turno: la aclaración llega con el pedido de antes y el zapato en el historial", () => {
  const citado = mensajeConCitaDeWhatsapp("Registra la venta de esto", { rol: "eos", texto: ZAPATO });
  // El turno anterior quedó guardado (las dos filas con las mismas columnas).
  const [persona, eos] = filasDelTurno({
    conversacionId: UUID,
    usuarioId: UUID,
    textoUsuario: citado,
    textoEos: "Es el zapato marrón mocha. ¿A cuánto lo vendiste?",
    waIds: ["wamid.REGISTRA"],
  });
  const historial = historialComoLoArmaElWebhook([
    { rol: persona.rol, texto: persona.texto, created_at: hace(2) },
    { rol: eos.rol, texto: eos.texto, created_at: hace(2) },
  ]);

  const prompt = promptCon("Vendí a 160.000 gs. Era un sobrepedido de Gladys Velilla", historial);
  const conversacion = prompt.slice(prompt.indexOf("Conversación reciente:"), prompt.indexOf("Mensaje actual:"));

  // En orden: el pedido citado, la pregunta de EOS, y recién ahí la aclaración.
  assert.ok(conversacion.indexOf("Registra la venta de esto") < conversacion.indexOf("¿A cuánto lo vendiste?"));
  assert.match(conversacion, /zapato marrón mocha: ₲125\.245,4/);
  assert.match(prompt, /Mensaje actual:\nVendí a 160\.000 gs\. Era un sobrepedido de Gladys Velilla/);
  // De esta sesión: sin marca de antigüedad.
  assert.doesNotMatch(conversacion, /\[de hace/);
});

test("caso 2: '155.000gs' llega justo después de '¿A cuánto lo cobraste?', y lo de la gorra viene marcado como viejo", () => {
  const historial = historialComoLoArmaElWebhook([
    {
      rol: "eos",
      texto: "El envío de ₲41.241 corresponde a la Gorra lacoste sobrepedido; decime el costo base de la gorra.",
      created_at: hace(3 * 24 * 60 + 40),
    },
    { rol: "usuario", texto: "Registra la venta del chaleco de encaje negro M", created_at: hace(1) },
    { rol: "eos", texto: "Me falta el monto de venta del chaleco de encaje. ¿A cuánto lo cobraste?", created_at: hace(1) },
  ]);

  const prompt = promptCon("155.000gs", historial);
  const conversacion = prompt.slice(prompt.indexOf("Conversación reciente:"), prompt.indexOf("Mensaje actual:")).trim();

  assert.match(conversacion, /EOS: \[de hace 3 días\] El envío de ₲41\.241 corresponde a la Gorra/);
  assert.ok(conversacion.endsWith("EOS: Me falta el monto de venta del chaleco de encaje. ¿A cuánto lo cobraste?"));
});

test("la marca de antigüedad: nada en la sesión, horas o días fuera de ella", () => {
  assert.equal(marcaDeAntiguedad(hace(30), AHORA), "");
  assert.equal(marcaDeAntiguedad(hace(5 * 60), AHORA), "[de hace 5 horas]");
  assert.equal(marcaDeAntiguedad(hace(30 * 60), AHORA), "[de hace 1 día]");
  assert.equal(marcaDeAntiguedad(hace(3 * 24 * 60 + 40), AHORA), "[de hace 3 días]");
  assert.equal(marcaDeAntiguedad(null, AHORA), "");
});

test("un reintento de Meta es el mismo pedido: mismo request_id y mismas acciones", () => {
  // El webhook deriva el request_id del id del mensaje de WhatsApp.
  const a = idDeterministico("wamid.VENDI");
  const b = idDeterministico("wamid.VENDI");
  assert.equal(a, b);
  assert.notEqual(a, idDeterministico("wamid.OTRO"));

  const venta = {
    tipo: "REGISTRAR_VENTA",
    datos: {
      contacto: "Gladys Velilla",
      nota: "sobrepedido",
      items: [{ producto: "Zapatos marrón mocha", cantidad: 1, precio_unitario: 160000, costo_unitario: 125245.4 }],
    },
  };
  const respuesta = { respuesta: "", acciones: [venta] } as unknown as Parameters<typeof armarJobs>[1];
  const entrada = (id: string) =>
    prepararEntrada({ mensaje: "Vendí a 160.000", request_id: id, usuario_id: UUID, conversacion_id: UUID, historial: [] });

  const primera = armarJobs(entrada(a), respuesta);
  const reintento = armarJobs(entrada(b), respuesta);
  assert.equal(primera[0].request_id, reintento[0].request_id);
  assert.equal(primera[0].request_id, requestIdDeAccion(a, 0));
  // La nota viaja con la venta hasta el ejecutor (v231).
  assert.equal((primera[0].accion.datos as Record<string, unknown>).nota, "sobrepedido");
});

test("el prompt de los dos gateways tiene las reglas del 01/10 y la nota de la venta", async () => {
  const { CAMBIOS, aplicar } = await import("../../n8n/parches/cambios-venta-citada.mjs");
  for (const c of CAMBIOS) assert.ok(PROMPT_SISTEMA.includes(c.nuevo), `falta en sistema.ts: ${c.donde}`);
  assert.equal(aplicar(PROMPT_SISTEMA, "prueba"), PROMPT_SISTEMA, "el parche no es idempotente");
  assert.match(PROMPT_SISTEMA, /vence_el\?, nota\? \}/);
  assert.match(PROMPT_SISTEMA, /UNA RESPUESTA CORTA CONTESTA TU ÚLTIMA PREGUNTA/);
  assert.match(PROMPT_SISTEMA, /REGISTRAR UNA VENTA NO ES CAMBIAR EL CATÁLOGO/);
  assert.match(PROMPT_SISTEMA, /UNA CORRECCIÓN MANDA/);
});
