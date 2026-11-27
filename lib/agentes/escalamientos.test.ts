import assert from "node:assert/strict";
import { test } from "node:test";

import { avisoPush, correoDeEscalamientos, type Escalamiento } from "./escalamientos.ts";

const caso = (extra: Partial<Escalamiento> = {}): Escalamiento => ({
  id: "e1",
  agente: "soporte",
  usuario_id: "11111111-1111-4111-8111-111111111111",
  motivo: "Pregunta fuera de la base de conocimiento",
  prioridad: "urgente",
  contexto: { tema: "factura" },
  creado_en: "2026-11-27T21:00:00Z",
  ...extra,
});

test("el push no lleva la cuenta ni el contexto: se lee con el teléfono bloqueado", () => {
  const aviso = avisoPush([caso()]);
  assert.equal(aviso.titulo, "EOS · Soporte escaló un caso");
  assert.doesNotMatch(JSON.stringify(aviso), /1111|factura/);
  assert.equal(aviso.url, "/admin/agentes");
  assert.equal(avisoPush([caso(), caso({ agente: "cobranza" })]).titulo, "EOS · 2 casos urgentes");
});

test("el correo lista cada caso con su hora de Asunción y escapa lo variable", () => {
  const correo = correoDeEscalamientos([caso({ motivo: "<script>x</script>", prioridad: "normal" })], {
    urgentes: false,
    baseUrl: "https://www.transtech.com.py/",
  });
  assert.equal(correo.asunto, "Agentes: 1 caso para revisar hoy");
  assert.match(correo.texto, /\[Soporte\] <script>x<\/script> — 27\/11.*18:00/);
  assert.match(correo.texto, /https:\/\/www\.transtech\.com\.py\/admin\/agentes/);
  assert.doesNotMatch(correo.html, /<script>/);
});
