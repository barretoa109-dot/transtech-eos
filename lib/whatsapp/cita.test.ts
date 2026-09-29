import assert from "node:assert/strict";
import test from "node:test";

import { armarPrompt } from "../gateway/prompt.ts";
import { prepararEntrada } from "../gateway/entrada.ts";
import { MAXIMO_CITA } from "../eos/cita.ts";
import { mensajeConCitaDeWhatsapp } from "./cita.ts";

/**
 * El caso de Sofía (29/09/2026): citó una respuesta de EOS con el tipo de
 * cambio adentro y escribió "Aquí está". Al modelo le llegaba "Aquí está" y
 * nada más, y contestó "No me llegó el dato".
 */

const CONVERSION = "Imagen 1:\nMaija Pantalones sueltos: USD 12,37 × 6.014,85 = ₲74.404";

test("el caso de Sofía: el dato citado llega al modelo junto con lo que escribió", () => {
  const mensaje = mensajeConCitaDeWhatsapp("Aquí está", { rol: "eos", texto: CONVERSION });

  assert.equal(
    mensaje,
    "En respuesta a este mensaje de EOS:\n> Imagen 1:\n> Maija Pantalones sueltos: USD 12,37 × 6.014,85 = ₲74.404\n\nAquí está",
  );

  // Y llega de verdad al prompt, por el mismo armado que usa el gateway.
  const uuid = "11111111-1111-4111-8111-111111111111";
  const { prompt_eos } = armarPrompt(
    prepararEntrada({ mensaje, request_id: uuid, usuario_id: uuid, conversacion_id: uuid, historial: [] }),
  );
  assert.match(prompt_eos, /6\.014,85/);
  assert.match(prompt_eos, /Aquí está/);
});

test("citar un mensaje propio se dice como propio, no como de EOS", () => {
  const mensaje = mensajeConCitaDeWhatsapp("y a este sumale el envío", { rol: "usuario", texto: "zapatos marrón mocha" });
  assert.match(mensaje, /^En respuesta a su propio mensaje anterior:\n> zapatos marrón mocha/);
});

test("una cita que no está guardada se avisa: el modelo pide el dato en vez de decir que no llegó", () => {
  const mensaje = mensajeConCitaDeWhatsapp("Aquí está", "no-encontrado");
  assert.match(mensaje, /no tengo guardado/);
  assert.match(mensaje, /Aquí está$/);
});

test("sin cita, el mensaje queda exactamente igual", () => {
  assert.equal(mensajeConCitaDeWhatsapp("hola", null), "hola");
});

test("una cita enorme se recorta: no infla el prompt", () => {
  const mensaje = mensajeConCitaDeWhatsapp("ok", { rol: "eos", texto: "x".repeat(MAXIMO_CITA * 3) });
  assert.ok(mensaje.length < MAXIMO_CITA + 100);
});

test("el prompt de los dos gateways dice que lo citado manda sobre el último tema", async () => {
  const { MARCA, aplicarPrompt } = await import("../../n8n/parches/cambios-respuesta-citada.mjs");
  const { PROMPT_SISTEMA } = await import("../gateway/sistema.ts");
  assert.ok(PROMPT_SISTEMA.includes(MARCA), "sistema.ts no tiene la regla de la respuesta citada");
  assert.equal(aplicarPrompt(PROMPT_SISTEMA, "prueba"), PROMPT_SISTEMA, "el parche no es idempotente");
});
