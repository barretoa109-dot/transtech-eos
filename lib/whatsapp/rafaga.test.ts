import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aplicarPrompt, MARCA } from "../../n8n/parches/cambios-varias-fotos.mjs";
import { armarPrompt } from "../gateway/prompt.ts";
import { prepararEntrada } from "../gateway/entrada.ts";
import { PROMPT_SISTEMA } from "../gateway/sistema.ts";
import { avisoNoLegible, entradaDeMensaje, unirLote, type FilaRafaga, type MensajeWhatsapp } from "./rafaga.ts";

/**
 * El caso de Sofía (25/09/2026): dos capturas de un pedido y un texto, que
 * WhatsApp manda como mensajes sueltos, tienen que llegar al modelo como UN
 * pedido con las dos imágenes y el texto. Ver la migración v199.
 */

const fila = (m: MensajeWhatsapp, n: number): FilaRafaga => {
  const e = entradaDeMensaje(m);
  assert.ok(e);
  return { ...e, id: n, recibido_en: `2026-09-25T23:07:0${n}Z` };
};

const FOTO_1: MensajeWhatsapp = { id: "wamid.1", from: "595981", type: "image", image: { id: "m1", mime_type: "image/jpeg" } };
const FOTO_2: MensajeWhatsapp = {
  id: "wamid.2",
  from: "595981",
  type: "image",
  image: { id: "m2", mime_type: "image/jpeg", caption: "Pasame estas 6 prendas a guaranies 5.988,99gs esta el dolar" },
};
const RARO: MensajeWhatsapp = { id: "wamid.3", from: "595981", type: "unsupported", errors: [{ code: 131051 }] };

test("el caso de Sofía: dos fotos y un mensaje raro son UN pedido con las dos fotos y el texto", () => {
  const lote = unirLote([fila(RARO, 3), fila(FOTO_2, 2), fila(FOTO_1, 1)]);

  assert.equal(lote.texto, "Pasame estas 6 prendas a guaranies 5.988,99gs esta el dolar");
  assert.deepEqual(
    lote.medios.map((m) => [m.media_id, m.nombre]),
    [
      ["m1", "whatsapp-image"],
      ["m2", "whatsapp-image-2"],
    ],
  );
  assert.deepEqual(lote.noLegibles, ["unsupported"]);
  assert.equal(lote.ultimoId, "wamid.3");
});

test("texto suelto y foto después: van juntos y en orden", () => {
  const texto: MensajeWhatsapp = { id: "t", from: "1", type: "text", text: { body: "estos son del pedido nuevo" } };
  const lote = unirLote([fila(texto, 1), fila({ ...FOTO_1, from: "1" }, 2)]);
  assert.equal(lote.texto, "estos son del pedido nuevo");
  assert.equal(lote.medios.length, 1);
});

test("un solo mensaje de texto queda igual que antes", () => {
  const lote = unirLote([fila({ id: "t", from: "1", type: "text", text: { body: "hola" } }, 1)]);
  assert.deepEqual(lote, { texto: "hola", medios: [], noLegibles: [], ultimoId: "t" });
});

test("una reacción o un aviso del sistema no se anotan: no merecen respuesta", () => {
  assert.equal(entradaDeMensaje({ id: "r", from: "1", type: "reaction" }), null);
  assert.equal(entradaDeMensaje({ id: "s", from: "1", type: "system" }), null);
  assert.equal(entradaDeMensaje({ from: "1", type: "text" }), null);
});

test("el documento conserva su nombre", () => {
  const doc = fila({ id: "d", from: "1", type: "document", document: { id: "m", mime_type: "application/pdf", filename: "factura.pdf" } }, 1);
  assert.equal(unirLote([doc]).medios[0].nombre, "factura.pdf");
});

test("el aviso nunca dice 'puedo leer imágenes' a quien acaba de mandarlas", () => {
  for (const tipos of [["unsupported"], ["video"], ["location"], ["contacts"], ["interactive"]]) {
    assert.doesNotMatch(avisoNoLegible(tipos), /puedo leer texto, imágenes/);
  }
  assert.match(avisoNoLegible(["unsupported"]), /no me llegó completo/);
  assert.match(avisoNoLegible(["video"]), /videos/);
  assert.equal(avisoNoLegible(["sticker"]), "", "a un sticker no se le contesta");
});

// ------------------------------------------------ el gateway TS ve las dos

test("el gateway TypeScript manda TODAS las imágenes al modelo, no solo la primera", () => {
  const imagen = (n: number) => ({ nombre: `whatsapp-image-${n}`, tipo: "image/jpeg", base64: `QUJD${n}`, tamanio: 3 });
  const e = prepararEntrada({
    request_id: "11111111-1111-4111-8111-111111111111",
    usuario_id: "22222222-2222-4222-9222-222222222222",
    conversacion_id: "33333333-3333-4333-a333-333333333333",
    mensaje: "Pasame estas 6 prendas a guaranies",
    archivo: imagen(1),
    archivos: [imagen(1), imagen(2)],
  });
  const p = armarPrompt(e);
  assert.equal(p.contenido.filter((c) => c.type === "input_image").length, 2);
  assert.match(p.prompt_eos, /adjuntó 2 imágenes/);
});

// ------------------------------------------------------------- el prompt

const gateway = JSON.parse(
  readFileSync(new URL("../../n8n/workflows/eos-conversational-gateway-rc1.json", import.meta.url), "utf8"),
);
const original: string = gateway.nodes.find((n: { name: string }) => n.name.startsWith("HTTP Request")).parameters.jsonBody;
const prompt = original.includes(MARCA) ? original : aplicarPrompt(original, "copia");

test("el prompt pide leer todas las imágenes juntas y no contradecir a la persona", () => {
  assert.ok(prompt.includes(MARCA));
  assert.match(prompt, /leelas TODAS/);
  assert.match(prompt, /Nunca le digas a la persona que se equivoca con lo que vos no ves/);
  assert.match(prompt, /seguí lo que se venía haciendo/);
});

test("el prompt pide guaraníes redondeados, sin centavos", () => {
  assert.match(prompt, /REDONDEÁ al guaraní/);
  assert.match(prompt, /₲113\.970\)/);
});

test("el prompt de TypeScript es el mismo que el de n8n", () => {
  assert.ok(PROMPT_SISTEMA.includes(MARCA), "correr node n8n/parches/sincronizar-prompt.mjs");
});

test("el parche del prompt es idempotente", () => {
  assert.throws(() => aplicarPrompt(prompt, "ya aplicado"), /ya tiene las reglas/);
});
