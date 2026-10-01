import assert from "node:assert/strict";
import { test } from "node:test";

import { PROMPT_SISTEMA } from "./sistema.ts";

/*
 * Batería de lenguaje natural (01/10/2026, evals/qa/natural.ts): las reglas que
 * cerraron sus brechas. Se miden con el modelo en la QA con tope; acá se fija
 * que sigan en el prompt (TS y n8n son el mismo texto: sistema.test.ts).
 */
test("montos como se dicen en Paraguay, sin preguntar cuando la cuenta cierra", () => {
  assert.match(PROMPT_SISTEMA, /MONTOS COMO SE DICEN ACÁ/);
  assert.match(PROMPT_SISTEMA, /"me pasó 300"/);
});

test("un pedido con varias cosas no se hace a medias", () => {
  assert.match(PROMPT_SISTEMA, /Nunca hagas la mitad y\n  retengas lo que no tenía dudas/);
});

test("cobrar después es una venta a crédito", () => {
  assert.match(PROMPT_SISTEMA, /Si dice que le va a cobrar DESPUÉS/);
});

test("INC-24: WhatsApp dictado se manda tal cual, sin agregar nada", () => {
  assert.match(PROMPT_SISTEMA, /ese pedido YA es la confirmación y el texto está\n  dictado/);
  assert.match(PROMPT_SISTEMA, /sin agregarle nada/);
});

test("un audio es una transcripción que puede escribir mal nombres y marcas", () => {
  assert.match(PROMPT_SISTEMA, /UN \[Audio\] ES UNA TRANSCRIPCIÓN AUTOMÁTICA/);
  assert.match(PROMPT_SISTEMA, /Lo que no se entiende no se convierte en dato/);
});
