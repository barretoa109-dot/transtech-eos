import test from "node:test";
import assert from "node:assert/strict";

import { pasoDelDia, redactarPrimerosDias, type DatosDeCuenta, type Paso } from "./primeros-dias.ts";

const nada = new Set<Paso>();
const urls = { chat: "https://x/eos/chat", perfil: "https://x/eos/chat?vista=perfil", baja: "https://x/baja?u=1&t=2" };
const datos = (extra: Partial<DatosDeCuenta> = {}): DatosDeCuenta => ({
  nombre: "Carmen López",
  rubro: "campo",
  whatsappVinculado: false,
  acciones: {},
  vendido: 0,
  ...extra,
});

test("el día de alta no se manda nada; al día 1, el primero", () => {
  assert.equal(pasoDelDia(0, false, nada), null);
  assert.equal(pasoDelDia(1, false, nada), "dia1");
  assert.equal(pasoDelDia(2, true, nada), "dia1", "si el cron falló ayer, se manda hoy");
});

test("el del día 3 solo va a quien todavía no anotó nada", () => {
  assert.equal(pasoDelDia(3, false, new Set<Paso>(["dia1"])), "dia3");
  assert.equal(pasoDelDia(3, true, new Set<Paso>(["dia1"])), null);
});

test("nunca dos veces el mismo, y fuera de la primera semana nada", () => {
  assert.equal(pasoDelDia(1, false, new Set<Paso>(["dia1"])), null);
  assert.equal(pasoDelDia(7, true, new Set<Paso>(["dia1", "dia7"])), null);
  assert.equal(pasoDelDia(10, false, nada), null);
  assert.equal(pasoDelDia(7, true, new Set<Paso>(["dia1"])), "dia7");
});

test("día 1: ejemplo de su rubro y, si no conectó WhatsApp, lo invita", () => {
  const { asunto, texto } = redactarPrimerosDias("dia1", datos(), urls);
  assert.equal(asunto, "Tres cosas para pedirle hoy a EOS");
  assert.match(texto, /^Hola Carmen,/);
  assert.match(texto, /«Vendí 3 lechones a 450 mil»/);
  assert.match(texto, /Conectar mi WhatsApp: https:\/\/x\/eos\/chat\?vista=perfil/);

  const conectado = redactarPrimerosDias("dia1", datos({ whatsappVinculado: true, rubro: null }), urls).texto;
  assert.doesNotMatch(conectado, /WhatsApp/);
  assert.match(conectado, /«Vendí 2 unidades a 80 mil cada una»/);
});

test("día 7 con uso: cuenta lo que quedó hecho, sin inventar", () => {
  const { asunto, texto } = redactarPrimerosDias(
    "dia7",
    datos({ acciones: { REGISTRAR_VENTA: 4, CREAR_PRODUCTO: 1 }, vendido: 1_750_000 }),
    urls,
  );
  assert.equal(asunto, "Tu primera semana con EOS");
  assert.match(texto, /anotamos 5 cosas: 4 ventas, 1 carga de productos\./);
  assert.match(texto, /1\.750\.000/);
});

test("día 7 sin uso: pregunta qué la frenó, y la respuesta le llega a una persona", () => {
  const { asunto, texto } = redactarPrimerosDias("dia7", datos(), urls);
  assert.equal(asunto, "¿Qué te frenó?");
  assert.match(texto, /respondé este correo/);
});

test("todo correo trae la baja de un clic y escapa el nombre", () => {
  for (const paso of ["dia1", "dia3", "dia7"] as const) {
    const { html, texto } = redactarPrimerosDias(paso, datos({ nombre: "<b>Ana</b>" }), urls);
    assert.match(html, /darte de baja/);
    assert.match(texto, /Darte de baja: https:\/\/x\/baja/);
    assert.ok(!html.includes("<b>Ana</b>"));
  }
});
