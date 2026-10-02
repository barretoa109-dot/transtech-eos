import assert from "node:assert/strict";
import { test } from "node:test";

import { correoDeReporte, validarReporte } from "./reporte-respuesta.ts";

const ID = "11111111-1111-4111-8111-111111111111";

test("un reporte válido: motivo conocido y la respuesta (por id o por texto)", () => {
  const r = validarReporte({ motivo: "ofensivo", mensaje_id: ID, canal: "app", comentario: "  muy   grosero " });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.reporte.motivo, "ofensivo");
  assert.equal(r.reporte.mensajeId, ID);
  assert.equal(r.reporte.canal, "app");
  assert.equal(r.reporte.comentario, "muy grosero");
  assert.equal(validarReporte({ motivo: "incorrecto", extracto: "El dólar está a 2.000" }).ok, true);
});

test("sin motivo válido o sin respuesta no se acepta; ids raros se ignoran", () => {
  assert.equal(validarReporte({ motivo: "spam", mensaje_id: ID }).ok, false);
  assert.equal(validarReporte({ motivo: "otro" }).ok, false);
  const r = validarReporte({ motivo: "otro", mensaje_id: "1; drop table", extracto: "x" });
  assert.equal(r.ok && r.reporte.mensajeId, null);
  assert.equal(validarReporte(null).ok, false);
});

test("el correo al dueño escapa lo que escribió la persona", () => {
  const v = validarReporte({ motivo: "peligroso", extracto: "x", comentario: "<script>alert(1)</script>" });
  assert.ok(v.ok);
  if (!v.ok) return;
  const c = correoDeReporte({ reporte: v.reporte, extracto: "Respuesta <b>mala</b>", correoUsuario: "a@b.com", id: 7 });
  assert.equal(c.asunto, "EOS: respuesta reportada (peligrosa o dañina)");
  assert.doesNotMatch(c.html, /<script>|<b>mala/);
  assert.match(c.html, /&lt;script&gt;/);
  assert.match(c.texto, /Reporte n\.º 7/);
  assert.match(c.texto, /Respuesta reportada:\nRespuesta <b>mala<\/b>/);
});
