import assert from "node:assert/strict";
import { test } from "node:test";

import { PROMPT_SISTEMA } from "./sistema.ts";

/*
 * INC-19 (feedback beta, 01/10/2026): EOS priorizó el arreglo de la moto
 * cuando la persona había dicho que sus préstamos iban primero, y armó el
 * plan como si el ingreso fuera fijo. Estas reglas son conducta del asesor:
 * se miden con la batería (frases `asesoria-*`); acá se fija que estén.
 */
test("el prompt hace mandar lo que la persona decidió", () => {
  assert.match(PROMPT_SISTEMA, /LO QUE LA PERSONA YA\n  DECIDIÓ MANDA/);
  assert.match(PROMPT_SISTEMA, /no cambies el orden por tu cuenta/);
});

test("el prompt separa el ingreso fijo del variable y no inventa un sueldo", () => {
  assert.match(PROMPT_SISTEMA, /INGRESO QUE VARÍA/);
  assert.match(PROMPT_SISTEMA, /nunca supongas un sueldo fijo/);
});

test("una prioridad declarada se guarda aunque el mensaje sea una consulta", () => {
  assert.match(PROMPT_SISTEMA, /mandá GUARDAR_MEMORIA con eso aunque el resto\n  del mensaje sea una consulta/);
});

test("un plan son pasos con cuándo y las tareas se ofrecen, no se crean solas", () => {
  assert.match(PROMPT_SISTEMA, /UN PLAN SON PASOS CON CUÁNDO/);
  assert.match(PROMPT_SISTEMA, /ofrecé cargarlos como tareas: no\n  mandes CREAR_TAREA por un plan que nadie te pidió cargar/);
});
