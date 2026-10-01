import assert from "node:assert/strict";
import { test } from "node:test";

import { TITULO_SIN_TEMA, TITULOS_AUTOMATICOS, limpiarTituloDelModelo, tituloProvisional } from "./titulo-chat.ts";

test("provisional: del mensaje, no de una categoría", () => {
  assert.equal(tituloProvisional("¿Cuánto vale un cerdo de raza de 6 meses en Paraguay?"), "Cuánto vale un cerdo de raza");
  assert.equal(tituloProvisional("vendí 3 bolsas de cemento a Juan"), "Vendí 3 bolsas de cemento a Juan");
  assert.equal(tituloProvisional("gasté 50 mil en nafta. y otra cosa"), "Gasté 50 mil en nafta");
});

test("provisional: un saludo o nada no es un tema", () => {
  for (const t of ["hola", "Hola!", "buenas tardes", "buen día", "", "[Imagen adjunta: foto.jpg]"]) {
    assert.equal(tituloProvisional(t), TITULO_SIN_TEMA, t);
  }
});

test("provisional: largo se corta prolijo", () => {
  const t = tituloProvisional("necesito armar una planilla completísima con todos los movimientos financieros del trimestre");
  assert.ok(t.length <= 48, t);
});

test("el del modelo se limpia: comillas, punto, emojis, prefijo", () => {
  assert.equal(limpiarTituloDelModelo('"Precio del cerdo de raza en Paraguay."'), "Precio del cerdo de raza en Paraguay");
  assert.equal(limpiarTituloDelModelo("Título: 🐷 precio de lechones"), "Precio de lechones");
  assert.equal(limpiarTituloDelModelo("SIN_TEMA"), null);
  assert.equal(limpiarTituloDelModelo(""), null);
  assert.equal(limpiarTituloDelModelo(42), null);
});

test("los títulos genéricos de antes se pueden reemplazar; los del usuario no están en la lista", () => {
  for (const t of ["Inicio con EOS", "Plan financiero", "Estrategia de negocio", "Nuevo chat"]) assert.ok(TITULOS_AUTOMATICOS.has(t), t);
  assert.ok(!TITULOS_AUTOMATICOS.has("WhatsApp"));
  assert.ok(!TITULOS_AUTOMATICOS.has("Mi plan de octubre"));
});
